/*
 * テスト専用：Supabase の API のうち本サイトが使う部分だけを真似る中継サーバー。
 *   /auth/v1/*        … 登録・ログイン（GoTrue 相当、最小限）
 *   /rest/v1/rpc/:fn  … 関数呼び出し（PostgREST 相当）。ロールと JWT を設定して本物の PostgreSQL で実行する
 *   それ以外          … satei/ の静的ファイル（config.js だけはこのサーバーを向くように差し替える）
 *
 * 本番では使わない。ブラウザ上の本物の supabase-js から schema.sql までを通しで検証するためのもの。
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";

export const ANON_KEY = "anon-test-key";
const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
function makeJwt(user) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return b64({ alg: "HS256", typ: "JWT" }) + "." +
    b64({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp }) + ".test";
}
function readJwt(token) {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()); } catch { return null; }
}
const hash = s => createHash("sha256").update(s).digest("hex");

export async function startServer({ database, port = 0 }) {
  const pool = new pg.Pool({ database, max: 8 });
  const refreshTokens = new Map();

  function session(user) {
    const refresh = randomUUID();
    refreshTokens.set(refresh, user);
    return {
      access_token: makeJwt(user), token_type: "bearer", expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh,
      user: { id: user.id, aud: "authenticated", role: "authenticated", email: user.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
    };
  }

  async function body(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const s = Buffer.concat(chunks).toString();
    return s ? JSON.parse(s) : {};
  }
  function send(res, status, data) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(data === undefined ? "" : JSON.stringify(data));
  }

  async function handleAuth(req, res, url) {
    const path = url.pathname.replace("/auth/v1", "");
    if (path === "/signup" && req.method === "POST") {
      const { email, password } = await body(req);
      try {
        const r = await pool.query("insert into auth.users (email, encrypted_password) values ($1, $2) returning id, email",
          [email.toLowerCase(), hash(password)]);
        return send(res, 200, session(r.rows[0]));
      } catch {
        return send(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered", message: "User already registered" });
      }
    }
    if (path === "/token" && req.method === "POST") {
      const grant = url.searchParams.get("grant_type");
      const b = await body(req);
      if (grant === "password") {
        const r = await pool.query("select id, email from auth.users where email = $1 and encrypted_password = $2",
          [String(b.email).toLowerCase(), hash(b.password)]);
        if (!r.rows[0]) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", message: "Invalid login credentials", code: 400, error_code: "invalid_credentials" });
        return send(res, 200, session(r.rows[0]));
      }
      if (grant === "refresh_token") {
        const user = refreshTokens.get(b.refresh_token);
        if (!user) return send(res, 400, { error: "invalid_grant", message: "Invalid Refresh Token" });
        return send(res, 200, session(user));
      }
    }
    if (path === "/user" && req.method === "GET") {
      const claims = readJwt((req.headers.authorization || "").replace(/^Bearer /, ""));
      if (!claims?.sub) return send(res, 401, { message: "invalid JWT" });
      return send(res, 200, { id: claims.sub, aud: "authenticated", role: "authenticated", email: claims.email, app_metadata: {}, user_metadata: {} });
    }
    if (path === "/logout") return send(res, 204);
    return send(res, 404, { message: "not implemented in test server: " + path });
  }

  async function handleRpc(req, res, fn) {
    if (!/^[a-z_]+$/.test(fn)) return send(res, 400, { message: "bad function name" });
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const claims = token && token !== ANON_KEY ? readJwt(token) : null;
    const role = claims?.sub ? "authenticated" : "anon";
    const args = await body(req);
    const names = Object.keys(args).filter(k => /^[a-z_]+$/.test(k));
    const params = names.map(k => (args[k] !== null && typeof args[k] === "object") ? JSON.stringify(args[k]) : args[k]);
    const sql = `select public.${fn}(${names.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as v`;

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${role}`);
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims?.sub ? { sub: claims.sub, role } : { role })]);
      const r = await client.query(sql, params);
      await client.query("commit");
      return send(res, 200, r.rows[0].v);
    } catch (e) {
      await client.query("rollback").catch(() => {});
      const status = e.code === "42501" ? (role === "anon" ? 401 : 403) : 400;
      return send(res, status, { code: e.code, message: e.message, details: null, hint: null });
    } finally {
      client.release();
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/auth/v1/")) return await handleAuth(req, res, url);
      if (url.pathname.startsWith("/rest/v1/rpc/")) return await handleRpc(req, res, url.pathname.split("/").pop());
      if (url.pathname === "/config.js") {
        const origin = `http://localhost:${server.address().port}`;
        res.writeHead(200, { "content-type": TYPES[".js"] });
        return res.end(`window.SATEI_CONFIG=${JSON.stringify({
          SITE_NAME: "不動産かんたん査定", SUPABASE_URL: origin, SUPABASE_ANON_KEY: ANON_KEY,
          OPERATOR: { name: "テスト運営株式会社", address: "大阪府大阪市中央区1-1-1", email: "info@example.com", phone: "06-0000-0000", representative: "代表 太郎" }
        })};`);
      }
      const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const file = normalize(join(ROOT, rel));
      if (!file.startsWith(ROOT) || file.includes("/test/")) return send(res, 404, { message: "not found" });
      const data = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(data);
    } catch (e) {
      if (e.code === "ENOENT") return send(res, 404, { message: "not found" });
      send(res, 500, { message: e.message });
    }
  });

  await new Promise(r => server.listen(port, r));
  return {
    url: `http://localhost:${server.address().port}`,
    pool,
    async close() { await new Promise(r => server.close(r)); await pool.end(); }
  };
}
