--!nonstrict
-- プレイヤー側のスクリプトを、サーバーと一緒に仮の Roblox 環境で動かして確かめる。 実行: tools/run_tests.sh
-- （Mock・Shared・サーバー・プレイヤー側は、まとめた側で用意済み。LocalPlayer は p1）
local passed, failed = 0, 0
local function check(name, cond, detail)
	if cond then passed += 1; print("ok   " .. name)
	else failed += 1; print("FAIL " .. name .. (detail and (" : " .. tostring(detail)) or "")) end
end

local remotes = Mock.ReplicatedStorage.SmashRemotes
local phase = function() return remotes.Phase.Value end
local UIS = game:GetService("UserInputService")
local function rootOf(p) return p.Character and p.Character:FindFirstChild("HumanoidRootPart") end
local function humanoidOf(p) return p.Character and p.Character:FindFirstChildOfClass("Humanoid") end
local function countFx(name) local n = 0 for _, e in Mock.fx do if e[1] == name then n += 1 end end return n end
local function highSwings()   -- p1 のいる高い場所（ボットの届かない所）での攻撃だけ数える
	local n = 0
	for _, e in Mock.fx do if e[1] == "Swing" and e[2].Y > 40 then n += 1 end end
	return n
end
local function place(p, x, y)
	local r = rootOf(p)
	r._props.CFrame = Mock.CF(Mock.V3(x, y, 0), r._props.CFrame.LookVector)
	r._props.AssemblyLinearVelocity = Mock.V3(0, 0, 0)
end
local function hold(p, x, y, seconds)   -- 高い場所にとどめて、のけぞり・無敵が落ち着くまで待つ
	for _ = 1, math.floor(seconds / 0.25) do place(p, x, y); Mock.run(0.25) end
	place(p, x, y)
	Mock.run(0.05)   -- 足が地面にないことを反映させる
end
local function labels(gui)
	local list = {}
	for _, d in gui:GetDescendants() do
		if d._class == "TextLabel" or d._class == "TextButton" then table.insert(list, d) end
	end
	return list
end
local function findText(gui, pattern)
	for _, l in labels(gui) do
		if type(l.Text) == "string" and l.Text:find(pattern) then return l end
	end
	return nil
end
local function key(k) return { UserInputType = Enum.UserInputType.Keyboard, KeyCode = Enum.KeyCode[k] } end
local mouse1 = { UserInputType = Enum.UserInputType.MouseButton1, KeyCode = Enum.KeyCode.Unknown }

---------------------------------------------------------------- 画面ができる

local gui = p1:FindFirstChild("PlayerGui"):FindFirstChild("SmashHud")
check("画面（SmashHud）ができる", gui ~= nil)
check("エラーなく起動する", #Mock.errors == 0, Mock.errors[1])
check("ファイター選択のボタンが3つ出る", (function()
	local n = 0
	for _, l in labels(gui) do
		if l._class == "TextButton" and (l.Text:find("ハヤテ") or l.Text:find("スタンダード") or l.Text:find("ドッシリ")) then n += 1 end
	end
	return n
end)() == 3)
check("操作の案内が出る", findText(gui, "あそびかた") ~= nil)
check("スマホ用のボタンが3つある（タッチできない端末では隠れる）", (function()
	local n = 0
	for _, l in labels(gui) do
		if l._class == "TextButton" and (l.Text == "攻撃" or l.Text == "強攻撃" or l.Text == "ダッシュ") and l.Visible == false then n += 1 end
	end
	return n == 3
end)())
check("自分の頭の上に「あなた」の目印が出る", (function()
	local r = rootOf(p1)
	return r ~= nil and r:FindFirstChildOfClass("BillboardGui") ~= nil
end)())

local button = findText(gui, "ドッシリ")
button.Activated:Fire()
Mock.run(0.3)
check("ファイター選択のボタンを押すと、サーバーに伝わる", remotes.Fighters.p_1:GetAttribute("Type") == "dossiri", remotes.Fighters.p_1:GetAttribute("Type"))
check("選択中のファイターに印がつく", (function()
	for _, d in gui:GetDescendants() do
		if d._class == "UIStroke" and d.Enabled == true and d.Parent._class == "TextButton" then return d.Parent.Text:find("ドッシリ") ~= nil end
	end
	return false
end)())

---------------------------------------------------------------- 試合の画面

Mock.run(30, 1 / 30, function() return phase() == "Ready" end)
Mock.run(0.5)
check("全員の％のカードが並ぶ（4人）", (function()
	local n = 0
	for _, l in labels(gui) do if l.Text == "0%" then n += 1 end end
	return n == 4
end)(), (function() local t = {} for _, l in labels(gui) do table.insert(t, tostring(l.Text)) end return table.concat(t, ",") end)())
check("ステージ名が上に出る", findText(gui, remotes.StageName.Value) ~= nil)
check("操作の案内は、試合の準備中は隠れる", findText(gui, "あそびかた").Parent.Visible == false)
Mock.run(10, 1 / 30, function() return phase() == "Fight" end)
Mock.run(0.5)
check("試合が始まると、残り時間が出る", findText(gui, "^%d+:%d%d$") ~= nil)
check("試合の最初に、数秒だけ案内が出る", findText(gui, "あそびかた").Parent.Visible == true)
local cam = Mock.camera._props.CFrame.Position
check("カメラが、全員が映る距離まで引く", cam.Z >= 56, tostring(cam))
check("カメラの向きがステージを向いている", math.abs(cam.X) < 40)

---------------------------------------------------------------- 操作

hold(p1, -20, 90, 1)   -- ボットの届かない高さ
local h, r = humanoidOf(p1), rootOf(p1)

h._props.MoveDirection = Mock.V3(1, 0, 0)
local swings = highSwings()
UIS.InputBegan:Fire(mouse1, false)
Mock.run(0.2)
check("クリックすると、サーバーに攻撃が届く（Swing）", highSwings() > swings)
check("右を入力して攻撃すると、右を向く", rootOf(p1)._props.CFrame.LookVector.X > 0.5)

h._props.MoveDirection = Mock.V3(-1, 0, 0)
hold(p1, -20, 90, 0.75)
UIS.InputBegan:Fire(key("J"), false)
Mock.run(0.2)
check("左を入力して攻撃すると、左を向く", rootOf(p1)._props.CFrame.LookVector.X < -0.5)

h._props.MoveDirection = Mock.V3(0, 0, -1)
hold(p1, -20, 90, 0.75)
local before = highSwings()
UIS.InputBegan:Fire(key("K"), false)
Mock.run(0.3)
check("強攻撃（K）も届く", highSwings() > before)
local lastSwing = nil
for i = #Mock.fx, 1, -1 do if Mock.fx[i][1] == "Swing" and Mock.fx[i][2].Y > 40 then lastSwing = Mock.fx[i] break end end
check("強攻撃の種類がサーバーに伝わる", lastSwing ~= nil and lastSwing[3] == "Smash", lastSwing and lastSwing[3])

-- 入力処理を処理済みにされたとき（画面のボタンを押したときなど）は、攻撃しない
h._props.MoveDirection = Mock.V3(0, 0, 0)
hold(p1, -20, 90, 0.75)
local sw = highSwings()
UIS.InputBegan:Fire(mouse1, true)
Mock.run(0.2)
check("画面のボタンを押したときは、攻撃にならない", highSwings() == sw)

-- スマホのボタン（画面のボタンに触れると、攻撃になる）
hold(p1, -20, 90, 1)
local touchAttack = findText(gui, "^攻撃$")
local sw2 = highSwings()
touchAttack.InputBegan:Fire({ UserInputType = Enum.UserInputType.Touch })
Mock.run(0.2)
check("スマホの「攻撃」ボタンに触れると、攻撃になる", highSwings() > sw2)

-- ダッシュ
hold(p1, -20, 90, 1)
h._props.MoveDirection = Mock.V3(1, 0, 0)
UIS.InputBegan:Fire(key("LeftShift"), false)
Mock.run(0.07)
check("Shift でダッシュする（速く動く）", rootOf(p1).AssemblyLinearVelocity.X > 40, tostring(rootOf(p1).AssemblyLinearVelocity))
Mock.run(0.3)
local dashVelocity = rootOf(p1).AssemblyLinearVelocity.X
UIS.InputBegan:Fire(key("LeftShift"), false)
Mock.run(0.07)
check("空中のダッシュは、着地するまで1回だけ", rootOf(p1).AssemblyLinearVelocity.X < 40, tostring(rootOf(p1).AssemblyLinearVelocity))

-- 2段ジャンプ
hold(p1, 0, 95, 0.5)
h._props.MoveDirection = Mock.V3(0, 0, 0)
Mock.run(0.3)   -- 落ちている最中
local vy0 = rootOf(p1).AssemblyLinearVelocity.Y
UIS.JumpRequest:Fire()
Mock.run(0.05)
check("空中でジャンプを押すと、もう一度上に跳ぶ", rootOf(p1).AssemblyLinearVelocity.Y > 0 and vy0 < 0, ("%.1f → %.1f"):format(vy0, rootOf(p1).AssemblyLinearVelocity.Y))
Mock.run(0.1)
UIS.JumpRequest:Fire()
Mock.run(0.05)
check("3回目は跳べない", rootOf(p1).AssemblyLinearVelocity.Y < 40, tostring(rootOf(p1).AssemblyLinearVelocity))

-- 吹っ飛び
hold(p1, 0, 95, 0.5)
h._props.MoveDirection = Mock.V3(0, 0, 0)
remotes.Knock.OnClientEvent:Fire(Mock.V3(90, 50, 0), 0.3)
Mock.run(0.05)
check("吹っ飛びを受け取ると、その速さで飛ぶ", rootOf(p1).AssemblyLinearVelocity.X > 60, tostring(rootOf(p1).AssemblyLinearVelocity))
check("吹っ飛んでいる間は、操作できない", h.PlatformStand == true)
Mock.run(0.5)
check("しばらくすると、操作できるようになる", h.PlatformStand == false)

-- 奥行きの固定
hold(p1, 0, 95, 0.5)
rootOf(p1)._props.CFrame = Mock.CF(Mock.V3(0, 85, 3), rootOf(p1)._props.CFrame.LookVector)
Mock.run(0.1)
check("奥や手前にずれても、ステージの線に戻される", math.abs(rootOf(p1).Position.Z) < 0.1, rootOf(p1).Position.Z)

---------------------------------------------------------------- 演出

local popupsBefore = #gui._children
fxRemoteOK = true
remotes.Fx.OnClientEvent:Fire("Hit", Mock.V3(0, 5, 0), 12, 200, 1)
remotes.Fx.OnClientEvent:Fire("KO", Mock.V3(150, 5, 0), "テスト")
remotes.Fx.OnClientEvent:Fire("Item", Mock.V3(0, 5, 0), "heal", "テスト")
remotes.Fx.OnClientEvent:Fire("Count", 3)
remotes.Fx.OnClientEvent:Fire("Count", 0)
remotes.Fx.OnClientEvent:Fire("Win", "テスト", true)
remotes.Fx.OnClientEvent:Fire("Nazo")
Mock.run(0.2)
check("ダメージ・アイテムの表示が出る", findText(gui, "^%-12$") ~= nil and findText(gui, "回復") ~= nil)
local koLabel = findText(gui, "KO!")
check("KOの表示が出る", koLabel ~= nil)
check("演出でエラーが出ない", #Mock.errors == 0, Mock.errors[1])
Mock.run(1.5)
check("表示は少しして消える", koLabel ~= nil and koLabel.Parent == nil)

-- 試合が進むと、％が表示に反映される
local function anyPercent()
	for _, l in labels(gui) do
		local n = tostring(l.Text):match("^(%d+)%%$")
		if n and tonumber(n) > 0 then return true end
	end
	return false
end
Mock.run(40, 1 / 30, function() return anyPercent() end)
check("試合が進むと、％の表示が変わる", anyPercent() or phase() ~= "Fight")

-- 結果の表示
Mock.run(400, 1 / 30, function() return phase() == "Result" end)
Mock.run(0.5)
check("結果が出る（誰かの勝ち / 引き分け / ゲームオーバー）", remotes.Status.Value ~= "" and findText(gui, remotes.Status.Value) ~= nil, remotes.Status.Value)
Mock.run(400, 1 / 30, function() return phase() == "Lobby" end)
Mock.run(0.5)
check("待ち時間に戻ると、ファイター選択が出る", findText(gui, "ファイターを選ぼう").Parent.Visible == true)
check("エラーが出ていない", #Mock.errors == 0, Mock.errors[1])

print(("\n%d 件成功 / %d 件失敗"):format(passed, failed))
if #Mock.errors > 0 then
	for i = 1, math.min(3, #Mock.errors) do print("--- スクリプトのエラー " .. i .. " ---\n" .. Mock.errors[i]) end
end
if failed > 0 or #Mock.errors > 0 then error("テストに失敗しました") end
