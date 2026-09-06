# JarvisRide

現在地に車両を手配するライドシェア配車アプリ。自動運転ロボタクシーと一般ドライバーを
同じアプリから配車できます。静的ファイルのみで動くため、GitHub Pages にそのまま載ります。

公開先: `https://j-harvard.com/ride/`

## 2つの動作モード

| | ローカルデモモード | オンラインモード |
|---|---|---|
| 条件 | `config.js` が空（初期状態） | `config.js` に Supabase の設定を記入 |
| データの置き場所 | ブラウザの localStorage | Supabase（PostgreSQL） |
| マッチング範囲 | 同じ端末のタブ間のみ | **端末をまたいでマッチング** |
| 画面右上の表示 | ローカル | オンライン |

設定しなくても動きます。まず触ってみて、実際に人と人をつなぐ段階でオンラインにしてください。

## オンラインモードのセットアップ

1. **Supabase でプロジェクトを作成**（無料枠で可）
   https://supabase.com

2. **匿名サインインを有効化**
   ダッシュボード → Authentication → Sign In / Providers → Anonymous sign-ins を ON

3. **テーブルを作成**
   ダッシュボード → SQL Editor に [`schema.sql`](./schema.sql) を貼り付けて実行

4. **接続先を記入**
   Project Settings → API から2つの値を [`config.js`](./config.js) に転記

   ```js
   window.JR_CONFIG = {
     SUPABASE_URL: "https://xxxxxxxxxxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGciOi..."
   };
   ```

   `anon` キーは公開前提のキーです。データは行レベルセキュリティ（RLS）で保護します。
   **`service_role` キーは絶対に記入しないでください。**

5. コミットして push すれば反映されます。画面右上が「オンライン」になれば接続成功です。

## 動作確認

2台の端末（またはPCとスマホ）で `/ride/` を開き、

- 端末A：「乗る」→ 目的地を指定 → **スタンダード** で配車依頼
- 端末B：「運ぶ」→ ドライバー登録 → オンライン → リクエストを受諾

受諾すると端末Aにドライバー名と車両が表示され、車両の現在地が地図上を動きます。
ドライバー側の「GPSで実位置を送信」を ON にすると、擬似走行ではなく端末の実際の
現在地が乗客に配信されます。

## 設計

- **配車の状態遷移**
  `searching → enroute → arrived → onboard → completed`（途中の `cancelled` あり）
- **車両位置を進める端末**
  ロボタクシーは依頼した乗客の端末、一般ドライバーは受諾したドライバーの端末。
  同じ利用者が複数タブを開いた場合は、短命のリースで1タブに絞ります。
- **二重受諾の防止**
  受諾は `status='searching' かつ driver_id is null` を条件にした UPDATE です。
  同時に押されても先着1件だけが成立し、負けた側には「他のドライバーが受諾しました」と表示されます。
- **通信量**
  走行中の位置は画面上は 0.25 秒ごとに滑らかに動かし、サーバーへの送信は 1.5 秒ごとに間引いています。

## ファイル構成

```
ride/
├── index.html    画面（マークアップとスタイル）
├── app.js        アプリ本体
├── store.js      データ層（ローカル / Supabase を同一APIで切り替え）
├── config.js     接続設定（ここを編集する）
├── schema.sql    Supabase のテーブル定義と RLS
└── vendor/       Leaflet と supabase-js（CDN に依存しないよう同梱）
```

## 制約

- 走行はデモとして 8 倍速で再現しています（`app.js` の `SIM_SPEED`）。
- 経路は直線距離に 1.35 を掛けた概算です。実経路探索は未対応。
- 決済は未実装です。
- 地図タイルは CARTO、地名検索は Nominatim（OpenStreetMap）を利用しています。
  いずれも利用規約の範囲内で使用してください。本格運用時は有料プランへの切り替えを推奨します。
