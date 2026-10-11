/*
 * schema.sql のセキュリティと業務ルールの検証。
 * Supabase と同じロール（anon / authenticated）と auth.uid() を再現した PostgreSQL に対して実行する。
 *
 *   PGHOST=/tmp PGPORT=54329 PGUSER=postgres node --test sql.test.js
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";

const DB = process.env.SATEI_TEST_DB || "satei_test";
const admin = new pg.Pool({ database: "postgres" });
let pool;

const here = new URL(".", import.meta.url);
const read = p => readFileSync(new URL(p, here), "utf8");

before(async () => {
  await admin.query(`drop database if exists ${DB}`);
  await admin.query(`create database ${DB}`);
  pool = new pg.Pool({ database: DB, max: 8 });
  await pool.query(read("./supabase-emulation.sql"));
  await pool.query(read("../schema.sql"));
});
after(async () => {
  await pool?.end();
  await admin.query(`drop database if exists ${DB}`);
  await admin.end();
});

/** 指定したロール・ユーザーとして1つのSQLを実行する（Supabase の PostgREST と同じやり方） */
async function as(who, sql, params = []) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${who.role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify(who.uid ? { sub: who.uid, role: who.role } : { role: who.role })]);
    const r = await client.query(sql, params);
    await client.query("commit");
    return r;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
const ANON = { role: "anon" };
const rpc = async (who, fn, args = "", params = []) =>
  (await as(who, `select public.${fn}(${args}) as v`, params)).rows[0].v;

async function newUser(email) {
  const r = await pool.query("insert into auth.users (email) values ($1) returning id", [email]);
  return { role: "authenticated", uid: r.rows[0].id };
}

const sampleLead = (over = {}) => ({
  property_type: "house", prefecture: "大阪府", city: "東大阪市", town: "長田東2丁目",
  land_area: "120.5", building_area: "98.2", built_year: "1998", layout: "4LDK",
  current_status: "living", sale_timing: "3m", reason: "住み替え",
  name: "査定 太郎", phone: "090-1234-5678", email: "Taro@Example.com",
  address_detail: "3-5 サンプルハイツ101", contact_method: "phone", contact_time: "平日夜",
  consent: true, ...over
});
const submit = (lead) => rpc(ANON, "submit_lead", "$1::jsonb", [JSON.stringify(lead)]);

let ops;        // 運営者
let partnerA;   // 承認済み（全国）
let partnerB;
let partnerC;

async function makeApprovedPartner(email, { credits = 10, areas = [] } = {}) {
  const u = await newUser(email);
  await rpc(u, "register_partner", "$1::jsonb", [JSON.stringify({
    company_name: email.split("@")[0] + "不動産", license_no: "大阪府知事(1)第00001号",
    representative: "代表 一郎", phone: "06-1234-5678", areas
  })]);
  await rpc(ops, "admin_set_partner_approval", "$1::uuid, true", [u.uid]);
  await rpc(ops, "admin_add_credits", "$1::uuid, $2::int, '初回入金'", [u.uid, credits]);
  return u;
}

describe("セットアップ", () => {
  test("運営者を登録できる", async () => {
    ops = await newUser("ops@example.com");
    await pool.query("insert into public.admins (user_id) values ($1)", [ops.uid]);
    assert.equal(await rpc(ops, "is_admin"), true);
  });
});

describe("テーブルへの直接アクセスは誰にもできない", () => {
  for (const table of ["leads", "lead_contacts", "partners", "purchases", "credit_ledger", "admins", "settings"]) {
    test(`匿名ユーザーは ${table} を読めない`, async () => {
      await assert.rejects(as(ANON, `select * from public.${table}`), /permission denied/);
    });
    test(`ログインユーザーも ${table} を読めない`, async () => {
      const u = await newUser(`peek-${table}@example.com`);
      await assert.rejects(as(u, `select * from public.${table}`), /permission denied/);
    });
  }
  test("匿名ユーザーは leads に直接書き込めない", async () => {
    await assert.rejects(
      as(ANON, "insert into public.leads (property_type, prefecture, city, sale_timing, max_buyers, consent_version, consented_at) values ('house','大阪府','x','asap',3,'v',now())"),
      /permission denied/);
  });
});

describe("一般の方の査定依頼", () => {
  test("同意すれば送信できる", async () => {
    const r = await submit(sampleLead());
    assert.equal(r.ok, true);
    assert.match(r.id, /^[0-9a-f-]{36}$/);
    const saved = await pool.query("select email from public.lead_contacts where lead_id = $1", [r.id]);
    assert.equal(saved.rows[0].email, "taro@example.com"); // 小文字に正規化
  });

  test("同意がなければ送信できない", async () => {
    await assert.rejects(submit(sampleLead({ consent: false })), /同意/);
  });

  test("電話もメールも無ければ送信できない", async () => {
    await assert.rejects(submit(sampleLead({ phone: "", email: "" })), /電話番号かメールアドレス/);
  });

  test("不正な値はDBの制約で弾かれる", async () => {
    await assert.rejects(submit(sampleLead({ property_type: "castle" })));
    await assert.rejects(submit(sampleLead({ phone: "abc", email: "" })));
    await assert.rejects(submit(sampleLead({ email: "not-an-email", phone: "" })));
  });

  test("ボット（見えない入力欄に値がある）は保存せず成功を装う", async () => {
    const before = (await pool.query("select count(*)::int n from public.leads")).rows[0].n;
    const r = await submit(sampleLead({ website: "http://spam.example" }));
    assert.equal(r.ok, true);
    assert.equal(r.id, undefined);
    const afterN = (await pool.query("select count(*)::int n from public.leads")).rows[0].n;
    assert.equal(afterN, before);
  });

  test("匿名ユーザーは業者・運営用の関数を呼べない", async () => {
    await assert.rejects(rpc(ANON, "list_open_leads"), /permission denied/);
    await assert.rejects(rpc(ANON, "my_purchases"), /permission denied/);
    await assert.rejects(rpc(ANON, "admin_list_leads"), /permission denied/);
    await assert.rejects(rpc(ANON, "purchase_lead", "gen_random_uuid()"), /permission denied/);
  });
});

describe("不動産会社の登録と審査", () => {
  test("登録直後は未承認で、査定依頼を見られない", async () => {
    const u = await newUser("pending@example.com");
    const me = await rpc(u, "register_partner", "$1::jsonb", [JSON.stringify({
      company_name: "審査中不動産", license_no: "大阪府知事(1)第99999号",
      representative: "審査 待子", phone: "06-0000-0000",
      approved: true, credits: 9999           // 自分で承認・入金しようとしても無視される
    })]);
    assert.equal(me.approved, false);
    assert.equal(me.credits, 0);
    await assert.rejects(rpc(u, "list_open_leads"), /承認済み/);
  });

  test("運営者以外は審査・入金できない", async () => {
    const u = await newUser("sneaky@example.com");
    await rpc(u, "register_partner", "$1::jsonb", [JSON.stringify({
      company_name: "ずる不動産", license_no: "大阪府知事(1)第11111号",
      representative: "ず る", phone: "06-1111-1111"
    })]);
    await assert.rejects(rpc(u, "admin_set_partner_approval", "$1::uuid, true", [u.uid]), /運営者のみ/);
    await assert.rejects(rpc(u, "admin_add_credits", "$1::uuid, 100, 'x'", [u.uid]), /運営者のみ/);
    await assert.rejects(rpc(u, "admin_list_leads"), /運営者のみ/);
  });

  test("承認後に免許番号を変えると、再審査になる", async () => {
    const u = await makeApprovedPartner("relicense@example.com");
    const changed = await rpc(u, "register_partner", "$1::jsonb", [JSON.stringify({
      company_name: "変更不動産", license_no: "国土交通大臣(1)第00002号",
      representative: "代表 一郎", phone: "06-1234-5678"
    })]);
    assert.equal(changed.approved, false);
  });

  test("入金はクレジット履歴に残る", async () => {
    const u = await makeApprovedPartner("ledger@example.com", { credits: 5 });
    const rows = (await pool.query("select amount, reason from public.credit_ledger where partner_id = $1", [u.uid])).rows;
    assert.deepEqual(rows, [{ amount: 5, reason: "初回入金" }]);
  });
});

describe("購入前のプレビューでは個人を特定できない", () => {
  let leadId;
  before(async () => {
    partnerA = await makeApprovedPartner("a@example.com", { credits: 10 });
    leadId = (await submit(sampleLead({ city: "プレビュー市" }))).id;
  });

  test("連絡先・町名・番地・正確な面積と築年は含まれない", async () => {
    const list = await rpc(partnerA, "list_open_leads");
    const item = list.find(x => x.id === leadId);
    assert.ok(item, "一覧に出てくる");
    const json = JSON.stringify(item);
    for (const secret of ["査定 太郎", "090-1234-5678", "taro@example.com", "長田東", "サンプルハイツ", "120.5", "98.2", "1998"]) {
      assert.ok(!json.includes(secret), `プレビューに「${secret}」が含まれている`);
    }
    assert.equal(item.city, "プレビュー市");
    assert.equal(item.land_area_band, "100〜150㎡");
    assert.equal(item.building_area_band, "80〜100㎡");
    assert.equal(item.built_decade, "1990年代");
    assert.equal(item.contact, undefined);
  });
});

describe("購入", () => {
  let leadId;
  before(async () => {
    leadId = (await submit(sampleLead({ city: "購入テスト市" }))).id;
  });

  test("購入するとクレジットが減り、連絡先が開示される", async () => {
    const before = (await rpc(partnerA, "my_partner")).credits;
    const full = await rpc(partnerA, "purchase_lead", "$1::uuid", [leadId]);
    assert.equal(full.contact.name, "査定 太郎");
    assert.equal(full.contact.phone, "090-1234-5678");
    assert.equal(full.town, "長田東2丁目");
    assert.equal(full.buyer_count, 1);
    const afterMe = await rpc(partnerA, "my_partner");
    assert.equal(afterMe.credits, before - afterMe.lead_price);
  });

  test("同じ依頼を二重に購入できない", async () => {
    await assert.rejects(rpc(partnerA, "purchase_lead", "$1::uuid", [leadId]), /購入済み/);
  });

  test("購入済みの依頼は一覧から消え、購入履歴に出る", async () => {
    const list = await rpc(partnerA, "list_open_leads");
    assert.ok(!list.some(x => x.id === leadId));
    const mine = await rpc(partnerA, "my_purchases");
    assert.ok(mine.some(x => x.id === leadId && x.contact.email === "taro@example.com"));
  });

  test("購入していない会社には連絡先が見えない", async () => {
    partnerB = await makeApprovedPartner("b@example.com", { credits: 10 });
    const mine = await rpc(partnerB, "my_purchases");
    assert.ok(!mine.some(x => x.id === leadId));
  });

  test("購入履歴が第三者提供の記録になる（提供先・日時）", async () => {
    const leads = await rpc(ops, "admin_list_leads");
    const l = leads.find(x => x.id === leadId);
    assert.equal(l.buyers.length, 1);
    assert.equal(l.buyers[0].company_name, "a不動産");
    assert.ok(l.buyers[0].purchased_at);
  });
});

describe("提供は最大社数まで", () => {
  test("上限に達すると受付終了になり、それ以上は買えない", async () => {
    const id = (await submit(sampleLead({ city: "上限テスト市" }))).id;
    partnerC = await makeApprovedPartner("c@example.com", { credits: 10 });
    const partnerD = await makeApprovedPartner("d@example.com", { credits: 10 });

    await rpc(partnerA, "purchase_lead", "$1::uuid", [id]);
    await rpc(partnerB, "purchase_lead", "$1::uuid", [id]);
    const third = await rpc(partnerC, "purchase_lead", "$1::uuid", [id]);
    assert.equal(third.status, "closed");
    await assert.rejects(rpc(partnerD, "purchase_lead", "$1::uuid", [id]), /受付を終了/);
    const list = await rpc(partnerD, "list_open_leads");
    assert.ok(!list.some(x => x.id === id));
  });

  test("最後の1枠を2社が同時に買っても、成立するのは1社だけ", async () => {
    const id = (await submit(sampleLead({ city: "同時購入市" }))).id;
    await rpc(partnerA, "purchase_lead", "$1::uuid", [id]);
    await rpc(partnerB, "purchase_lead", "$1::uuid", [id]);
    const e = await makeApprovedPartner("e@example.com", { credits: 10 });
    const f = await makeApprovedPartner("f@example.com", { credits: 10 });

    const results = await Promise.allSettled([
      rpc(e, "purchase_lead", "$1::uuid", [id]),
      rpc(f, "purchase_lead", "$1::uuid", [id])
    ]);
    const ok = results.filter(r => r.status === "fulfilled").length;
    assert.equal(ok, 1, JSON.stringify(results.map(r => r.status)));
    const count = (await pool.query("select count(*)::int n from public.purchases where lead_id = $1", [id])).rows[0].n;
    assert.equal(count, 3);
    // 買えなかった側のクレジットは減っていない
    const credits = (await pool.query("select id, credits from public.partners where id = any($1)", [[e.uid, f.uid]])).rows;
    assert.deepEqual(credits.map(c => c.credits).sort((x, y) => x - y), [9, 10]);
  });
});

describe("その他のルール", () => {
  test("クレジット不足なら購入できず、何も変わらない", async () => {
    const poor = await makeApprovedPartner("poor@example.com", { credits: 1 });
    await rpc(ops, "admin_update_settings", "$1::jsonb", [JSON.stringify({ lead_price: 3 })]);
    try {
      const id = (await submit(sampleLead({ city: "不足市" }))).id;
      await assert.rejects(rpc(poor, "purchase_lead", "$1::uuid", [id]), /クレジットが不足/);
      assert.equal((await rpc(poor, "my_partner")).credits, 1);
      const n = (await pool.query("select buyer_count from public.leads where id = $1", [id])).rows[0].buyer_count;
      assert.equal(n, 0);
    } finally {
      await rpc(ops, "admin_update_settings", "$1::jsonb", [JSON.stringify({ lead_price: 1 })]);
    }
  });

  test("対応エリア外の依頼は見えず、買えない", async () => {
    const tokyo = await makeApprovedPartner("tokyo@example.com", { areas: ["東京都"] });
    const osakaId = (await submit(sampleLead({ city: "エリア外市" }))).id;
    const tokyoId = (await submit(sampleLead({ prefecture: "東京都", city: "エリア内区" }))).id;
    const list = await rpc(tokyo, "list_open_leads");
    assert.ok(!list.some(x => x.id === osakaId));
    assert.ok(list.some(x => x.id === tokyoId));
    await assert.rejects(rpc(tokyo, "purchase_lead", "$1::uuid", [osakaId]), /エリア外/);
  });

  test("有効期限を過ぎた依頼は一覧に出ない", async () => {
    const id = (await submit(sampleLead({ city: "期限切れ市" }))).id;
    await pool.query("update public.leads set created_at = now() - interval '31 days' where id = $1", [id]);
    const list = await rpc(partnerA, "list_open_leads");
    assert.ok(!list.some(x => x.id === id));
    await assert.rejects(rpc(partnerA, "purchase_lead", "$1::uuid", [id]), /受付を終了/);
  });

  test("取り下げると連絡先は消え、購入済みの会社からも見えなくなるが、提供記録は残る", async () => {
    const id = (await submit(sampleLead({ city: "取り下げ市" }))).id;
    await rpc(partnerA, "purchase_lead", "$1::uuid", [id]);
    await rpc(ops, "admin_withdraw_lead", "$1::uuid", [id]);
    const contacts = (await pool.query("select count(*)::int n from public.lead_contacts where lead_id = $1", [id])).rows[0].n;
    assert.equal(contacts, 0);
    const mine = await rpc(partnerA, "my_purchases");
    assert.ok(!mine.some(x => x.id === id));
    const record = (await pool.query("select count(*)::int n from public.purchases where lead_id = $1", [id])).rows[0].n;
    assert.equal(record, 1);
  });

  test("公開の提携先一覧には承認済みの会社名と免許番号だけが出る", async () => {
    const list = await rpc(ANON, "get_public_partners");
    assert.ok(list.length > 0);
    assert.ok(!list.some(x => x.company_name === "審査中不動産"));
    for (const p of list) {
      assert.deepEqual(Object.keys(p).sort(), ["areas", "company_name", "license_no"]);
    }
  });
});
