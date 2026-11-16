/* 常駐サーバー用の入口（Vercel 以外で動かすとき）: node server.mjs */
import http from "node:http";
import { handleWebhook } from "./src/app.js";
import { createDeps } from "./src/setup.js";

const deps = createDeps();
const port = Number(process.env.PORT || 3000);

http.createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/api/line")) {
    res.writeHead(200).end("okurudake is running");
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://localhost${req.url}`, { method: "POST", headers: req.headers, body: Buffer.concat(chunks) });
  const { response, done } = await handleWebhook(request, deps);
  res.writeHead(response.status).end(await response.text());   // LINEには先に応答し、読み解きは裏で続ける
  done.catch(e => console.error("okurudake:", e));
}).listen(port, () => console.log(`okurudake: http://localhost:${port}/api/line`));
