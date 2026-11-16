import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { handleWebhook, TEXT } from "../src/app.js";
import { createLine, splitText, verifySignature } from "../src/line.js";
import { createAI } from "../src/ai.js";
import { createLedger, hashUser } from "../src/ledger.js";
import { loadPacks, parsePack } from "../src/packs.js";

const SECRET = "test-secret";
const sign = body => crypto.createHmac("sha256", SECRET).update(body).digest("base64");

/* LINE と Claude を偽物に差し替えて、やり取りを記録する */
function harness({ aiText = "PACK: ooya\n【これは何か】\n家賃の明細です。", stopReason = "end_turn", replyFails = false, contentType = "image/jpeg" } = {}) {
  const calls = { line: [], claude: [], logs: [] };
  const fetch = async (url, init = {}) => {
    calls.line.push({ url, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes("/content")) return new Response(Buffer.from("FAKE"), { headers: { "content-type": contentType } });
    if (url.endsWith("/message/reply") && replyFails) return new Response("Invalid reply token", { status: 400 });
    return new Response("{}");
  };
  const client = { beta: { messages: { create: async params => {
    calls.claude.push(params);
    return { stop_reason: stopReason, content: [{ type: "thinking", thinking: "" }, { type: "text", text: aiText }] };
  } } } };
  const deps = {
    channelSecret: SECRET,
    line: createLine({ token: "t", fetch }),
    ai: createAI({ client }),
    ledger: createLedger({ log: l => calls.logs.push(l) }),
    packs: loadPacks()
  };
  const send = async (events, signature) => {
    const body = JSON.stringify({ events });
    const request = new Request("http://x/api/line", { method: "POST", headers: { "x-line-signature": signature ?? sign(body) }, body });
    const { response, done } = await handleWebhook(request, deps);
    await done;
    return response;
  };
  const sent = () => calls.line.filter(c => /message\/(reply|push)$/.test(c.url));
  return { calls, send, sent };
}

const event = message => ({ type: "message", replyToken: "r1", source: { userId: "U123" }, message });

test("署名が違う依頼は受け付けず、AIも呼ばない", async () => {
  const h = harness();
  const res = await h.send([event({ type: "text", text: "こんにちは" })], "bad");
  assert.equal(res.status, 401);
  assert.equal(h.calls.claude.length, 0);
  assert.equal(verifySignature("a", sign("a"), SECRET), true);
  assert.equal(verifySignature("a", sign("b"), SECRET), false);
  assert.equal(verifySignature("a", null, SECRET), false);
});

test("写真を送ると、合うパックで読み解いた結果が返り、利用が記録される", async () => {
  const h = harness();
  const res = await h.send([event({ type: "image", id: "m1" })]);
  assert.equal(res.status, 200);

  const params = h.calls.claude[0];
  assert.equal(params.model, "claude-fable-5-2");
  assert.equal(params.fallbacks, "default");
  assert.deepEqual(params.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(params.messages[0].content[0].type, "image");
  assert.equal(params.messages[0].content[0].source.data, Buffer.from("FAKE").toString("base64"));
  for (const id of ["general", "ooya", "machikoba", "kenchiku"]) assert.match(params.system[0].text, new RegExp(`<pack id="${id}"`));

  const reply = h.sent()[0];
  assert.match(reply.url, /reply$/);
  assert.equal(reply.body.messages[0].text, "【これは何か】\n家賃の明細です。", "PACK: の行は利用者に見せない");

  const row = JSON.parse(h.calls.logs[0]).okurudake;
  assert.equal(row.kind, "usage");
  assert.equal(row.pack, "ooya");
  assert.equal(row.user_hash, hashUser("U123"));
  assert.ok(!h.calls.logs.join("").includes("U123"), "LINEのIDをそのまま記録しない");
  assert.ok(!h.calls.logs.join("").includes("家賃"), "書類の中身を記録しない");
});

test("PDFは書類として渡し、PDF以外のファイルは断る", async () => {
  const pdf = harness({ contentType: "application/pdf" });
  await pdf.send([event({ type: "file", id: "m2", fileName: "謄本.pdf" })]);
  assert.equal(pdf.calls.claude[0].messages[0].content[0].type, "document");
  assert.equal(pdf.calls.claude[0].messages[0].content[0].source.media_type, "application/pdf");

  const xls = harness({ contentType: "application/vnd.ms-excel" });
  await xls.send([event({ type: "file", id: "m3", fileName: "見積.xls" })]);
  assert.equal(xls.calls.claude.length, 0);
  assert.equal(xls.sent()[0].body.messages[0].text, TEXT.unsupported);
});

test("動画やスタンプには、対応していないと返す", async () => {
  const h = harness();
  await h.send([event({ type: "sticker" })]);
  assert.equal(h.calls.claude.length, 0);
  assert.equal(h.sent()[0].body.messages[0].text, TEXT.unsupported);
});

test("AIが知らないパック名を返したら general として記録する", async () => {
  const h = harness({ aiText: "PACK: nazo\n本文" });
  await h.send([event({ type: "text", text: "この請求書どう思う？" })]);
  assert.equal(JSON.parse(h.calls.logs[0]).okurudake.pack, "general");
  assert.equal(h.sent()[0].body.messages[0].text, "本文");
});

test("友だち追加と「使い方」は、AIを呼ばずに案内を返す", async () => {
  const h = harness();
  await h.send([{ type: "follow", replyToken: "r0", source: { userId: "U123" } }, event({ type: "text", text: "使い方" })]);
  assert.equal(h.calls.claude.length, 0);
  assert.deepEqual(h.sent().map(c => c.body.messages[0].text).sort(), [TEXT.help, TEXT.welcome].sort());
});

test("「パック作成」で仕事の内容を送ると、パックの案が返り、受付が記録される", async () => {
  const pack = "---\nid: tosou\nname: 塗装屋パック\nauthor: 未記入\ndescription: 塗装の注文書\n---\n## よく届く書類\n- 注文書";
  const h = harness({ aiText: pack });
  await h.send([event({ type: "text", text: "パック作成 うちは塗装屋で、元請けから注文書がFAXで届きます。面積と塗料から見積を作ります。" })]);
  assert.ok(!h.calls.claude[0].messages[0].content.startsWith("パック作成"), "合図の言葉は取り除いて渡す");
  assert.equal(h.sent()[0].body.messages[0].text, pack + TEXT.packDone);
  const row = JSON.parse(h.calls.logs[0]).okurudake;
  assert.equal(row.kind, "pack_proposal");
  assert.equal(parsePack(row.detail).id, "tosou", "受け付けた案はそのままパックとして読める");

  const short = harness();
  await short.send([event({ type: "text", text: "パック作成" })]);
  assert.equal(short.calls.claude.length, 0);
  assert.equal(short.sent()[0].body.messages[0].text, TEXT.packNeedsBody);
});

test("返信トークンが切れていたら、プッシュ送信に切り替える", async () => {
  const h = harness({ replyFails: true });
  await h.send([event({ type: "text", text: "保険の更新はいつ？" })]);
  const urls = h.sent().map(c => c.url);
  assert.match(urls[0], /reply$/);
  assert.match(urls[1], /push$/);
  assert.equal(h.sent()[1].body.to, "U123");
});

test("AIが断ったときは、その旨を返し、利用として数えない", async () => {
  const h = harness({ stopReason: "refusal" });
  await h.send([event({ type: "text", text: "何か" })]);
  assert.equal(h.sent()[0].body.messages[0].text, TEXT.refused);
  assert.equal(h.calls.logs.length, 0);
});

test("AIの呼び出しが失敗しても、利用者にはやり直しの案内が届く", async () => {
  const h = harness();
  h.calls.claude.push = () => { throw new Error("overloaded"); };
  const original = console.error; console.error = () => {};
  try { await h.send([event({ type: "text", text: "何か" })]); } finally { console.error = original; }
  assert.equal(h.sent()[0].body.messages[0].text, TEXT.failed);
});

test("長い返事は、LINEの上限に合わせて分けて送る", () => {
  const parts = splitText(("あ".repeat(99) + "\n").repeat(120));
  assert.ok(parts.length > 1 && parts.length <= 5);
  assert.ok(parts.every(p => p.length <= 4900));
  assert.deepEqual(splitText("短い"), ["短い"]);
});

test("付属のパックはすべて読み込めて、id が重複しない", () => {
  const packs = loadPacks();
  assert.deepEqual(packs.map(p => p.id).sort(), ["general", "kenchiku", "machikoba", "ooya"]);
  assert.throws(() => parsePack("見出しなし"), /見出し/);
  assert.throws(() => parsePack("---\nid: A B\nname: x\nauthor: x\ndescription: x\n---\n本文"), /半角/);
});
