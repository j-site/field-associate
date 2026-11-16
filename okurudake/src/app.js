/* LINEのWebhookを受けて、書類を読み解いて返す本体 */
import { verifySignature } from "./line.js";

const MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const PACK_COMMAND = /^(パック作成|ぱっく作成)[\s:：]*/;

export const TEXT = {
  welcome: "友だち追加ありがとうございます。\n\n書類の写真やPDFを、このトークに送ってください。\n・これは何か\n・お金の影響\n・やること、期限\nをまとめて返します。\n\n銀行や保険のお知らせ、見積書、請求書、契約書などに使えます。送信や支払いは行いません。下書きまでを作ります。\n\n「使い方」と送ると、この説明をもう一度表示します。",
  help: "【使い方】\n1. 書類を写真に撮るか、PDFのまま送る\n2. 1分ほどで、要点・お金の影響・やることが届く\n\n文章だけを送っても相談できます。\n\n【自分の仕事の型を登録する】\n「パック作成」に続けて、仕事の内容を書いて送ってください。\n例：パック作成 うちは塗装屋で、元請けから注文書がFAXで届きます。見積は…",
  unsupported: "この種類のデータにはまだ対応していません。書類の写真かPDF、または文章で送ってください。",
  tooLarge: "ファイルが大きすぎます（20MBまで）。ページを分けるか、写真で送ってください。",
  refused: "この内容には対応できませんでした。別の書類でお試しください。",
  failed: "うまく読み取れませんでした。少し時間をおいて、もう一度送ってください。",
  packNeedsBody: "「パック作成」に続けて、仕事の内容を書いて送ってください。\n・どんな書類が届くか\n・それを見て何を判断するか\n・最後に何を作るか（見積、返信、表など）",
  packDone: "\n\n――――――――\nこの内容で業種パックの案を受け付けました。運営者が確認してから登録します。直したい点があれば、もう一度「パック作成」から送ってください。"
};

async function readInput(message, line) {
  if (message.type === "text") return { kind: "text", text: message.text };
  if (message.type !== "image" && message.type !== "file") return null;
  const { data, mediaType } = await line.getContent(message.id);
  if (data.length > MAX_BYTES) return { tooLarge: true };
  if (message.type === "image") return { kind: "image", data, mediaType: IMAGE_TYPES.includes(mediaType) ? mediaType : "image/jpeg" };
  const isPdf = mediaType === "application/pdf" || /\.pdf$/i.test(message.fileName || "");
  return isPdf ? { kind: "pdf", data } : null;
}

async function handleEvent(event, { line, ai, packs, ledger }) {
  const userId = event.source?.userId;
  const to = { replyToken: event.replyToken, userId };
  if (event.type === "follow") return line.send(to, TEXT.welcome);
  if (event.type !== "message") return;

  const message = event.message;
  try {
    if (message.type === "text") {
      const text = message.text.trim();
      if (/^(使い方|つかいかた|ヘルプ|help)$/i.test(text)) return await line.send(to, TEXT.help);
      if (PACK_COMMAND.test(text)) {
        const body = text.replace(PACK_COMMAND, "").trim();
        if (body.length < 20) return await line.send(to, TEXT.packNeedsBody);
        await line.loading(userId);
        const result = await ai.proposePack(body);
        if (result.refused) return await line.send(to, TEXT.refused);
        await ledger.record({ kind: "pack_proposal", userId, detail: result.text });
        return await line.send(to, result.text + TEXT.packDone);
      }
    }

    const input = await readInput(message, line);
    if (!input) return await line.send(to, TEXT.unsupported);
    if (input.tooLarge) return await line.send(to, TEXT.tooLarge);

    await line.loading(userId);
    const result = await ai.analyze({ packs, input });
    if (result.refused) return await line.send(to, TEXT.refused);
    await ledger.record({ kind: "usage", pack: result.packId, userId });
    await line.send(to, result.text);
  } catch (e) {
    console.error("okurudake:", e);
    await line.send(to, TEXT.failed).catch(() => {});
  }
}

/*
 * 戻り値の response はすぐLINEに返す。done は裏で続く処理。
 * サーバーレス（Vercel）では done を待ってから応答し、常駐サーバーでは先に応答する。
 */
export async function handleWebhook(request, deps) {
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-line-signature"), deps.channelSecret)) {
    return { response: new Response("invalid signature", { status: 401 }), done: Promise.resolve() };
  }
  const events = JSON.parse(raw).events || [];
  const done = Promise.all(events.map(e => handleEvent(e, deps))).then(() => {});
  return { response: new Response("ok"), done };
}
