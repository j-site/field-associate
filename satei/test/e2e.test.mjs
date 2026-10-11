/*
 * 通しの動作確認：本物のブラウザ（Chromium）＋本物の supabase-js ＋本物の schema.sql
 *
 *   PGHOST=/tmp PGPORT=54329 PGUSER=postgres node --test e2e.test.mjs
 *   スクリーンショットは SHOT_DIR（既定: ./screenshots）に保存する
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import pg from "pg";
import { chromium } from "playwright";
import { startServer } from "./e2e-server.mjs";

const DB = "satei_e2e";
const SHOT = process.env.SHOT_DIR || new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(SHOT, { recursive: true });
const read = p => readFileSync(new URL(p, import.meta.url), "utf8");

let server, browser, errors = [];

before(async () => {
  const admin = new pg.Client({ database: "postgres" });
  await admin.connect();
  await admin.query(`drop database if exists ${DB}`);
  await admin.query(`create database ${DB}`);
  await admin.end();
  const c = new pg.Client({ database: DB });
  await c.connect();
  await c.query(read("./supabase-emulation.sql"));
  await c.query(read("../schema.sql"));
  await c.end();

  server = await startServer({ database: DB });
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  await browser?.close();
  await server?.close();
  const admin = new pg.Client({ database: "postgres" });
  await admin.connect();
  await admin.query(`drop database if exists ${DB}`);
  await admin.end();
});

async function page(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "ja-JP" });
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(e.message));
  p.on("dialog", d => d.accept());   // 購入・承認の確認ダイアログは「OK」
  return p;
}

test("一般の方が査定を申し込み、不動産会社が審査を経て購入するまでの一連の流れ", async () => {
  // ---------- 1. 一般の方の申込み（スマホ） ----------
  const home = await page({ width: 390, height: 844 });
  await home.goto(server.url + "/");
  await home.screenshot({ path: SHOT + "01-top-mobile.png" });

  await home.click("text=無料で査定を申し込む");
  // 必須を空のまま進めると止まる
  await home.click("[data-step='1'] [data-next]");
  assert.equal(await home.locator("[data-name='property_type'].error").count(), 1);

  await home.click("label.choice:has-text('一戸建て')");
  await home.selectOption("#prefecture", "大阪府");
  await home.fill("#city", "東大阪市");
  await home.fill("#town", "長田東2丁目");
  await home.fill("#address_detail", "3-5");
  await home.fill("#land_area", "120.5");
  await home.fill("#building_area", "98.2");
  await home.fill("#built_year", "1998");
  await home.fill("#layout", "4LDK");
  await home.click("label.choice:has-text('居住中')");
  await home.click("label.choice:has-text('3ヶ月以内')");
  await home.screenshot({ path: SHOT + "02-form-step1.png", fullPage: true });
  await home.click("[data-step='1'] [data-next]");

  // 電話もメールも無いと止まる
  await home.fill("#name", "査定 太郎");
  await home.click("[data-step='2'] [data-next]");
  assert.equal(await home.locator("#contact-required").isVisible(), true);
  await home.fill("#phone", "090-1234-5678");
  await home.fill("#email", "taro@example.com");
  await home.click("[data-step='2'] [data-next]");

  // 確認画面：同意しないと送れない
  assert.match(await home.locator("#summary").innerText(), /東大阪市 長田東2丁目 3-5/);
  await home.click("#submit-btn");
  assert.equal(await home.locator("#consent-err").isVisible(), true);
  await home.check("#consent");
  assert.equal(await home.locator("#consent-err").isVisible(), false, "同意したらエラー表示は消える");
  await home.screenshot({ path: SHOT + "03-form-confirm.png", fullPage: true });
  await home.click("#submit-btn");
  await home.locator("#done").waitFor({ state: "visible" });
  await home.screenshot({ path: SHOT + "04-form-done.png" });

  // ---------- 2. 不動産会社の登録（審査待ち） ----------
  const partner = await page();
  await partner.goto(server.url + "/partner.html");
  await partner.click("[data-auth-tab='signup']");
  await partner.fill("#auth-email", "sales@osaka-fudosan.example");
  await partner.fill("#auth-password", "password123");
  await partner.click("#auth-submit");
  await partner.locator("#view-register").waitFor({ state: "visible" });
  await partner.fill("#r-company", "大阪テスト不動産株式会社");
  await partner.fill("#r-license", "大阪府知事(2)第54321号");
  await partner.fill("#r-rep", "営業 花子");
  await partner.fill("#r-phone", "06-1234-5678");
  await partner.click("#r-areas label:has-text('大阪府')");
  await partner.click("#register-submit");
  await partner.locator("#view-pending").waitFor({ state: "visible" });
  await partner.screenshot({ path: SHOT + "05-partner-pending.png" });

  // ---------- 3. 運営：審査とクレジット付与 ----------
  const r = await fetch(server.url + "/auth/v1/signup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ops@example.com", password: "adminpass123" })
  });
  const opsId = (await r.json()).user.id;
  await server.pool.query("insert into public.admins (user_id) values ($1)", [opsId]);

  const ops = await page();
  await ops.goto(server.url + "/admin.html");
  await ops.fill("#email", "ops@example.com");
  await ops.fill("#password", "adminpass123");
  await ops.click("#login-form button");
  await ops.locator("#view-admin").waitFor({ state: "visible" });
  await ops.locator("text=大阪テスト不動産株式会社").waitFor();
  await ops.click("button:has-text('承認する')");
  await ops.locator("text=承認済み").waitFor();
  await ops.fill("[data-amount]", "5");
  await ops.fill("[data-reason]", "初回入金 5件分");
  await ops.click("button:has-text('反映')");
  await ops.locator("td:text-is('5')").waitFor();
  await ops.screenshot({ path: SHOT + "06-admin-partners.png", fullPage: true });

  // ---------- 4. 不動産会社：プレビュー → 購入 ----------
  await partner.reload();
  await partner.locator("#view-dashboard").waitFor({ state: "visible" });
  await partner.locator(".lead-card").first().waitFor();
  const preview = await partner.locator("#open-list").innerText();
  assert.match(preview, /大阪府 東大阪市/);
  assert.match(preview, /100〜150㎡/);
  for (const secret of ["査定 太郎", "090-1234-5678", "taro@example.com", "長田東", "120.5", "1998"]) {
    assert.ok(!preview.includes(secret), `購入前に「${secret}」が見えている`);
  }
  assert.equal((await partner.locator("#credits").innerText()).trim(), "5");
  await partner.screenshot({ path: SHOT + "07-partner-open-leads.png", fullPage: true });

  await partner.click("[data-buy]");
  await partner.locator("text=受付中の査定依頼はありません").waitFor();
  assert.equal((await partner.locator("#credits").innerText()).trim(), "4");

  await partner.click("[data-tab='mine']");
  await partner.locator("#mine-list .lead-card").waitFor();
  const bought = await partner.locator("#mine-list").innerText();
  assert.match(bought, /査定 太郎/);
  assert.match(bought, /090-1234-5678/);
  assert.match(bought, /東大阪市 長田東2丁目 3-5/);
  await partner.screenshot({ path: SHOT + "08-partner-purchased.png", fullPage: true });

  // ---------- 5. 運営：提供記録の確認 ----------
  await ops.click("[data-tab='leads']");
  await ops.locator("#leads-body >> text=大阪テスト不動産株式会社").waitFor();
  await ops.screenshot({ path: SHOT + "09-admin-leads.png", fullPage: true });

  // ---------- 6. 公開の提携先一覧に出る ----------
  const pub = await page();
  await pub.goto(server.url + "/partners.html");
  await pub.locator("text=大阪テスト不動産株式会社").waitFor();
  assert.ok(!(await pub.locator("body").innerText()).includes("営業 花子"), "担当者名は公開しない");

  assert.deepEqual(errors, [], "ブラウザでエラーが出ていない");
});

test("未承認の不動産会社は、画面を操作しても査定依頼を見られない", async () => {
  const p = await page();
  await p.goto(server.url + "/partner.html");
  await p.click("[data-auth-tab='signup']");
  await p.fill("#auth-email", "unapproved@example.com");
  await p.fill("#auth-password", "password123");
  await p.click("#auth-submit");
  await p.locator("#view-register").waitFor({ state: "visible" });
  // 画面を経由せず、ブラウザから直接APIを呼んでも拒否される
  const result = await p.evaluate(async () => {
    const r = await window.Satei.db().rpc("list_open_leads");
    return r.error && r.error.message;
  });
  assert.match(result, /承認済み/);
});
