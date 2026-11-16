/*
 * 利用の記録：どのパックが何回使われたか（パックの作者への分配の元になる）
 * 書類の中身は記録しない。利用者はLINEのIDをそのまま残さず、ハッシュにして残す。
 * SUPABASE_URL と SUPABASE_SERVICE_KEY があれば表にも保存し、なければログに1行出すだけ。
 */
import crypto from "node:crypto";

export function hashUser(userId, salt = "") {
  return crypto.createHash("sha256").update(salt + (userId || "")).digest("hex").slice(0, 16);
}

export function createLedger({ supabaseUrl, supabaseKey, salt = "", fetch = globalThis.fetch, log = console.log } = {}) {
  return {
    async record({ kind, pack = null, userId, detail = null }) {
      const row = { ts: new Date().toISOString(), kind, pack, user_hash: hashUser(userId, salt), detail };
      log(JSON.stringify({ okurudake: row }));
      if (!supabaseUrl || !supabaseKey) return;
      try {
        const r = await fetch(`${supabaseUrl}/rest/v1/okuru_events`, {
          method: "POST",
          headers: { apikey: supabaseKey, authorization: `Bearer ${supabaseKey}`, "content-type": "application/json", prefer: "return=minimal" },
          body: JSON.stringify(row)
        });
        if (!r.ok) log(`ledger: 保存に失敗 ${r.status}`);
      } catch (e) {
        log(`ledger: 保存に失敗 ${e.message}`);   // 記録の失敗で返信を止めない
      }
    }
  };
}
