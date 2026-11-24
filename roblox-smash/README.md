# スカイ乱闘（仮称）

Roblox で遊べる、ふっ飛ばし合いの対戦アクションです。攻撃を当てて相手の「％」を上げ、画面の外までふっ飛ばします。
**1人で入ってもボットが加わるので、すぐ遊べます。** 人が増えると、その分ボットが減ります（最大8人）。

キャラクター・名前・音・絵は、すべて Roblox に最初から入っているものだけを使っています。他社のゲームの名前（「スマブラ」など）は使わないでください。

## 遊びかた

| 操作 | パソコン | スマホ |
|---|---|---|
| 移動 | A / D | スティック |
| ジャンプ（空中でもう1回） | スペース | ジャンプボタン |
| 攻撃 | クリック / J | 「攻撃」ボタン |
| 強攻撃（ためが長い分、強い） | K / E / 右クリック | 「強攻撃」ボタン |
| ダッシュ（空中は着地するまで1回。場外からの復帰にも） | Shift / Q / L | 「ダッシュ」ボタン |
| 上に飛ばす / 下に叩き落とす | W を押しながら攻撃 / 空中で S を押しながら攻撃 | スティックを上 / 下に入れながら攻撃 |

- 攻撃の向きは、入力した向き → 近くの相手の向き → 今向いている向き の順で決まります（相手のほうを自動で向きます）。
- 攻撃を受けると、少しのあいだ操作できません。％が高いほど遠くへ飛びます。
- 画面の外へ出ると残機が1つ減ります（3つ）。最後まで残った人の勝ちです。150秒で決まらなければ、残機が多い人（同じなら％が低い人）の勝ちです。

**ファイター（待ち時間に選べます）**

| 名前 | 特徴 |
|---|---|
| ハヤテ | 速い・軽い（飛ばされやすい） |
| スタンダード | バランス型 |
| ドッシリ | 強い・重い（飛ばされにくい） |

**ステージ**は3種類（スカイアイランド / ふたつの島 / 三段タワー）で、試合ごとに変わります。
**アイテム**は時々出ます：緑＝回復（％が25減る）、橙＝パワー（10秒間、与えるダメージ1.6倍）。

## Studio での使いかた

### 方法A：できあがった場ファイルを開く（かんたん）

1. Roblox Studio で「ファイル」→「開く」から、`dist/SkyRanto.rbxlx` を選ぶ
2. 上の「Home」の再生ボタン（▶）か、「Test」→「Play」を押す
3. 1人でも、ボットと対戦できます

### 方法B：スクリプトを自分で貼る

新しい「Baseplate」を開き、次の4つを作って、それぞれの中身をファイルからコピーします。

| 入れる場所 | 種類 | 名前（このとおりに） | 中身のファイル |
|---|---|---|---|
| ReplicatedStorage | ModuleScript | `SmashShared` | `src/shared/SmashShared.luau` |
| ServerScriptService | Script | `SmashServer` | `src/server/SmashServer.server.luau` |
| ServerScriptService | ModuleScript | `BotBrain` | `src/server/BotBrain.luau` |
| StarterPlayer › StarterPlayerScripts | LocalScript | `SmashClient` | `src/client/SmashClient.client.luau` |

床や足場は、スクリプトが自動で作ります（最初からある Baseplate は自動で消します）。
Rojo を使うなら、`default.project.json` がそのまま使えます。

### 試しかた

- 1人で「プレイ」：待ち時間（12秒）のあと、ボット3人との試合が始まります
- 2人以上で試す：「Test」タブ →「Clients and Servers」→ プレイヤー数を2〜4にして開始（窓がその数だけ開きます）

## 手ごたえの調整

ほとんどは `src/shared/SmashShared.luau` の数字で決まります。

| 変えたいこと | 場所 |
|---|---|
| 吹っ飛びの強さ・ダメージ・ための長さ | `Attacks` の `Damage` / `Base` / `Scale` / `Windup` |
| ファイターの速さ・重さ | `Fighters` の `walk` / `jump` / `damage` / `weight` |
| 残機・試合の長さ・待ち時間 | `Config` の `Stocks` / `MatchSeconds` / `Intermission` |
| ボットの人数（人が少ないとき） | `Config.MinFighters` |
| ステージの形 | `Layouts`（足場の位置と大きさ、出現位置、アイテムの場所） |
| ボットの強さ | `SmashShared.luau` の `BotSkill`（腕前の範囲 0〜1。大きいほど強い）と `BotThink`（反応の間隔。短いほど強い） |
| カメラの引き具合 | `src/client/SmashClient.client.luau` の `frameFighters` |

数字を変えたら、`tools/run_tests.sh` の「ボット同士の試合」の結果（平均の試合時間・KOの出やすさ）で、おおよその影響を確かめられます。

## 公開のしかた

1. 「ファイル」→「Robloxに公開」で、名前と説明を入れる（まず **非公開** のまま保存）
2. 「ファイル」→「Game Settings」→「Avatar」で、アバターを **R15** にする（攻撃のモーションは R15 用です）
3. 同じ画面の「Players」などで、最大人数を **8** にする
4. 体験の内容のアンケートに答える（殴り合いがあるので、暴力の項目は正直に答える）
5. サムネイルとアイコンを用意する
6. 友だちと遊んで確かめてから、公開（Public）に切り替える

勝利数・KO数は、公開したゲームでは保存されます（Studio のテストでは、API サービスを許可していないと保存されません。保存できなくても遊べます）。

## 開発者向け

```
src/shared/SmashShared.luau       共通の設定と計算（Roblox に依存しない）
src/server/SmashServer.server.luau  サーバー：試合の進行・ステージ・攻撃の判定・アイテム・ボットの操作
src/server/BotBrain.luau          ボットの頭脳（状況 → 動き。Roblox に依存しない）
src/client/SmashClient.client.luau  プレイヤー側：操作・カメラ・画面・演出
test/                             テスト（下記）
tools/                            テストの実行・場ファイルの作成・名前の検査
dist/SkyRanto.rbxlx               Studio で開ける場ファイル（tools/build_rbxlx.py で作る）
```

### テスト

[Luau](https://github.com/luau-lang/luau) の実行ファイル（`luau`）があれば、Studio なしで動かせます。

```bash
tools/run_tests.sh          # luau が PATH にない場合は LUAU=/path/to/luau を付ける
python3 tools/build_rbxlx.py   # スクリプトを変えたら、場ファイルを作り直す
```

| テスト | 確かめること |
|---|---|
| `test/pure.test.luau` | 吹っ飛びの計算・当たり判定・勝者の決め方・ステージの正しさ・ボットの判断 |
| `test/sim.luau` | ボット同士の試合を30回シミュレーション（試合の長さ・KOの出やすさ・場外からの復帰・動けなくなる不具合） |
| `test/server.test.luau` | サーバーのスクリプトを、Roblox を真似た仮の環境で動かし、参加→試合→攻撃→KO→復活→アイテム→結果→退出までを確認 |
| `test/client.test.luau` | プレイヤー側をサーバーと一緒に動かし、操作・画面の表示・演出・カメラを確認 |
| `tools/check_api_names.py` | 使っている Roblox の機能の名前が、本物の定義に存在するかを確認（定義ファイルは [luau-lsp](https://github.com/JohnnyMorganz/luau-lsp) の `scripts/globalTypes.None.d.luau`） |

### テストでは確かめられないこと

仮の環境は、Roblox の物理や描画を真似きれていません。次は、実際に Studio で遊んで確かめてください。

- 吹っ飛びの強さ・ジャンプの高さ・カメラの位置などの**体感**
- ボットが `Players:CreateHumanoidModelFromDescription` で作れるか、自然に動くか
- 攻撃のモーション（関節を動かしています）の見た目
- 効果音（Roblox に入っている音を使っています。鳴らなくても遊べます）
- スマホでのボタンの位置と押しやすさ

## これから足すと面白くなるもの

- キャラクターごとの必殺技、ステージの仕掛け（動く足場など）
- 勝った回数で手に入る見た目のアイテム（収益化の入口）
- 友だちと遊ぶ部屋（プライベートサーバー）向けの設定
