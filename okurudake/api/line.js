/* Vercel 用の入口：LINE の Webhook URL は https://(あなたのドメイン)/api/line */
import { handleWebhook } from "../src/app.js";
import { createDeps } from "../src/setup.js";

let deps;

export async function POST(request) {
  deps ??= createDeps();
  const { response, done } = await handleWebhook(request, deps);
  await done;   // サーバーレスは応答後に処理が止まるので、終わるまで待つ
  return response;
}

export function GET() {
  return new Response("okurudake is running");
}
