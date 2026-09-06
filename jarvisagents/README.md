# JarvisAgents 2.0

Claude (Anthropic API) を使ったシンプルなCLIマルチエージェントツールです。
`planner` → `executor` → `reviewer` の3つのエージェントが順番にタスクを処理します。

## セットアップ

```bash
cd jarvisagents
npm install
cp .env.example .env
# .env に ANTHROPIC_API_KEY を設定
export ANTHROPIC_API_KEY=your-api-key-here
```

## 使い方

```bash
# エージェント一覧を表示
node bin/jarvis.js list

# タスクをパイプラインで実行
node bin/jarvis.js run "新機能のリリース計画を立てて"

# モデルを指定
node bin/jarvis.js run "タスク内容" --model claude-sonnet-5
```

グローバルにインストールして `jarvis` コマンドとして使うこともできます。

```bash
npm link
jarvis run "タスク内容"
```
