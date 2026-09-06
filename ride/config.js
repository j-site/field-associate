/* ============================================================
 *  JarvisRide 接続設定
 *
 *  下の2つを埋めると「オンラインモード」になり、
 *  別々の端末どうしで配車のマッチングができるようになります。
 *  空のままだと、この端末の中だけで完結する「ローカルデモモード」で動作します。
 *
 *  取得場所: Supabase ダッシュボード → Project Settings → API
 *    SUPABASE_URL      … Project URL
 *    SUPABASE_ANON_KEY … Project API keys の anon / public
 *
 *  anon キーは公開前提のキーです（行レベルセキュリティで保護します）。
 *  service_role キーは絶対にここへ書かないでください。
 *  セットアップ手順は ride/README.md、テーブル定義は ride/schema.sql を参照。
 * ============================================================ */
window.JR_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: ""
};
