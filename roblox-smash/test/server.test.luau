--!nonstrict
-- サーバーのスクリプトを仮の Roblox 環境で動かして、試合の流れを確かめる。 実行: tools/run_tests.sh
-- （このファイルは tools/run_tests.sh が、仮の環境とサーバー本体と1つにまとめてから実行する。Mock と Shared は用意済み）

local passed, failed = 0, 0
local function check(name, cond, detail)
	if cond then passed += 1; print("ok   " .. name)
	else failed += 1; print("FAIL " .. name .. (detail and (" : " .. tostring(detail)) or "")) end
end

local remotes = Mock.ReplicatedStorage.SmashRemotes
local phase = function() return remotes.Phase.Value end
local function fighterAttr(id, key)
	local f = remotes.Fighters:FindFirstChild(id)
	return f and f:GetAttribute(key)
end
local function countFx(name)
	local n = 0
	for _, e in Mock.fx do if e[1] == name then n += 1 end end
	return n
end
local function rootOf(player) return player.Character and player.Character:FindFirstChild("HumanoidRootPart") end
local function place(player, x, y)
	local root = rootOf(player)
	root._props.CFrame = Mock.CF(Mock.V3(x, y, 0), root._props.CFrame.LookVector)
	root._props.AssemblyLinearVelocity = Mock.V3(0, 0, 0)
end
local function attack(player, kind, aim, dir) remotes.Attack.OnServerEvent:Fire(player, kind, aim or "side", dir or 1) end

---------------------------------------------------------------- 1人で入る → ボットが加わる

Mock.onKnock = function(player, velocity)   -- 本人の端末が吹っ飛びを受け取る代わり
	local root = rootOf(player)
	if root then root._props.AssemblyLinearVelocity = velocity end
end

local p1 = Mock.addPlayer("Hatai", 1)
Mock.run(1)
check("参加すると、キャラクターが出る", p1.Character ~= nil)
check("参加すると、勝利数・KO数の表ができる", p1:FindFirstChild("leaderstats") ~= nil and p1.leaderstats:FindFirstChild("Wins") ~= nil)
check("待ち時間に入る", phase() == "Lobby")

-- 待ち時間にファイターを選ぶ
remotes.Select.OnServerEvent:Fire(p1, "dossiri")
check("ファイターを選べる（ドッシリ）", fighterAttr("p_1", "Type") == "dossiri")
check("選んだファイターの速さになる", p1.Character:FindFirstChildOfClass("Humanoid").WalkSpeed == 18, p1.Character:FindFirstChildOfClass("Humanoid").WalkSpeed)
remotes.Select.OnServerEvent:Fire(p1, "でたらめ")
check("でたらめな選択でもエラーにならない", #Mock.errors == 0, Mock.errors[1])

-- ボットを作れないときは、試合を始めずに待つ（1人で勝ち続けない）
Mock.botFail = true
local sawWaiting, everStarted = false, false
Mock.run(40, 1 / 30, function()
	if remotes.Status.Value == "対戦相手を集めています…" then sawWaiting = true end
	if phase() == "Ready" or phase() == "Fight" then everStarted = true end
	return false
end)
check("ボットを作れないときは、試合を始めない", not everStarted)
check("そのときは、待っていることが表示される", sawWaiting)
check("そのときも、エラーにならない", #Mock.errors == 0, Mock.errors[1])
Mock.botFail = false

local started = Mock.run(30, 1 / 30, function() return phase() == "Ready" end)
check("待ち時間が終わると、試合の準備に入る", started)
local bots = 0
for _, c in remotes.Fighters:GetChildren() do if c:GetAttribute("Bot") then bots += 1 end end
check("1人のときは、ボットが3人加わる", bots == 3, bots)
local firstBot = nil
for _, c in remotes.Fighters:GetChildren() do if c:GetAttribute("Bot") and not firstBot then firstBot = c end end
check("全員の残機が3", fighterAttr("p_1", "Stocks") == 3 and firstBot ~= nil and firstBot:GetAttribute("Stocks") == 3)
check("ステージ名が表示される", remotes.StageName.Value ~= "")

local fighting = Mock.run(10, 1 / 30, function() return phase() == "Fight" end)
check("カウントダウンのあと、試合が始まる", fighting)
check("カウントダウンの演出が出る（3・2・1・0）", countFx("Count") == 4, countFx("Count"))

---------------------------------------------------------------- 試合中：ボットが動いて殴り合う

local botModel = nil
for _, c in Mock.workspace._children do
	if firstBot and c:GetAttribute("FighterId") == firstBot.Name then botModel = c end
end
check("ボットのキャラクターが、ステージに出ている", botModel ~= nil)
local startX = botModel and botModel.HumanoidRootPart.Position.X or 0

-- 人が何もしないまま 40 秒進める
Mock.run(40)
check("ボットが動いて、殴り合っている（Swing）", countFx("Swing") > 5, countFx("Swing"))
check("攻撃が当たる（Hit）", countFx("Hit") > 0, countFx("Hit"))
check("だれかがやられる（KO）", countFx("KO") > 0, countFx("KO"))
check("エラーが出ていない", #Mock.errors == 0, Mock.errors[1])

local totalPercent = 0
for _, c in remotes.Fighters:GetChildren() do totalPercent += (c:GetAttribute("Percent") or 0) end

---------------------------------------------------------------- 人どうしの攻撃（本人の端末の代わりをテストが行う）

-- 試合が終わっていたら、次の試合まで進める
local function toFight()
	Mock.run(300, 1 / 30, function() return phase() == "Fight" end)
end
Mock.run(300, 1 / 30, function() return phase() == "Lobby" end)
local p2 = Mock.addPlayer("Friend", 2)
toFight()
check("2人目が入ると、次の試合は ボットが2人になる", (function()
	local n = 0
	for _, c in remotes.Fighters:GetChildren() do if c:GetAttribute("Bot") and c:GetAttribute("Fighting") then n += 1 end end
	return n == 2
end)(), "試合の状態 " .. phase())

-- p1 が p2 を殴る（ボットから離れた、高い位置で）
Mock.run(2)   -- 復活直後の無敵が切れるまで
-- ボットの届かない高さにとどめて、のけぞり・無敵・攻撃の間隔が落ち着くまで待つ（3.5秒）
local function hasShield(player) return player.Character ~= nil and player.Character:FindFirstChildOfClass("ForceField") ~= nil end
for i = 1, 60 do
	place(p1, -20, 100); place(p2, -15, 100)
	Mock.run(0.25)
	if i >= 14 and not hasShield(p1) and not hasShield(p2) then break end   -- 3.5秒以上、かつ復活直後の無敵がない
end
place(p1, -20, 80); place(p2, -15, 80)
Mock.run(0.05)
local before = fighterAttr("p_2", "Percent")
local knocksBefore = #Mock.knocks
local swingsBefore = countFx("Swing")
attack(p1, "Light", "side", 1)
Mock.run(0.3)
local after = fighterAttr("p_2", "Percent")
check("殴ると相手の％が上がる", after > before, ("%s → %s / swing増 %d / p2盾 %s / p1 %s p2 %s / p1(%s) p2(%s)"):format(before, after, countFx("Swing") - swingsBefore, tostring(p2.Character and p2.Character:FindFirstChildOfClass("ForceField") ~= nil), tostring(fighterAttr("p_1", "Fighting")), tostring(fighterAttr("p_2", "Fighting")), rootOf(p1) and tostring(rootOf(p1).Position) or "なし", rootOf(p2) and tostring(rootOf(p2).Position) or "なし"))
local lastKnock = nil
for i = knocksBefore + 1, #Mock.knocks do
	if Mock.knocks[i].player == p2 then lastKnock = Mock.knocks[i] end
end
local knockDetail = {}
for i = knocksBefore + 1, #Mock.knocks do table.insert(knockDetail, Mock.knocks[i].player.Name .. ":" .. tostring(Mock.knocks[i].args[1])) end
check("相手に吹っ飛びが伝わる（右向き・上向き）", lastKnock ~= nil and lastKnock.args[1].X > 0 and lastKnock.args[1].Y > 0, table.concat(knockDetail, " | ") .. " / before " .. tostring(before) .. " after " .. tostring(after))
check("攻撃にモーションがつく（肩が動く）", p1.Character:FindFirstChild("RightShoulder", true) ~= nil)

-- 連打の制限
for _ = 1, 4 do place(p1, -20, 100); Mock.run(0.25) end   -- のけぞり・攻撃の間隔が落ち着くまで
place(p1, -20, 80)
local function highSwings()   -- p1 のいる高い場所での攻撃だけ数える（ボットの攻撃は数えない）
	local n = 0
	for _, e in Mock.fx do if e[1] == "Swing" and e[2].Y > 40 then n += 1 end end
	return n
end
local swings = highSwings()
attack(p1, "Light", "side", 1); attack(p1, "Light", "side", 1); attack(p1, "Light", "side", 1)
Mock.run(0.1)
check("連打しても、1回しか振らない", highSwings() == swings + 1, highSwings() - swings)

-- でたらめな引数
attack(p1, 123, "side", 1)
remotes.Attack.OnServerEvent:Fire(p1, "Light", 5, "x")
remotes.Attack.OnServerEvent:Fire(p1, "Nazo", "side", 1)
Mock.run(0.5)
check("でたらめな攻撃の信号を送ってもエラーにならない", #Mock.errors == 0, Mock.errors[1])

---------------------------------------------------------------- 場外・復活・脱落

local oldChar = p2.Character
local stocksBefore = fighterAttr("p_2", "Stocks")
place(p2, 300, 0)
Mock.run(0.5)
check("場外に出ると、残機が1つ減る", fighterAttr("p_2", "Stocks") == stocksBefore - 1, ("%s → %s"):format(stocksBefore, fighterAttr("p_2", "Stocks")))
Mock.run(2.5)
check("少しして復活する（新しいキャラクター）", p2.Character ~= nil and p2.Character ~= oldChar)
check("復活すると％が0に戻る", fighterAttr("p_2", "Percent") == 0)

-- 残機を使い切ると、観戦になる
for _ = 1, 3 do
	if fighterAttr("p_2", "Fighting") then
		Mock.run(2)
		place(p2, 300, 0)
		Mock.run(3)
	end
end
check("残機を使い切ると、試合から外れる", fighterAttr("p_2", "Fighting") == false)
check("脱落した人は観戦台に出る", p2.Character ~= nil and p2.Character.HumanoidRootPart.Position.Z == -14, p2.Character and tostring(p2.Character.HumanoidRootPart.Position))
local atkBlocked = fighterAttr("p_1", "Percent")
Mock.run(1)

---------------------------------------------------------------- アイテム

local item = nil
Mock.run(60, 1 / 30, function()
	if phase() ~= "Fight" then return true end
	local stage = Mock.workspace:FindFirstChild("SmashStage")
	item = stage and stage:FindFirstChild("Item")
	return item ~= nil
end)
if item then
	local kind = item:GetAttribute("Kind")
	local pos = item.Position
	if p1.Character and fighterAttr("p_1", "Fighting") then
		-- 復活直後は取れないので、取れるまで（最大4秒）その場所に置き直す
		for _ = 1, 20 do
			if rootOf(p1) then place(p1, pos.X, pos.Y) end
			Mock.run(0.2)
			if item._destroyed then break end
		end
		check("アイテムを取ると、消えて演出が出る", item._destroyed == true and countFx("Item") > 0, ("destroyed %s / fx %d"):format(tostring(item._destroyed), countFx("Item")))
		if kind == "power" and item._destroyed then print("info  取ったのは パワー（自分が取ったか、ボットが取ったかは区別しない）") end
	else
		print("skip アイテム（p1 が試合に出ていない）")
	end
else
	print("skip アイテム（この試合ではまだ出ていない）")
end

---------------------------------------------------------------- 試合の終わり・退出

local ended = Mock.run(400, 1 / 30, function() return phase() == "Result" end)
check("試合が終わって、結果の表示に入る", ended)
check("結果の文字が出る", remotes.Status.Value ~= "", remotes.Status.Value)
check("勝者の演出が出る", countFx("Win") >= 1)
local lobby = Mock.run(30, 1 / 30, function() return phase() == "Lobby" end)
check("そのあと待ち時間に戻る", lobby)
local leftoverBots = 0
for _, c in remotes.Fighters:GetChildren() do if c:GetAttribute("Bot") then leftoverBots += 1 end end
check("試合が終わるとボットが片づく", leftoverBots == 0, leftoverBots)

Mock.removePlayer(p2)
check("退出すると、一覧から消える", remotes.Fighters:FindFirstChild("p_2") == nil)
Mock.removePlayer(p1)
Mock.run(15)
check("全員が退出しても、止まらずエラーも出ない", #Mock.errors == 0, Mock.errors[1])
check("全員が退出すると、待機に戻る", phase() == "Lobby")

for _, fn in Mock.boundToClose do fn() end

print(("\n%d 件成功 / %d 件失敗"):format(passed, failed))
if #Mock.errors > 0 then
	for i = 1, math.min(3, #Mock.errors) do print("--- スクリプトのエラー " .. i .. " ---\n" .. Mock.errors[i]) end
end
if failed > 0 or #Mock.errors > 0 then error("テストに失敗しました") end
