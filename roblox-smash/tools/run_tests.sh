#!/bin/sh
# すべてのテストを実行する。使い方: tools/run_tests.sh   （luau が PATH にない場合は LUAU=/path/to/luau を指定）
set -e
cd "$(dirname "$0")/.."
LUAU="${LUAU:-luau}"
echo "== 計算とボットの頭脳 =="; "$LUAU" test/pure.test.luau | tail -3
echo "== 試合のシミュレーション（ボット同士） =="; "$LUAU" test/sim.luau | grep -v '^stuck'
# サーバーのスクリプトを、仮の Roblox 環境で動かす。
# Luau は ファイルごとに名前の世界が分かれるので、仮の環境・サーバー本体・テストを1つのファイルにまとめる。
# （os は書き換えできないので、時計だけ os.clock() を __mockclock() に置き換える）
{
  echo '--!nonstrict'
  echo 'local Mock = (function()'; cat test/mock_roblox.luau; echo 'end)()'
  echo 'local Shared = require("../src/shared/SmashShared")'
  echo 'Mock.registerModule(Mock.ReplicatedStorage, "SmashShared", "../src/shared/SmashShared")'
  echo 'Mock.registerModule(Mock.ServerScriptService, "BotBrain", "../src/server/BotBrain")'
  echo ';(function()'; sed 's/os\.clock()/__mockclock()/g' src/server/SmashServer.server.luau; echo 'end)()'
  cat test/server.test.luau
} > test/_combined.luau
echo "== サーバーのスクリプト（仮の Roblox 環境） =="
"$LUAU" test/_combined.luau || { rm -f test/_combined.luau; exit 1; }
# プレイヤー側：サーバーと一緒に動かす（LocalPlayer は p1）
{
  echo '--!nonstrict'
  echo 'local Mock = (function()'; cat test/mock_roblox.luau; echo 'end)()'
  echo 'local Shared = require("../src/shared/SmashShared")'
  echo 'Mock.registerModule(Mock.ReplicatedStorage, "SmashShared", "../src/shared/SmashShared")'
  echo 'Mock.registerModule(Mock.ServerScriptService, "BotBrain", "../src/server/BotBrain")'
  echo ';(function()'; sed 's/os\.clock()/__mockclock()/g' src/server/SmashServer.server.luau; echo 'end)()'
  echo 'local p1 = Mock.addPlayer("Hatai", 1)'
  echo 'Mock.Players._props.LocalPlayer = p1'
  echo 'Mock.run(1)'
  echo ';(function()'; sed 's/os\.clock()/__mockclock()/g' src/client/SmashClient.client.luau; echo 'end)()'
  cat test/client.test.luau
} > test/_combined.luau
echo "== プレイヤー側のスクリプト（サーバーと一緒に、仮の Roblox 環境で） =="
"$LUAU" test/_combined.luau || { rm -f test/_combined.luau; exit 1; }
rm -f test/_combined.luau
