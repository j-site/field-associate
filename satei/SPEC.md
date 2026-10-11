# 不動産かんたん査定 — 完成版 実装仕様書

版：1.0（2026-10-11）　対象：`satei/` 一式

この仕様書は、実装者（AI・人間）が**判断に迷わず最後まで作り切れる**ことを目的とする。
書かれていないことを独自に追加しない。迷ったら「0. 実装者への指示」に従う。

---

## 0. 実装者への指示

1. **既存実装を土台にする。** `satei/` には動作・テスト済みの実装がある（下記「1. 現状」）。作り直さず、差分で拡張する。
2. **順番を守る。** 「12. 実装順序」のフェーズ順に進め、各フェーズの完了条件をすべて満たしてから次へ進む。
3. **テストを先に書く。** 新しいSQL関数は、`test/sql.test.js` にテストを追加してから実装する。既存の41件のテストは、最後まで1件も壊さない。
4. **技術を増やさない。** フロントは素のHTML/CSS/JavaScript（ビルドなし）のまま。フレームワーク・バンドラ・CSSライブラリを入れない。サーバー処理は Supabase（PostgreSQL関数 と Edge Functions）だけで行う。
5. **データアクセスの原則を崩さない。** テーブルに直接アクセスさせない。すべて `security definer` の関数経由で、関数の中で権限を判定する（「4. データ設計の原則」）。
6. **秘密情報をコードに書かない。** Stripe・Resend・Turnstile の秘密鍵は Supabase の Secrets（環境変数）に置く。`config.js` に書いてよいのは公開前提の値（Supabase URL・anon キー・Turnstile のサイトキー・Stripe の公開キー）だけ。
7. **決めていない値は設定にする。** 「11. 運営者が決める事項」の値はコードに埋め込まず、`settings` テーブルか `config.js` から読む。
8. **完了報告**では、フェーズごとに「実装した内容」「追加したテスト件数と結果」「運営者が対応すべき残作業」を書く。

---

## 1. 現状（実装済み・テスト済み）

| 区分 | 内容 | ファイル |
|---|---|---|
| 一般向け | 3ステップの査定申込み（物件→連絡先→確認と同意）、完了画面、FAQ | `index.html` `js/form.js` |
| 業者向け | メール＋パスワード登録、会社情報登録、審査待ち、受付中一覧（プレビュー）、購入、購入済み、CSV | `partner.html` `js/partner.js` |
| 運営 | 業者の承認・取消、クレジット増減、依頼一覧（提供先つき）、取り下げ、設定 | `admin.html` `js/admin.js` |
| 公開 | 提携会社一覧、プライバシーポリシー（草案）、利用規約（草案） | `partners.html` `privacy.html` `terms.html` |
| DB | テーブル7、関数22、RLS全面有効・直接権限なし | `schema.sql` |
| テスト | DB 39件、ブラウザ通し 2件（計41件） | `test/` |

既存の主な業務ルール（変更しない）：
- 1件の依頼は最大 `settings.max_buyers` 社（既定3）まで販売。上限到達で `status='closed'`
- 購入前プレビューは「都道府県・市区町村・面積の幅・築年代・間取り・現況・売却時期」のみ
- 連絡先（氏名・電話・メール・番地・連絡方法・時間帯・備考）は購入した会社にだけ開示
- 購入は `leads → partners` の順に行ロック。最後の1枠の同時購入でも成立は1社
- `purchases` が第三者提供の記録を兼ねる
- 取り下げ時は `lead_contacts` を削除、`purchases` は残す

---

## 2. 完成形のサイト構成

### 2-1. ページ一覧

`★` が今回の新規、`△` が既存ページの改修、無印は既存のまま。

| パス | 対象 | 状態 | 概要 |
|---|---|---|---|
| `/index.html` | 一般 | △ | 査定申込み。Turnstile、受付番号の表示、自動概算（フェーズ3） |
| `/withdraw.html` | 一般 | ★ | 申込みの取り下げ（受付番号＋電話/メールで本人確認） |
| `/about.html` | 一般 | ★ | 運営者情報（会社概要） |
| `/partners.html` | 一般 | | 提携会社一覧 |
| `/privacy.html` | 一般 | △ | 取り下げページへの導線、保存期間、委託先の追記 |
| `/terms.html` | 一般 | △ | 無効申請・返金の条項を追加 |
| `/area/{pref}/index.html` | 一般 | ★（フェーズ3） | 都道府県別のSEO用ページ（47） |
| `/partner.html` | 業者 | △ | タブ追加：クレジット購入／無効申請／通知設定 |
| `/partner-terms.html` | 業者 | ★ | 提携会社向け規約（料金・無効申請・禁止事項） |
| `/admin.html` | 運営 | △ | タブ追加：概況／無効申請／要確認（重複）／入金履歴／提供記録の出力 |
| `/404.html` | — | ★ | 見つからないページ |
| `/sitemap.xml` `/robots.txt` | — | ★ | 検索エンジン向け（admin・partner は除外） |

### 2-2. 全ページ共通

- ヘッダー：ロゴ（`SITE_NAME`）、右側に「不動産会社の方へ」（一般ページ）
- フッター：利用規約／プライバシーポリシー／提携不動産会社一覧／運営者情報／申込みの取り下げ／不動産会社の方へ、運営者名
- `<title>` と `<meta name="description">` はページごとに固有。OGP（`og:title` `og:description` `og:type` `og:url` `og:image`）を一般ページに付与
- `admin.html` `partner.html` は `<meta name="robots" content="noindex, nofollow">`
- 文字コード UTF-8、`<html lang="ja">`、ビューポート設定
- 色・余白は `css/style.css` の変数のみを使う（新しい色を直接書かない）

---

## 3. 用語と状態

### 3-1. 依頼（lead）の状態

| 値 | 表示名 | 意味 | 一覧に出るか |
|---|---|---|---|
| `review` | 要確認 ★ | 重複の疑いがあり運営の確認待ち | 出ない |
| `open` | 受付中 | 販売中 | 出る（期限内・上限未満・未購入・エリア内） |
| `closed` | 受付終了 | 上限社数に到達 | 出ない |
| `withdrawn` | 取り下げ | 本人の申し出により取り下げ | 出ない（購入済みの会社からも非表示） |
| `invalid` | 無効 ★ | 虚偽・いたずら・重複と運営が判断 | 出ない（購入済みの会社には「無効」と表示） |

状態遷移（これ以外の遷移は関数で拒否する）：

```
submit ──┬─▶ open ──▶ closed
         └─▶ review ──(運営が承認)──▶ open
                    └─(運営が無効化)─▶ invalid
open / closed / review / invalid ──(本人 or 運営)──▶ withdrawn
open / closed ──(無効申請の承認：理由が fake/prank/duplicate)──▶ invalid
```

### 3-2. 無効申請（invalid request）の状態

`pending`（審査中）→ `approved`（承認・返金済み）／ `rejected`（却下）

---

## 4. データ設計の原則（既存を踏襲）

- 全テーブル `enable row level security`、ポリシーなし、`anon`/`authenticated` の権限を `revoke`
- すべての関数は `security definer set search_path = public`
- ファイル末尾で `revoke execute on all functions in schema public from public, anon, authenticated;` の後、必要な関数だけ `grant`
- エラーは `raise exception '日本語メッセージ' using errcode = '...'`。画面はこのメッセージをそのまま表示する
- Edge Functions から呼ぶ関数は `service_role` にのみ `grant` する
- 引数を変える既存関数（`list_open_leads`・`admin_list_leads`）は、**旧シグネチャを `drop function if exists` してから**新しく作る（同名関数が2つ残ると呼び出しが曖昧になる）
- 内部専用の関数（`enqueue_new_lead_notifications` など）は、どのロールにも `grant` しない

---

## 5. データベースの変更（`schema.sql` に追記）

既存テーブルの変更は `alter table ... add column if not exists` で行い、**何度実行しても壊れない**こと。

### 5-1. 既存テーブルの変更

```sql
-- settings
alter table public.settings add column if not exists invalid_request_days int not null default 7
  check (invalid_request_days between 1 and 60);
alter table public.settings add column if not exists duplicate_window_days int not null default 30
  check (duplicate_window_days between 1 and 365);

-- leads
alter table public.leads add column if not exists public_code text;   -- 受付番号（例 S-7K3P9Q）
create unique index if not exists leads_public_code_idx on public.leads (public_code);
alter table public.leads add column if not exists duplicate_of uuid references public.leads(id);
alter table public.leads add column if not exists estimate jsonb;      -- 自動概算（フェーズ3）
alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check
  check (status in ('review','open','closed','withdrawn','invalid'));

-- lead_contacts：重複検知用に正規化した値
alter table public.lead_contacts add column if not exists phone_norm text;  -- 数字のみ
create index if not exists lead_contacts_phone_norm_idx on public.lead_contacts (phone_norm);
create index if not exists lead_contacts_email_idx on public.lead_contacts (email);

-- partners：通知設定
alter table public.partners add column if not exists notify_new_lead boolean not null default true;
```

### 5-2. 新規テーブル

```sql
-- クレジットの販売パッケージ（運営が設定）
create table if not exists public.credit_packages (
  id         text primary key,                       -- 例 'pack5'
  name       text not null,                          -- 例 '5件パック'
  credits    int  not null check (credits > 0),
  price_jpy  int  not null check (price_jpy > 0),    -- 税込
  active     boolean not null default true,
  sort       int  not null default 0
);

-- カード決済の記録（Stripe）
create table if not exists public.credit_purchases (
  id                 bigserial primary key,
  partner_id         uuid not null references public.partners(id) on delete restrict,
  package_id         text not null references public.credit_packages(id),
  credits            int  not null,
  amount_jpy         int  not null,
  stripe_session_id  text not null unique,           -- 二重付与防止のキー
  status             text not null default 'pending' check (status in ('pending','paid','refunded')),
  created_at         timestamptz not null default now(),
  paid_at            timestamptz
);

-- 無効申請
create table if not exists public.invalid_requests (
  id           bigserial primary key,
  purchase_id  bigint not null unique references public.purchases(id) on delete restrict, -- 1購入につき1回
  partner_id   uuid   not null references public.partners(id),
  lead_id      uuid   not null references public.leads(id),
  reason       text   not null check (reason in ('fake','prank','duplicate','unreachable','not_owner','other')),
  detail       text   not null check (char_length(detail) between 10 and 1000),
  status       text   not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note   text   check (char_length(admin_note) <= 1000),
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid
);

-- 送信待ちメール（Edge Function が定期的に送る）
create table if not exists public.email_outbox (
  id          bigserial primary key,
  to_email    text not null,
  template    text not null,      -- 「8. メール」のテンプレートID
  params      jsonb not null default '{}',
  status      text not null default 'queued' check (status in ('queued','sent','failed')),
  attempts    int  not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists email_outbox_queued_idx on public.email_outbox (status, created_at);

-- 取り下げの記録（誰がいつ行ったか）
create table if not exists public.withdrawals (
  id          bigserial primary key,
  lead_id     uuid not null references public.leads(id),
  requested_by text not null check (requested_by in ('applicant','admin')),
  created_at  timestamptz not null default now()
);
```

新規テーブルもすべて `enable row level security` と `revoke all ... from anon, authenticated` の対象に加える。

### 5-3. 受付番号

- 形式：`S-` ＋ 英大文字と数字6文字。紛らわしい `0 O 1 I L` は使わない（使用文字：`23456789ABCDEFGHJKMNPQRSTUVWXYZ`）
- `submit_lead` 内で生成し、衝突したら最大5回まで再生成。5回とも衝突したら例外
- 既存行に `public_code` が無い場合は、マイグレーションで付与する

---

## 6. 関数（RPC）の仕様

表記：`関数名(引数) → 戻り値`　【実行できるロール】

### 6-1. 変更する既存関数

**`submit_lead(p jsonb) → jsonb`**　【service_role のみ】（anon から外す）
- 呼び出し元は Edge Function `submit-lead`（Turnstile 検証済み）だけになる
- 既存の検証に加え：
  - `phone_norm` に電話番号の数字のみを保存
  - **重複判定**：`duplicate_window_days` 日以内に、同じ `phone_norm` または同じ `email` の依頼（`withdrawn` 以外）があれば `status='review'`、`duplicate_of` に最新の該当依頼IDを入れる。なければ `status='open'`
  - `public_code` を生成
- 戻り値：`{ "ok": true, "public_code": "S-XXXXXX" }`（UUIDは返さない）
- `status='open'` で作成された場合、対応エリアの通知対象業者へ `new_lead` メールを `email_outbox` に積む（6-4 `enqueue_new_lead_notifications`）
- 依頼者のメールがあれば `applicant_received` メールを積む
- ボット対策欄（`website`）に値がある場合は、保存もメール送信もせず `{ "ok": true, "public_code": null }`

**`list_open_leads(p jsonb default '{}') → jsonb`**　【authenticated】
- 引数で絞り込み（すべて任意）：`property_types text[]`、`prefectures text[]`、`sale_timings text[]`
- 絞り込みは「業者の対応エリア」との **AND**（エリア外が出ることはない）
- 並び順：新しい順。最大200件

**`my_purchases() → jsonb`**　【authenticated】
- 各要素に `purchase_id`、`invalid_request`（`null` か `{status, reason, created_at}`）、`can_request_invalid`（期限内かつ未申請かつ依頼が `withdrawn` でない）を追加
- `invalid` の依頼も返す（連絡先つき、`status:'invalid'`）。`withdrawn` は従来どおり返さない

**`admin_withdraw_lead(p_lead_id uuid) → jsonb`**　【authenticated・運営】
- `withdrawals` に `requested_by='admin'` で記録
- 購入済みの各社に `lead_withdrawn` メールを積む

**`admin_list_leads(p jsonb default '{}') → jsonb`**　【authenticated・運営】
- 絞り込み：`status text`、`q text`（受付番号・市区町村・氏名・電話の部分一致）。最大500件
- 各要素に `public_code`、`duplicate_of`、`invalid_requests`（件数と状態）を追加

### 6-2. 新規関数（一般の方）

**`request_withdrawal(p_code text, p_contact text) → jsonb`**　【service_role のみ】（Edge Function `withdraw` 経由）
- `p_code` は大文字化・前後空白除去して照合
- `p_contact` は「電話番号（数字のみに正規化して `phone_norm` と比較）」または「メール（小文字化して比較）」のどちらか
- 一致しない・依頼が無い・すでに取り下げ済みの場合は、**どれも同じ**メッセージで例外：`受付番号とご連絡先が一致する申込みが見つかりませんでした`（どちらが違うかを教えない）
- 一致したら：`status='withdrawn'`、`lead_contacts` 削除、`withdrawals` に `requested_by='applicant'`、購入済みの各社に `lead_withdrawn` を積む。依頼者のメールが分かっていれば、**削除前に** `applicant_withdrawn` を積む
- 戻り値：`{ "ok": true }`

### 6-3. 新規関数（不動産会社）

**`list_credit_packages() → jsonb`**　【authenticated】`active` のものを `sort` 順で返す

**`my_credit_history() → jsonb`**　【authenticated】自社の `credit_ledger` を新しい順に最大200件

**`request_invalid(p_purchase_id bigint, p_reason text, p_detail text) → jsonb`**　【authenticated】
拒否条件と例外メッセージ（上から順に判定）：

| 条件 | メッセージ | errcode |
|---|---|---|
| 未ログイン | `ログインが必要です` | 28000 |
| 自社の購入でない | `購入履歴が見つかりません` | P0002 |
| 購入から `invalid_request_days` 日を超過 | `無効申請の期限（購入から◯日）を過ぎています` | P0001 |
| すでに申請済み | `この購入はすでに無効申請済みです` | 23505 |
| 依頼が `withdrawn` | `取り下げ済みの依頼は無効申請できません` | P0001 |
| `detail` が10文字未満 | `申請理由の詳細を10文字以上で入力してください` | 22023 |

成功時：`invalid_requests` に `pending` で登録。運営宛てに `admin_invalid_request` を積む。戻り値 `{ ok, id }`

**`update_notification_settings(p_notify_new_lead boolean) → jsonb`**　【authenticated】

### 6-4. 新規関数（運営）

すべて先頭で `perform require_admin();`

| 関数 | 内容 |
|---|---|
| `admin_dashboard() → jsonb` | 今日・今月の依頼数、販売数、売上クレジット、受付中件数、審査待ち業者数、無効申請の審査待ち数、要確認の依頼数 |
| `admin_list_invalid_requests(p_status text default 'pending') → jsonb` | 申請一覧（依頼のプレビュー・連絡先・申請者・理由・詳細） |
| `admin_decide_invalid(p_id bigint, p_approve boolean, p_note text) → jsonb` | 下記 |
| `admin_release_review(p_lead_id uuid) → jsonb` | `review` → `open`。この時点で `new_lead` 通知を積む |
| `admin_mark_invalid(p_lead_id uuid, p_note text) → jsonb` | `review`/`open`/`closed` → `invalid` |
| `admin_list_credit_purchases() → jsonb` | カード決済の履歴 |
| `admin_upsert_package(p jsonb) → jsonb` | パッケージの追加・更新（`id,name,credits,price_jpy,active,sort`） |
| `admin_export_provision_records(p_from date, p_to date) → jsonb` | 第三者提供の記録（提供日時・提供先会社名・免許番号・受付番号・依頼者氏名※）。※取り下げで削除済みなら `（削除済み）` |

**`admin_decide_invalid` の処理（1トランザクション）**
- 対象が `pending` でなければ例外 `この申請はすでに処理されています`
- 承認時：
  1. 申請の `status='approved'`、`decided_at`・`decided_by`・`admin_note` を記録
  2. 購入時の `price` を、その会社の `credits` に戻し、`credit_ledger` に `+price` / 理由 `無効申請の承認（受付番号 S-XXXXXX）`
  3. 理由が `fake` `prank` `duplicate` のいずれかなら、依頼を `invalid` にする（以後の販売停止）
  4. 申請した会社に `invalid_decided` メール（承認）を積む
- 却下時：`status='rejected'`、記録、`invalid_decided`（却下・`admin_note` を本文に含める）を積む
- **`leads.buyer_count` は戻さない**（枠を再販売しない。同じ依頼者に4社目から連絡が行くのを防ぐため）

### 6-5. 新規関数（Edge Function 専用・service_role のみ）

| 関数 | 内容 |
|---|---|
| `grant_purchased_credits(p_session_id text, p_partner_id uuid, p_package_id text, p_amount_jpy int) → jsonb` | `credit_purchases` を `paid` にし、クレジット付与と `credit_ledger` 記録。**同じ `session_id` で2回呼ばれても1回分しか付与しない**。`amount_jpy` がパッケージ価格と一致しなければ例外 |
| `create_pending_purchase(p_partner_id uuid, p_package_id text, p_session_id text) → jsonb` | Checkout 作成時に `pending` で記録 |
| `claim_outbox(p_limit int) → jsonb` | `queued` かつ `attempts < 5` を古い順に取り出し `attempts+1`（`for update skip locked`） |
| `finish_outbox(p_id bigint, p_ok boolean, p_error text) → jsonb` | 送信結果を記録。5回失敗で `failed` |
| `enqueue_new_lead_notifications(p_lead_id uuid) → void` | 承認済み・`notify_new_lead=true`・エリア一致（またはエリア未設定）の業者に `new_lead` を積む（内部用。`submit_lead` と `admin_release_review` から呼ぶ） |

---

## 7. Edge Functions（`supabase/functions/` に新規作成、Deno）

共通：
- CORS は `config` で許可したオリジン（本番ドメイン）のみ
- 入力は必ず検証し、失敗時は `{ "error": "日本語メッセージ" }` と適切なステータス
- DB には `SUPABASE_SERVICE_ROLE_KEY` で接続し、上記の service_role 専用関数だけを呼ぶ
- 秘密情報は `Deno.env.get()` から読む

| 関数 | 呼び出し元 | 処理 |
|---|---|---|
| `submit-lead` | `index.html` | ① Turnstile トークンを `https://challenges.cloudflare.com/turnstile/v0/siteverify` で検証（失敗時 400 `確認に失敗しました。もう一度お試しください`）② `submit_lead` を呼ぶ ③ 結果をそのまま返す |
| `withdraw` | `withdraw.html` | Turnstile 検証 → `request_withdrawal` |
| `create-checkout` | `partner.html` | ログイン中の業者のJWTを検証 → 承認済みか確認 → Stripe Checkout Session を作成（`mode=payment`、`currency=jpy`、`metadata: partner_id, package_id`、成功時 `partner.html?paid=1`、キャンセル時 `partner.html?canceled=1`）→ `create_pending_purchase` → `{ url }` を返す |
| `stripe-webhook` | Stripe | 署名を `STRIPE_WEBHOOK_SECRET` で検証（失敗は 400）→ `checkout.session.completed` かつ `payment_status=paid` のときだけ `grant_purchased_credits` → 常に 200（処理済みでも） |
| `process-outbox` | pg_cron（毎分） | `claim_outbox(50)` → テンプレートで本文生成 → Resend API（`POST https://api.resend.com/emails`）で送信 → `finish_outbox` |

Secrets（運営者が Supabase に設定）：
`TURNSTILE_SECRET_KEY` `STRIPE_SECRET_KEY` `STRIPE_WEBHOOK_SECRET` `RESEND_API_KEY` `MAIL_FROM` `SITE_URL` `ALLOWED_ORIGIN`

pg_cron の登録（`schema.sql` 末尾にコメントで手順を記載。実行は運営者）：
毎分 `net.http_post` で `process-outbox` を呼ぶ。

---

## 8. メール

本文はプレーンテキスト。テンプレートは `supabase/functions/_shared/templates.ts` に集約。全メール末尾に運営者名・問い合わせ先・`SITE_URL` を入れる。

| ID | 宛先 | 件名 | 本文に含めるもの | 含めてはいけないもの |
|---|---|---|---|---|
| `applicant_received` | 依頼者 | 【{SITE_NAME}】査定のお申込みを受け付けました | 受付番号、最大◯社から連絡が来ること、取り下げページURL | — |
| `applicant_withdrawn` | 依頼者 | 【{SITE_NAME}】お申込みを取り下げました | 受付番号、提供済みの会社には停止を依頼したこと | — |
| `new_lead` | 業者 | 【{SITE_NAME}】新しい査定依頼（{都道府県}{市区町村}） | プレビュー情報のみ、`partner.html` のURL | **氏名・電話・メール・町名・番地** |
| `lead_withdrawn` | 購入した業者 | 【{SITE_NAME}】査定依頼の取り下げ（受付番号 {code}） | 受付番号、以後の連絡・利用を停止すること | 依頼者の連絡先 |
| `invalid_decided` | 申請した業者 | 【{SITE_NAME}】無効申請の結果 | 承認／却下、返還クレジット数、運営コメント | — |
| `admin_invalid_request` | 運営（`config` の通知先） | 【運営】無効申請が届きました | 受付番号、理由、管理画面URL | — |

---

## 9. 画面の仕様

### 9-1. `index.html`（改修）

- 送信ボタンの直前に Turnstile ウィジェット（`config.js` の `TURNSTILE_SITE_KEY`）
- 送信先を `rpc('submit_lead')` から Edge Function `submit-lead` に変更（`fetch`、JSON）
- 完了画面に **受付番号を大きく表示**し、「取り下げの際に必要です。控えてください」と添える
- 完了画面に `withdraw.html` へのリンク
- `config.js` に Turnstile キーが無い場合は、送信ボタンを無効にし「設定が完了していません」と表示（本番で Turnstile なしで動かさない）

入力項目と検証（既存。変更しない）：

| 項目 | 必須 | 検証 |
|---|---|---|
| 物件の種類 | ○ | 5択 |
| 都道府県 | ○ | 47択 |
| 市区町村 | ○ | 1〜40文字 |
| 町名・丁目 | | 〜60文字 |
| 番地・建物名 | | 〜120文字（購入した会社のみ開示） |
| 土地面積 | | 0超〜100万未満、種類が「区分マンション」のとき非表示 |
| 建物/専有面積 | | 0超〜100万未満、種類が「土地」のとき非表示 |
| 築年 | | 1900〜今年、「土地」のとき非表示 |
| 間取り | | 〜20文字、「土地」のとき非表示 |
| 現況 | | 4択 |
| 売却時期 | ○ | 5択 |
| お名前 | ○ | 1〜60文字 |
| 電話 | △ | `^[0-9+\-() ]{10,20}$` |
| メール | △ | 形式チェック、〜200文字 |
| （電話かメールのどちらか必須） | ○ | |
| 連絡方法 | | 3択、既定「どちらでも」 |
| 時間帯 | | 〜60文字 |
| 備考 | | 〜1000文字 |
| 同意 | ○ | チェック必須 |

### 9-2. `withdraw.html`（新規）

- 見出し「お申込みの取り下げ」
- 入力：受付番号（`S-` 付き・無しどちらも受け付け、自動で大文字化）、申込み時の電話番号またはメールアドレス
- Turnstile
- 送信 → 成功：「取り下げました。ご連絡先を削除し、情報を提供した会社には利用の停止を依頼しました。」
- 失敗：Edge Function のメッセージをそのまま表示
- 受付番号が分からない人向けに、お問い合わせ窓口（運営者メール）を併記

### 9-3. `partner.html`（改修）

ダッシュボードのタブを次の5つにする：

1. **受付中の査定依頼**：既存＋絞り込み（物件種別・売却時期のチェックボックス。都道府県は対応エリアが複数のときだけ表示）
2. **購入済み**：既存＋各カードに「無効申請」ボタン（`can_request_invalid` が真のときだけ）。申請済みなら状態バッジ（審査中／承認・返還済み／却下）。依頼が `invalid` なら「無効（運営判断）」バッジ
3. **クレジット購入**：パッケージをカードで並べる（件数・価格・1件あたり単価）。購入ボタン → `create-checkout` → Stripe へ遷移。`?paid=1` で戻ったら「お支払いを確認しています」と表示し、5秒ごとに最大6回 `my_partner` を再取得して残高が増えたら完了表示。下に `my_credit_history` の一覧
4. **通知設定**：新着依頼メールのオン／オフ
5. **会社情報**：既存の登録フォームを流用（免許番号変更で再審査になる旨の注意つき）

無効申請ダイアログ：理由（6択のラジオ：虚偽の情報／いたずら／重複／連絡がつかない／所有者・権限者ではない／その他）、詳細（10文字以上・必須）、期限（「購入から◯日以内」）を表示。

### 9-4. `admin.html`（改修）

タブを次の順にする：

1. **概況**：`admin_dashboard` の数値をカードで表示
2. **不動産会社**：既存
3. **査定依頼**：既存＋状態フィルタ、検索、受付番号の表示、「無効にする」ボタン
4. **要確認**：`status='review'` の一覧。重複元の依頼（受付番号・受付日時・状態）を並べて表示し、「販売を開始」「無効にする」
5. **無効申請**：審査待ちを上に。承認／却下（却下時はコメント必須）
6. **入金**：カード決済の履歴、パッケージの編集
7. **提供記録**：期間を指定してCSVを書き出す（`admin_export_provision_records`）
8. **設定**：既存＋`invalid_request_days`、`duplicate_window_days`

### 9-5. 文言のルール

- 依頼者に「必ず売れる」「最高額」など断定的な表現を使わない
- 「無料」と書くのは依頼者の利用料についてのみ
- 「最大◯社」は必ず `settings.max_buyers` から表示する（数字を直書きしない）
- エラーは「何が起きたか＋どうすればよいか」を1文で

---

## 10. 非機能要件

| 項目 | 要件 |
|---|---|
| 対応環境 | iOS Safari・Android Chrome・PC の Chrome/Edge/Safari 最新版。幅 360px で横スクロールが出ないこと |
| アクセシビリティ | すべての入力に `<label>`、エラーは色だけでなく文言で示す、キーボードだけで申込みが完了できる、文字と背景のコントラスト比 4.5:1 以上 |
| 性能 | 一般ページは外部の大きなライブラリを読み込まない（supabase-js と Turnstile のみ）。画像は使う場合 WebP、幅指定 |
| セキュリティ | すべての出力を `esc()` でエスケープ。`innerHTML` に未エスケープの値を入れない。CSPメタタグを一般ページに付与（Supabase・Turnstile・Stripe・自ドメインのみ許可） |
| 個人情報 | 連絡先をブラウザの `localStorage` に保存しない。アクセス解析を入れる場合も、URL・イベントに個人情報を含めない |
| SEO | `sitemap.xml`、`robots.txt`（`/admin.html` `/partner.html` を Disallow）、構造化データ（`Organization`、FAQ に `FAQPage`） |

---

## 11. 運営者が決める事項（実装は既定値で進め、設定で変えられるようにする）

| 事項 | 既定値（仮） | 置き場所 |
|---|---|---|
| サイト名・ドメイン | 不動産かんたん査定 | `config.js` |
| 運営者情報 | 空（未設定表示） | `config.js` |
| 1件あたりのクレジット | 1 | `settings.lead_price` |
| パッケージ | 5件 ¥55,000／10件 ¥99,000／30件 ¥264,000（税込・仮） | `credit_packages` |
| 最大社数 | 3 | `settings.max_buyers` |
| 受付期間 | 30日 | `settings.lead_ttl_days` |
| 無効申請の期限 | 7日 | `settings.invalid_request_days` |
| 重複とみなす期間 | 30日 | `settings.duplicate_window_days` |
| 運営の通知先メール | 空 | `config.js` と Secrets |
| メール送信元 | 空 | Secrets `MAIL_FROM` |

運営者のみが行う作業（実装者は手順書に書くだけ）：Supabase・Stripe・Resend・Cloudflare Turnstile のアカウント作成と鍵の設定、送信ドメインの認証（SPF/DKIM）、適格請求書発行事業者の登録番号を Stripe の領収書に設定、弁護士による規約・ポリシーの確認。

---

## 12. 実装順序と完了条件

### フェーズ1：公開に必要な最低限
1. `schema.sql`：5-1・5-2・5-3、状態 `review`/`invalid`、受付番号、重複判定、`withdrawals`、`email_outbox`
2. 関数：`submit_lead` 改修、`request_withdrawal`、`admin_release_review`、`admin_mark_invalid`、`admin_dashboard`、`admin_export_provision_records`、`enqueue_new_lead_notifications`、`claim_outbox`、`finish_outbox`
3. Edge Functions：`submit-lead`、`withdraw`、`process-outbox`
4. 画面：`index.html` 改修、`withdraw.html`、`about.html`、`404.html`、`admin.html` の概況・要確認・提供記録タブ、`privacy.html` 改修、`sitemap.xml`・`robots.txt`

完了条件：
- 既存41件＋新規テストがすべて成功
- 新規テストに最低限含める：重複時に `review` になる／`review` は一覧に出ない／受付番号の形式と一意性／取り下げは番号と連絡先の両方一致でのみ成功し、失敗メッセージがどの場合も同一／取り下げで購入済み各社に `lead_withdrawn` が積まれる／`new_lead` の `params` に連絡先・町名・番地が含まれない／`anon` が `submit_lead` を直接呼べない
- Edge Functions は Turnstile と Resend を差し替え可能にし、`deno test` で「検証失敗時に DB を呼ばない」「送信失敗で `attempts` が増える」を確認

### フェーズ2：収益化
1. `credit_packages`、`credit_purchases`、`invalid_requests` と関連関数
2. Edge Functions：`create-checkout`、`stripe-webhook`
3. 画面：`partner.html` の5タブ化、`admin.html` の無効申請・入金タブ、`partner-terms.html`、`terms.html` 改修

完了条件：
- 同じ `session_id` の webhook を2回送ってもクレジットは1回分（テスト）
- 金額がパッケージと一致しない webhook は付与しない（テスト）
- 署名が不正な webhook は 400（テスト）
- 無効申請：期限切れ・二重申請・他社の購入・取り下げ済みを拒否、承認で返還と台帳記録、`fake/prank/duplicate` 承認で依頼が `invalid`、`buyer_count` が戻らない（テスト）
- ブラウザ通しテストに「無効申請 → 承認 → 残高が戻る」を追加

### フェーズ3：集客
1. 都道府県別ページ（47）を生成するスクリプト `scripts/build-area-pages.mjs`（テンプレートから静的HTMLを生成、`sitemap.xml` も更新）
2. 自動概算：国土交通省「不動産情報ライブラリ」API（キーは Secrets）から同じ市区町村の取引事例を取得し、中央値ベースの価格帯を完了画面に表示。事例が5件未満なら表示しない。「あくまで目安」と明記
3. 構造化データ

---

## 13. やってはいけないこと

- 成約に連動した料金・報酬の仕組みを作る（宅建業法上の媒介とみなされるおそれ）
- 業者に依頼者と運営の間のやり取り（交渉・条件調整）を代行させる機能を作る
- 購入前の画面・メール・APIレスポンスに、氏名・電話・メール・町名・番地・正確な面積・正確な築年を含める
- 最大社数を超えて販売する、無効承認後に枠を再販売する
- 取り下げ後に連絡先を残す、提供記録を消す
- テーブルに RLS ポリシーを追加して直接アクセスを許す
- 既存テストを削除・無効化して通す

---

## 14. 参考：既存ファイルの責務

| ファイル | 責務 |
|---|---|
| `schema.sql` | テーブル・関数・権限のすべて（唯一の真実） |
| `config.js` | 公開してよい設定値のみ |
| `js/common.js` | 接続、`rpc()`、ラベル、エスケープ、トースト、共通の表示補助 |
| `js/form.js` | 申込みフォーム |
| `js/partner.js` | 業者ページ |
| `js/admin.js` | 運営ページ |
| `test/supabase-emulation.sql` | テスト用に Supabase のロール・`auth.uid()`・既定権限を再現 |
| `test/sql.test.js` | DBのテスト |
| `test/e2e-server.mjs` | テスト用の Supabase API 互換サーバー（本番では使わない） |
| `test/e2e.test.mjs` | ブラウザ通しテスト |

### テスト用データベースの起動（Claude Code のクラウド環境での実績手順）

PostgreSQL 16 が入っている前提。`postgres` ユーザーはスクラッチ領域（`/tmp/claude-*`）に入れないため、データは `/var/lib/postgresql` 配下に置く。

```bash
D=/var/lib/postgresql/satei-test
su postgres -c "mkdir -p $D && /usr/lib/postgresql/16/bin/initdb -D $D/data -U postgres --auth=trust -E UTF8 >/dev/null \
  && /usr/lib/postgresql/16/bin/pg_ctl -D $D/data -o '-p 54329 -k /tmp' -l $D/log.txt start"

cd satei/test && npm install
PGHOST=/tmp PGPORT=54329 PGUSER=postgres node --test sql.test.js
CHROMIUM_PATH=/opt/pw-browsers/chromium PGHOST=/tmp PGPORT=54329 PGUSER=postgres node --test e2e.test.mjs

# 終わったら停止・削除
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $D/data stop" && rm -rf $D
```

### テストの改修について（既存テストを「壊さない」の範囲）

`submit_lead` を `service_role` 専用にすると、既存テストのうち匿名ユーザーで申込みを送っている箇所は呼び出し方を変える必要がある。次の変更は「壊す」に当たらないので行ってよい。**検証している内容（期待値・アサーション）は変えないこと。**

- `test/supabase-emulation.sql` に `service_role` ロールを追加する（Supabase と同じく、`grant` された関数だけ実行できる状態にする）
- `test/sql.test.js` の `submit()` ヘルパーを `service_role` で呼ぶように変える。あわせて「`anon` は `submit_lead` を直接呼べない」テストを追加する
- `test/e2e-server.mjs` に Edge Functions 相当のルート（`/functions/v1/submit-lead`、`/functions/v1/withdraw`、`/functions/v1/create-checkout`、`/functions/v1/stripe-webhook`）を追加する。Turnstile・Stripe・Resend はテスト用のダミーに置き換える
- テスト環境は外部に接続できない前提にする。Turnstile のスクリプト（`challenges.cloudflare.com`）はテスト用サーバーから**常に成功するスタブ**を返し、本物を読み込まない
