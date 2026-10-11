/* ============================================================
 *  サイト設定 — 公開前にここを埋める
 * ============================================================ */
window.SATEI_CONFIG = {
  SITE_NAME: "不動産かんたん査定",

  // Supabase ダッシュボード → Project Settings → API
  //   anon キーは公開前提のキー（データは schema.sql の関数で保護）。
  //   service_role キーは絶対に書かないこと。
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",

  // 運営者情報（プライバシーポリシー・利用規約・フッターに表示される）
  OPERATOR: {
    name: "",        // 例: 株式会社〇〇
    address: "",
    email: "",
    phone: "",
    representative: ""
  }
};
