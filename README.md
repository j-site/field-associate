# Field&Associate 株式会社 — コーポレートサイト

建設業に特化したコンサルティング & 業務支援ファーム「Field&Associate株式会社」の
コーポレートサイト（静的サイト）です。GitHub Pages で公開しています。

## 構成

- `index.html` — シングルページサイト本体（HTML/CSS インライン、外部依存はWebフォントのみ）
  - ファーストビュー（キャッチコピー + サービス説明 + CTA）
  - サービス内容（建築工事コンサル / 資料作成代行 / 入札資料作成 / AI業務効率化）
  - お問い合わせフォーム

## お問い合わせフォームの設定（重要）

GitHub Pages は静的ホスティングのためサーバー処理が動きません。フォーム送信は無料の
メール転送サービス [FormSubmit](https://formsubmit.co/) を利用しています。

`index.html` 内の以下を、実際の受信先メールアドレスに書き換えてください:

```html
action="https://formsubmit.co/REPLACE_WITH_YOUR_EMAIL@example.com"
```

書き換え後に一度テスト送信すると FormSubmit から確認メールが届き、承認すると有効化されます。

## 公開URL

- https://j-site.github.io/field-associate/

独自ドメイン取得後は、リポジトリ Settings → Pages の Custom domain で差し替えできます
（`CNAME` ファイルを追加）。
