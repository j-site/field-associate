/* LINE Messaging API の薄いラッパー（署名検証・内容取得・返信） */
import crypto from "node:crypto";

const API = "https://api.line.me/v2/bot";
const DATA = "https://api-data.line.me/v2/bot";
const MAX_TEXT = 4900;      // LINE の上限は 5000 文字
const MAX_MESSAGES = 5;     // 1回の返信で送れる数

export function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/* 長文を LINE の上限に合わせて、なるべく行の切れ目で分ける */
export function splitText(text) {
  const parts = [];
  let rest = text.trim();
  while (rest.length > MAX_TEXT && parts.length < MAX_MESSAGES - 1) {
    let cut = rest.lastIndexOf("\n", MAX_TEXT);
    if (cut < MAX_TEXT / 2) cut = MAX_TEXT;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  parts.push(rest.slice(0, MAX_TEXT));
  return parts;
}

export function createLine({ token, fetch = globalThis.fetch }) {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const post = async (path, body) => {
    const r = await fetch(API + path, { method: "POST", headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`LINE ${path} ${r.status}: ${await r.text()}`);
  };
  const messages = text => splitText(text).map(t => ({ type: "text", text: t }));

  return {
    async getContent(messageId) {
      const r = await fetch(`${DATA}/message/${messageId}/content`, { headers: { authorization: headers.authorization } });
      if (!r.ok) throw new Error(`LINE content ${r.status}`);
      return { data: Buffer.from(await r.arrayBuffer()), mediaType: (r.headers.get("content-type") || "").split(";")[0] };
    },
    /* 返信トークンは短時間で切れるので、失敗したらプッシュ送信に切り替える */
    async send({ replyToken, userId }, text) {
      try {
        await post("/message/reply", { replyToken, messages: messages(text) });
      } catch (e) {
        if (!userId) throw e;
        await post("/message/push", { to: userId, messages: messages(text) });
      }
    },
    async loading(userId) {
      try { await post("/chat/loading/start", { chatId: userId, loadingSeconds: 60 }); } catch { /* 表示だけなので無視 */ }
    }
  };
}
