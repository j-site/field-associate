--!nonstrict
--[[
	スカイ乱闘：プレイヤー側
	置き場所: StarterPlayer > StarterPlayerScripts の中に LocalScript として入れる（名前は SmashClient）

	・横から見たカメラ（全員が映るように、自動で引いたり寄ったりする）
	・操作：移動 / ジャンプ（2回まで） / 攻撃 / スマッシュ / ダッシュ（スマホはボタン）
	・画面の表示：残り時間、全員の％と残機、ファイター選択、カウントダウン
	・演出：ダメージの数字、画面の揺れ、KOの表示、効果音
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local TweenService = game:GetService("TweenService")
local CollectionService = game:GetService("CollectionService")
local SoundService = game:GetService("SoundService")
local Debris = game:GetService("Debris")

local Shared = require(ReplicatedStorage:WaitForChild("SmashShared"))
local C = Shared.Config

local player = Players.LocalPlayer
local remotes = ReplicatedStorage:WaitForChild("SmashRemotes")
local attackRemote = remotes:WaitForChild("Attack")
local selectRemote = remotes:WaitForChild("Select")
local knockRemote = remotes:WaitForChild("Knock")
local fxRemote = remotes:WaitForChild("Fx")
local statusValue = remotes:WaitForChild("Status")
local phaseValue = remotes:WaitForChild("Phase")
local stageValue = remotes:WaitForChild("StageName")
local timeValue = remotes:WaitForChild("TimeLeft")
local fightersFolder = remotes:WaitForChild("Fighters")

local myId = "p_" .. player.UserId
local camera = workspace.CurrentCamera
local viewport = function() return camera.ViewportSize end

local function color3(rgb) return Color3.fromRGB(rgb[1], rgb[2], rgb[3]) end
local function slotColor(slot) return color3(Shared.SlotColors[((slot or 1) - 1) % #Shared.SlotColors + 1]) end

---------------------------------------------------------------- 効果音（Robloxに最初から入っている音。なければ無音）

local SOUNDS = {
	swing = "rbxasset://sounds/swordslash.wav",
	hit = "rbxasset://sounds/uuhhh.mp3",
	ko = "rbxasset://sounds/impact_water.mp3",
	count = "rbxasset://sounds/electronicpingshort.wav",
	item = "rbxasset://sounds/button.wav",
	win = "rbxasset://sounds/victory.wav",
	dash = "rbxasset://sounds/action_swim.mp3",
}

local function playSound(name, volume, speed)
	local s = Instance.new("Sound")
	s.SoundId = SOUNDS[name]
	s.Volume = volume or 0.5
	s.PlaybackSpeed = speed or 1
	s.Parent = SoundService
	s:Play()
	Debris:AddItem(s, 4)
end

---------------------------------------------------------------- 自分のキャラクターの状態

local character, humanoid, root = nil, nil, nil
local stunUntil = 0
local stunToken = 0
local canDouble, airDashUsed = false, false
local dashUntil, nextDash, dashDir = 0, 0, 1
local lastFacing = 1

local function isGrounded()
	return humanoid ~= nil and humanoid.FloorMaterial ~= Enum.Material.Air
end

local function onCharacter(newCharacter)
	character = newCharacter
	humanoid = newCharacter:WaitForChild("Humanoid")
	root = newCharacter:WaitForChild("HumanoidRootPart")
	canDouble, airDashUsed = false, false
	-- 試合の最初に、自分がどれかを頭の上に出す
	local marker = Instance.new("BillboardGui")
	marker.Size = UDim2.fromOffset(120, 34)
	marker.StudsOffset = Vector3.new(0, 5.2, 0)
	marker.AlwaysOnTop = true
	marker.Adornee = root
	marker.Parent = root
	local text = Instance.new("TextLabel")
	text.Size = UDim2.new(1, 0, 1, 0)
	text.BackgroundTransparency = 1
	text.Font = Enum.Font.GothamBlack
	text.TextSize = 22
	text.TextColor3 = Color3.fromRGB(255, 230, 90)
	text.TextStrokeTransparency = 0.2
	text.Text = "▼ あなた"
	text.Parent = marker
	Debris:AddItem(marker, 7)
	humanoid.StateChanged:Connect(function(_, new)
		if new == Enum.HumanoidStateType.Landed or new == Enum.HumanoidStateType.Running then
			canDouble, airDashUsed = false, false
		elseif new == Enum.HumanoidStateType.Freefall then
			task.delay(0.12, function() canDouble = true end)   -- 1回目のジャンプと区別するための間
		end
	end)
end
if player.Character then task.spawn(onCharacter, player.Character) end
player.CharacterAdded:Connect(onCharacter)

local function alive()
	return character ~= nil and humanoid ~= nil and root ~= nil and humanoid.Health > 0 and root.Parent ~= nil
end

local function fighterInfo(model)
	local id = model:GetAttribute("FighterId")
	return id and fightersFolder:FindFirstChild(id)
end

---------------------------------------------------------------- 吹っ飛び・奥行きの固定・ダッシュ

knockRemote.OnClientEvent:Connect(function(velocity, stun)
	if not alive() or typeof(velocity) ~= "Vector3" then return end
	humanoid:ChangeState(Enum.HumanoidStateType.Freefall)   -- 地面にいると踏ん張ってしまうので、浮かせてから飛ばす
	root.AssemblyLinearVelocity = velocity
	local seconds = if type(stun) == "number" then stun else 0.2
	stunUntil = os.clock() + seconds
	-- 吹っ飛んでいる間は操作できなくする。反対方向のキーで勢いを打ち消せてしまうのを防ぐ
	stunToken += 1
	local token = stunToken
	humanoid.PlatformStand = true
	task.delay(seconds, function()
		if token == stunToken and humanoid and humanoid.Parent then humanoid.PlatformStand = false end
	end)
end)

RunService.Heartbeat:Connect(function()
	if not alive() then return end
	local p = root.Position
	-- 観戦台（奥の別の場所）にいるときは固定しない
	if math.abs(p.Z) > 0.05 and math.abs(p.Z) <= 8 then
		local v = root.AssemblyLinearVelocity
		root.CFrame = root.CFrame - Vector3.new(0, 0, p.Z)
		root.AssemblyLinearVelocity = Vector3.new(v.X, v.Y, 0)
	end
	if os.clock() < dashUntil then
		local v = root.AssemblyLinearVelocity
		root.AssemblyLinearVelocity = Vector3.new(dashDir * Shared.Dash.Speed, v.Y * 0.4, 0)
	end
	if isGrounded() then airDashUsed = false end
	local look = root.CFrame.LookVector.X
	if look > 0.3 then lastFacing = 1 elseif look < -0.3 then lastFacing = -1 end
end)

---------------------------------------------------------------- 2段ジャンプ

UserInputService.JumpRequest:Connect(function()
	if alive() and canDouble and humanoid:GetState() == Enum.HumanoidStateType.Freefall and not humanoid.PlatformStand then
		canDouble = false
		humanoid:ChangeState(Enum.HumanoidStateType.Jumping)
	end
end)

---------------------------------------------------------------- 攻撃・ダッシュ

local function inputDir()
	local mx = humanoid.MoveDirection.X
	if mx > 0.3 then return 1 elseif mx < -0.3 then return -1 end
	return 0
end

-- 近くの相手がいる向き（向きを入力していないときに、自動で相手のほうを向く）
local function nearestEnemyDir()
	local best, bestDist = 0, math.huge
	for _, model in CollectionService:GetTagged("Fighter") do
		if model ~= character then
			local info = fighterInfo(model)
			local r = model:FindFirstChild("HumanoidRootPart")
			if info and r and info:GetAttribute("Fighting") then
				local dx, dy = r.Position.X - root.Position.X, r.Position.Y - root.Position.Y
				if math.abs(dx) <= 14 and math.abs(dy) <= 8 and math.abs(dx) < bestDist then
					best, bestDist = if dx >= 0 then 1 else -1, math.abs(dx)
				end
			end
		end
	end
	return best
end

local function face(dir)
	root.CFrame = CFrame.lookAt(root.Position, root.Position + Vector3.new(dir, 0, 0))
	lastFacing = dir
end

local function doAttack(kind)
	if not alive() or os.clock() < stunUntil then return end
	local dir = inputDir()
	if dir == 0 then dir = nearestEnemyDir() end
	if dir == 0 then dir = lastFacing end
	local mz = humanoid.MoveDirection.Z   -- 画面の上（W・スティックの上）が -Z
	local aim = "side"
	if mz < -0.5 then aim = "up" elseif mz > 0.5 and not isGrounded() then aim = "down" end

	face(dir)
	if isGrounded() then   -- 攻撃で少し前に出る
		local v = root.AssemblyLinearVelocity
		root.AssemblyLinearVelocity = Vector3.new(v.X + dir * (if kind == "Smash" then C.LungeSmash else C.LungeLight), v.Y, 0)
	end
	attackRemote:FireServer(kind, aim, dir)
end

local function doDash()
	local now = os.clock()
	if not alive() or now < nextDash or now < stunUntil then return end
	local grounded = isGrounded()
	if not grounded and airDashUsed then return end   -- 空中のダッシュは、着地するまで1回
	local dir = inputDir()
	if dir == 0 then dir = lastFacing end
	if not grounded then airDashUsed = true end
	dashDir, dashUntil, nextDash = dir, now + Shared.Dash.Time, now + Shared.Dash.Cooldown
	face(dir)
	playSound("dash", 0.4, 1.3)
end

-- キーボード・マウス・コントローラー
UserInputService.InputBegan:Connect(function(input, processed)
	if processed then return end
	local t, k = input.UserInputType, input.KeyCode
	if t == Enum.UserInputType.MouseButton1 or k == Enum.KeyCode.J or k == Enum.KeyCode.ButtonX then
		doAttack("Light")
	elseif t == Enum.UserInputType.MouseButton2 or k == Enum.KeyCode.K or k == Enum.KeyCode.E or k == Enum.KeyCode.ButtonY then
		doAttack("Smash")
	elseif k == Enum.KeyCode.LeftShift or k == Enum.KeyCode.Q or k == Enum.KeyCode.L or k == Enum.KeyCode.ButtonB then
		doDash()
	end
end)

-- スマホのボタンは、画面の部品を作ったあとで置く（下の「スマホのボタン」）

---------------------------------------------------------------- カメラ（全員が映るように自動で調整）

local focus = Vector3.new(0, 8, 0)
local distance = 70
local shake = 0

local function frameFighters()
	local minX, maxX, minY, maxY, n = math.huge, -math.huge, math.huge, -math.huge, 0
	for _, model in CollectionService:GetTagged("Fighter") do
		local info = fighterInfo(model)
		local r = model:FindFirstChild("HumanoidRootPart")
		if info and r and info:GetAttribute("Fighting") then
			-- 遠くへ飛ばされた人のせいで、画面が広がりすぎないようにする
			local x, y = math.clamp(r.Position.X, -75, 75), math.clamp(r.Position.Y, -22, 65)
			minX, maxX, minY, maxY, n = math.min(minX, x), math.max(maxX, x), math.min(minY, y), math.max(maxY, y), n + 1
		end
	end
	if n == 0 then
		if alive() then
			return Vector3.new(root.Position.X * 0.5, 6, 0), 62
		end
		return Vector3.new(0, 8, 0), 70
	end
	local vs = viewport()
	local aspect = math.max(vs.X / math.max(vs.Y, 1), 0.5)
	local fit = 0.93   -- 視野角50度のとき、距離1あたりに見える高さ
	local needW = (maxX - minX + 38) / (fit * aspect)
	local needH = (maxY - minY + 30) / fit
	return Vector3.new((minX + maxX) / 2, (minY + maxY) / 2 + 3, 0), math.clamp(math.max(needW, needH, 56), 56, 150)
end

RunService:BindToRenderStep("SmashCamera", Enum.RenderPriority.Camera.Value + 1, function(dt)
	local targetFocus, targetDistance = frameFighters()
	focus = focus:Lerp(targetFocus, math.min(dt * 5, 1))
	distance += (targetDistance - distance) * math.min(dt * 3, 1)
	shake *= math.exp(-9 * dt)
	local offset = Vector3.new((math.random() - 0.5) * shake, (math.random() - 0.5) * shake, 0)
	camera.CameraType = Enum.CameraType.Scriptable
	camera.FieldOfView = 50
	camera.CFrame = CFrame.lookAt(focus + Vector3.new(0, 4, distance) + offset, focus + offset)
end)

---------------------------------------------------------------- 画面の部品

local gui = Instance.new("ScreenGui")
gui.Name = "SmashHud"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.Parent = player:WaitForChild("PlayerGui")

local uiScale = Instance.new("UIScale")   -- 画面の大きさに合わせて、表示の大きさを変える
uiScale.Parent = gui
local function updateScale()
	local vs = viewport()
	uiScale.Scale = math.clamp(math.min(vs.X / 1100, vs.Y / 650), 0.65, 1.3)
end
updateScale()
camera:GetPropertyChangedSignal("ViewportSize"):Connect(updateScale)

local function label(parent, size, position, textSize, text)
	local l = Instance.new("TextLabel")
	l.Size = size
	l.Position = position
	l.BackgroundTransparency = 1
	l.Font = Enum.Font.GothamBlack
	l.TextSize = textSize
	l.TextColor3 = Color3.new(1, 1, 1)
	l.TextStrokeTransparency = 0.35
	l.Text = text or ""
	l.Parent = parent
	return l
end

local function round(parent, radius)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, radius)
	c.Parent = parent
end

-- 上：ステージ名、残り時間、ひとこと
local stageLabel = label(gui, UDim2.new(1, 0, 0, 18), UDim2.new(0, 0, 0, 10), 15)
stageLabel.TextColor3 = Color3.fromRGB(230, 235, 245)
local timerLabel = label(gui, UDim2.new(1, 0, 0, 40), UDim2.new(0, 0, 0, 28), 34)
local bannerLabel = label(gui, UDim2.new(1, 0, 0, 60), UDim2.new(0, 0, 0.16, 0), 46)

local function updateTop()
	local phase = phaseValue.Value
	stageLabel.Text = if phase == "Lobby" and stageValue.Value == "" then "" else stageValue.Value
	if phase == "Fight" then
		local t = math.max(timeValue.Value, 0)
		timerLabel.Text = ("%d:%02d"):format(t // 60, t % 60)
		timerLabel.TextColor3 = if t <= 10 then Color3.fromRGB(255, 90, 80) else Color3.new(1, 1, 1)
	else
		timerLabel.Text = ""
	end
	bannerLabel.Text = statusValue.Value
end
statusValue.Changed:Connect(updateTop)
timeValue.Changed:Connect(updateTop)
stageValue.Changed:Connect(updateTop)

-- 操作の案内
local helpPanel = Instance.new("Frame")
helpPanel.Size = UDim2.new(0, 330, 0, 150)
helpPanel.Position = UDim2.new(1, -346, 0, 70)
helpPanel.BackgroundColor3 = Color3.fromRGB(20, 26, 40)
helpPanel.BackgroundTransparency = 0.25
helpPanel.Parent = gui
round(helpPanel, 10)
local helpText = label(helpPanel, UDim2.new(1, -20, 1, -16), UDim2.new(0, 10, 0, 8), 15)
helpText.Font = Enum.Font.GothamBold
helpText.TextXAlignment = Enum.TextXAlignment.Left
helpText.TextYAlignment = Enum.TextYAlignment.Top
helpText.TextWrapped = true
helpText.Text = if UserInputService.TouchEnabled
	then "【あそびかた】\n相手の％を上げて、画面の外へ吹っ飛ばそう！\n・攻撃 / 強攻撃 / ダッシュ：右下のボタン\n・ジャンプは空中でもう1回できる\n・スティックを上に入れながら攻撃で、上に飛ばせる"
	else "【あそびかた】\n相手の％を上げて、画面の外へ吹っ飛ばそう！\nA・D：移動　スペース：ジャンプ（2回まで）\nクリック / J：攻撃　K / E / 右クリック：強攻撃\nShift / L：ダッシュ　W+攻撃：上に飛ばす"
local helpToken = 0
local function showHelp(seconds)
	helpToken += 1
	local token = helpToken
	helpPanel.Visible = true
	if seconds then
		task.delay(seconds, function()
			if token == helpToken then helpPanel.Visible = false end
		end)
	end
end

-- ファイター選択（待ち時間のあいだだけ出る）
local selectPanel = Instance.new("Frame")
selectPanel.Size = UDim2.new(0, 230, 0, 40 + #Shared.Fighters * 74)
selectPanel.Position = UDim2.new(0, 16, 0.5, -(40 + #Shared.Fighters * 74) / 2)
selectPanel.BackgroundColor3 = Color3.fromRGB(20, 26, 40)
selectPanel.BackgroundTransparency = 0.2
selectPanel.Parent = gui
round(selectPanel, 12)
label(selectPanel, UDim2.new(1, 0, 0, 36), UDim2.new(0, 0, 0, 4), 20, "ファイターを選ぼう")

local selectButtons = {}
for i, def in Shared.Fighters do
	local b = Instance.new("TextButton")
	b.Size = UDim2.new(1, -20, 0, 64)
	b.Position = UDim2.new(0, 10, 0, 40 + (i - 1) * 74)
	b.BackgroundColor3 = Color3.fromRGB(50, 62, 90)
	b.Font = Enum.Font.GothamBold
	b.TextSize = 16
	b.TextColor3 = Color3.new(1, 1, 1)
	b.Text = ("%s\n%s"):format(def.name, def.info)
	b.AutoButtonColor = true
	b.Parent = selectPanel
	round(b, 8)
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 3
	stroke.Color = Color3.fromRGB(255, 220, 90)
	stroke.Enabled = false
	stroke.Parent = b
	b.Activated:Connect(function() selectRemote:FireServer(def.id) end)
	selectButtons[def.id] = stroke
end

local function updateSelect()
	local mine = fightersFolder:FindFirstChild(myId)
	local chosen = mine and mine:GetAttribute("Type")
	for id, stroke in selectButtons do stroke.Enabled = (id == chosen) end
end

-- カウントダウン
local countLabel = label(gui, UDim2.new(1, 0, 0, 160), UDim2.new(0, 0, 0.3, 0), 120)
countLabel.TextTransparency = 1
countLabel.TextStrokeTransparency = 1

local function showCount(text, color)
	countLabel.Text = text
	countLabel.TextColor3 = color
	countLabel.TextSize = 70
	countLabel.TextTransparency = 0
	countLabel.TextStrokeTransparency = 0.3
	TweenService:Create(countLabel, TweenInfo.new(0.8, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { TextSize = 150, TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
end

-- 画面の赤いふち（自分がやられたとき）
local vignette = Instance.new("Frame")
vignette.Size = UDim2.new(1, 0, 1, 0)
vignette.BackgroundColor3 = Color3.fromRGB(255, 40, 30)
vignette.BackgroundTransparency = 1
vignette.BorderSizePixel = 0
vignette.Parent = gui

local function flashScreen(strength)
	vignette.BackgroundTransparency = 1 - strength
	TweenService:Create(vignette, TweenInfo.new(0.35), { BackgroundTransparency = 1 }):Play()
end

-- スマホのボタン（タッチできる端末だけに出る）
local function touchButton(title, position, size, color, fn)
	local b = Instance.new("TextButton")
	b.Size = UDim2.fromOffset(size, size)
	b.Position = position
	b.BackgroundColor3 = color
	b.BackgroundTransparency = 0.25
	b.Font = Enum.Font.GothamBlack
	b.TextSize = 18
	b.TextColor3 = Color3.new(1, 1, 1)
	b.Text = title
	b.AutoButtonColor = true
	b.Visible = UserInputService.TouchEnabled
	b.Parent = gui
	round(b, size // 2)
	b.InputBegan:Connect(function(input)   -- 指が触れた瞬間に反応させる（離すのを待たない）
		if input.UserInputType == Enum.UserInputType.Touch or input.UserInputType == Enum.UserInputType.MouseButton1 then fn() end
	end)
	return b
end
touchButton("攻撃", UDim2.new(1, -110, 1, -250), 88, Color3.fromRGB(230, 90, 80), function() doAttack("Light") end)
touchButton("強攻撃", UDim2.new(1, -210, 1, -200), 88, Color3.fromRGB(240, 150, 50), function() doAttack("Smash") end)
touchButton("ダッシュ", UDim2.new(1, -110, 1, -350), 88, Color3.fromRGB(70, 150, 230), doDash)

-- 全員の％と残機
local bar = Instance.new("Frame")
bar.Size = UDim2.new(1, 0, 0, 96)
bar.Position = UDim2.new(0, 0, 1, -108)
bar.BackgroundTransparency = 1
bar.Parent = gui
local layout = Instance.new("UIListLayout")
layout.FillDirection = Enum.FillDirection.Horizontal
layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
layout.Padding = UDim.new(0, 8)
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Parent = bar

local cards = {}   -- [id] = { frame, bar, percent, name, info }

local function makeCard(id)
	local frame = Instance.new("Frame")
	frame.Size = UDim2.new(0, 140, 1, 0)
	frame.BackgroundColor3 = Color3.fromRGB(28, 34, 52)
	frame.BackgroundTransparency = 0.15
	frame.Parent = bar
	round(frame, 10)
	local colorBar = Instance.new("Frame")
	colorBar.Size = UDim2.new(1, 0, 0, 6)
	colorBar.BorderSizePixel = 0
	colorBar.Parent = frame
	round(colorBar, 3)
	if id == myId then
		local stroke = Instance.new("UIStroke")
		stroke.Color = Color3.new(1, 1, 1)
		stroke.Thickness = 2
		stroke.Parent = frame
	end
	local card = {
		frame = frame, bar = colorBar,
		percent = label(frame, UDim2.new(1, 0, 0, 42), UDim2.new(0, 0, 0, 8), 34),
		name = label(frame, UDim2.new(1, -10, 0, 18), UDim2.new(0, 5, 0, 52), 14),
		info = label(frame, UDim2.new(1, -10, 0, 20), UDim2.new(0, 5, 0, 70), 14),
	}
	card.name.TextTruncate = Enum.TextTruncate.AtEnd
	cards[id] = card
	return card
end

local function updateCards()
	local list = fightersFolder:GetChildren()
	table.sort(list, function(a, b) return (a:GetAttribute("Slot") or 0) < (b:GetAttribute("Slot") or 0) end)
	local seen = {}
	local width = if #list <= 4 then 140 elseif #list <= 6 then 112 else 92
	for i, info in list do
		local id = info.Name
		seen[id] = true
		local card = cards[id] or makeCard(id)
		local fighting = info:GetAttribute("Fighting")
		local percent = info:GetAttribute("Percent") or 0
		local stocks = info:GetAttribute("Stocks") or 0
		card.frame.LayoutOrder = i
		card.frame.Size = UDim2.new(0, width, 1, 0)
		card.frame.BackgroundTransparency = if fighting or phaseValue.Value == "Lobby" then 0.15 else 0.6
		card.bar.BackgroundColor3 = slotColor(info:GetAttribute("Slot"))
		card.percent.Text = percent .. "%"
		-- ％が高いほど赤くして、危ないことが一目でわかるようにする
		card.percent.TextColor3 = Color3.new(1, 1, 1):Lerp(Color3.fromRGB(255, 70, 50), math.min(percent / 150, 1))
		card.name.Text = info:GetAttribute("Name") or ""
		if phaseValue.Value == "Lobby" then
			card.info.Text = (Shared.fighterById(info:GetAttribute("Type")).name)
		elseif fighting then
			card.info.Text = string.rep("●", stocks) .. (if info:GetAttribute("Power") then " パワー" else "")
			card.info.TextColor3 = if info:GetAttribute("Power") then Color3.fromRGB(255, 170, 60) else Color3.new(1, 1, 1)
		else
			card.info.Text = "観戦"
			card.info.TextColor3 = Color3.fromRGB(180, 180, 190)
		end
	end
	for id, card in cards do
		if not seen[id] then
			card.frame:Destroy()
			cards[id] = nil
		end
	end
end

task.spawn(function()
	while true do
		updateCards()
		updateSelect()
		task.wait(0.1)
	end
end)

---------------------------------------------------------------- 状態の切り替え

local function onPhase()
	local phase = phaseValue.Value
	selectPanel.Visible = (phase == "Lobby")
	if phase == "Lobby" then
		showHelp(nil)
	elseif phase == "Fight" then
		showHelp(7)
	elseif phase == "Ready" or phase == "Result" then
		helpPanel.Visible = false
	end
	updateTop()
end
phaseValue.Changed:Connect(onPhase)
onPhase()

---------------------------------------------------------------- 演出

local function toScreen(worldPos)
	local v, onScreen = camera:WorldToViewportPoint(worldPos)
	return Vector2.new(v.X, v.Y), onScreen and v.Z > 0
end

local function popup(position, text, color, size, rise)
	local l = label(gui, UDim2.fromOffset(240, 60), UDim2.fromOffset(position.X - 120, position.Y - 30), size, text)
	l.TextColor3 = color
	TweenService:Create(l, TweenInfo.new(0.8, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		Position = UDim2.fromOffset(position.X - 120, position.Y - 30 - rise), TextTransparency = 1, TextStrokeTransparency = 1,
	}):Play()
	Debris:AddItem(l, 1)
end

local function mySlot()
	local mine = fightersFolder:FindFirstChild(myId)
	return mine and mine:GetAttribute("Slot")
end

local handlers = {}

function handlers.Swing(position, kind)
	playSound("swing", 0.35, if kind == "Smash" then 0.8 else 1.15)
end

function handlers.Hit(position, damage, power, targetSlot)
	local screen = toScreen(position + Vector3.new(0, 3, 0))
	local big = damage >= 12
	popup(screen, "-" .. damage, if big then Color3.fromRGB(255, 120, 60) else Color3.fromRGB(255, 240, 160), if big then 44 else 32, 50)
	playSound("hit", math.clamp(power / 220, 0.25, 0.8), if big then 0.8 else 1.1)
	local mine = targetSlot == mySlot()
	shake = math.max(shake, math.clamp(power / 90, 0.3, 3) * (if mine then 1.4 else 1))
	if mine then flashScreen(math.clamp(power / 400, 0.15, 0.45)) end
end

function handlers.KO(position, name)
	local screen = toScreen(position)
	local vs = viewport()
	-- 画面の外でやられたときは、その方向の画面のふちに出す
	local x = math.clamp(screen.X, 80, vs.X - 80)
	local y = math.clamp(screen.Y, 80, vs.Y - 150)
	popup(Vector2.new(x, y), "KO!", Color3.fromRGB(255, 80, 70), 64, 30)
	popup(Vector2.new(x, y + 40), name, Color3.new(1, 1, 1), 20, 20)
	playSound("ko", 0.7, 0.9)
	shake = math.max(shake, 3.5)
end

function handlers.Item(position, kind, name)
	playSound("item", 0.6, if kind == "heal" then 1.2 else 0.9)
	popup(toScreen(position), if kind == "heal" then "回復！" else "パワー！", if kind == "heal" then Color3.fromRGB(110, 240, 150) else Color3.fromRGB(255, 170, 60), 36, 50)
end

function handlers.Count(n)
	if n > 0 then
		showCount(tostring(n), Color3.new(1, 1, 1))
		playSound("count", 0.5, 1)
	else
		showCount("ファイト！", Color3.fromRGB(255, 220, 90))
		playSound("count", 0.6, 1.6)
	end
end

function handlers.Win(name, isHuman)
	if name ~= "" then
		playSound("win", 0.7, 1)
		if name == player.DisplayName then showCount("YOU WIN!", Color3.fromRGB(255, 220, 90)) end
	end
end

fxRemote.OnClientEvent:Connect(function(kind, ...)
	local fn = handlers[kind]
	if fn then fn(...) end
end)

-- アイテムを回して、上下に動かす
local itemBase = setmetatable({}, { __mode = "k" })
RunService.RenderStepped:Connect(function()
	local t = os.clock()
	for _, part in CollectionService:GetTagged("Item") do
		local base = itemBase[part]
		if not base then
			base = part.CFrame
			itemBase[part] = base
		end
		part.CFrame = base * CFrame.Angles(0, t * 2, 0) + Vector3.new(0, math.sin(t * 3) * 0.7, 0)
	end
end)
