--[[
	スカイ乱闘（仮称）プレイヤー側
	置き場所: StarterPlayer > StarterPlayerScripts の中に LocalScript として入れる

	・横から見たカメラ
	・攻撃ボタン（パソコン・スマホ・コントローラー）
	・2段ジャンプ
	・画面の表示（残り時間、全員の％と残機）
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local ContextActionService = game:GetService("ContextActionService")

local player = Players.LocalPlayer
local remotes = ReplicatedStorage:WaitForChild("SmashRemotes")
local attackRemote = remotes:WaitForChild("Attack")
local knockRemote = remotes:WaitForChild("Knockback")
local status = remotes:WaitForChild("Status")

local CAMERA_OFFSET = Vector3.new(0, 6, 62)
local STAGE_FOCUS = Vector3.new(0, 8, 0)

---------------------------------------------------------------- カメラ（横から見る）

local camera = workspace.CurrentCamera
local focus = STAGE_FOCUS

RunService:BindToRenderStep("SmashCamera", Enum.RenderPriority.Camera.Value + 1, function(dt)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	local target = STAGE_FOCUS
	if root then
		-- 自分とステージの中間を映す。落ちていくときに画面が追いかけすぎないようにする
		target = Vector3.new(math.clamp(root.Position.X, -70, 70) * 0.6, math.clamp(root.Position.Y, -10, 60) * 0.6 + 4, 0)
	end
	focus = focus:Lerp(target, math.min(dt * 6, 1))
	camera.CameraType = Enum.CameraType.Scriptable
	camera.FieldOfView = 50
	camera.CFrame = CFrame.lookAt(focus + CAMERA_OFFSET, focus)
end)

---------------------------------------------------------------- 吹っ飛び

local stunToken = 0

knockRemote.OnClientEvent:Connect(function(velocity)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not root or not humanoid or typeof(velocity) ~= "Vector3" then return end
	humanoid:ChangeState(Enum.HumanoidStateType.Freefall)   -- 地面にいると踏ん張ってしまうので、浮かせてから飛ばす
	root.AssemblyLinearVelocity = velocity

	-- 吹っ飛んでいる間は操作できなくする。反対方向のキーで勢いを打ち消せてしまうのを防ぐ
	stunToken += 1
	local token = stunToken
	humanoid.PlatformStand = true
	task.delay(math.clamp(velocity.Magnitude / 400, 0.12, 0.5), function()
		if token == stunToken and humanoid.Parent then humanoid.PlatformStand = false end
	end)
end)

---------------------------------------------------------------- 奥行きを固定（W/Sで奥に逃げられないようにする）

RunService.Heartbeat:Connect(function()
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if not root then return end
	local z = root.Position.Z
	-- 観戦台（奥の別の場所）にいるときは固定しない
	if math.abs(z) > 0.05 and math.abs(z) <= 8 then
		local v = root.AssemblyLinearVelocity
		root.CFrame = root.CFrame - Vector3.new(0, 0, z)
		root.AssemblyLinearVelocity = Vector3.new(v.X, v.Y, 0)
	end
end)

---------------------------------------------------------------- 2段ジャンプ

local humanoid = nil
local canDouble, usedDouble = false, false

local function onCharacter(character)
	humanoid = character:WaitForChild("Humanoid")
	canDouble, usedDouble = false, false
	humanoid.StateChanged:Connect(function(_, new)
		if new == Enum.HumanoidStateType.Landed or new == Enum.HumanoidStateType.Running then
			canDouble, usedDouble = false, false
		elseif new == Enum.HumanoidStateType.Freefall then
			task.delay(0.12, function() canDouble = true end)   -- 1回目のジャンプと区別するための間
		end
	end)
end

if player.Character then task.spawn(onCharacter, player.Character) end
player.CharacterAdded:Connect(onCharacter)

UserInputService.JumpRequest:Connect(function()
	if humanoid and canDouble and not usedDouble and humanoid:GetState() == Enum.HumanoidStateType.Freefall then
		usedDouble = true
		humanoid:ChangeState(Enum.HumanoidStateType.Jumping)
	end
end)

---------------------------------------------------------------- 攻撃ボタン

local function bindAttack(action, kind, title, position, ...)
	ContextActionService:BindAction(action, function(_, state)
		if state == Enum.UserInputState.Begin then attackRemote:FireServer(kind) end
		return Enum.ContextActionResult.Pass
	end, true, ...)
	ContextActionService:SetTitle(action, title)
	ContextActionService:SetPosition(action, position)
end

bindAttack("SmashLight", "Light", "攻撃", UDim2.new(1, -150, 1, -150), Enum.UserInputType.MouseButton1, Enum.KeyCode.J, Enum.KeyCode.ButtonX)
bindAttack("SmashHeavy", "Smash", "スマッシュ", UDim2.new(1, -80, 1, -210), Enum.KeyCode.K, Enum.KeyCode.E, Enum.KeyCode.ButtonY)

---------------------------------------------------------------- 画面の表示

local gui = Instance.new("ScreenGui")
gui.Name = "SmashHud"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.Parent = player:WaitForChild("PlayerGui")

local function label(parent, size, position, textSize)
	local l = Instance.new("TextLabel")
	l.Size = size
	l.Position = position
	l.BackgroundTransparency = 1
	l.Font = Enum.Font.GothamBlack
	l.TextSize = textSize
	l.TextColor3 = Color3.new(1, 1, 1)
	l.TextStrokeTransparency = 0.3
	l.Parent = parent
	return l
end

local statusLabel = label(gui, UDim2.new(1, 0, 0, 40), UDim2.new(0, 0, 0, 44), 28)
statusLabel.Text = status.Value
status.Changed:Connect(function(value) statusLabel.Text = value end)

local help = label(gui, UDim2.new(1, 0, 0, 20), UDim2.new(0, 0, 0, 84), 14)
help.Text = if UserInputService.TouchEnabled
	then "ボタンで攻撃 ／ ジャンプは2回まで"
	else "クリックかJ：攻撃　KかE：スマッシュ　スペース：ジャンプ（2回まで）"

local bar = Instance.new("Frame")
bar.Size = UDim2.new(1, 0, 0, 70)
bar.Position = UDim2.new(0, 0, 1, -80)
bar.BackgroundTransparency = 1
bar.Parent = gui

local layout = Instance.new("UIListLayout")
layout.FillDirection = Enum.FillDirection.Horizontal
layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
layout.Padding = UDim.new(0, 12)
layout.Parent = bar

local cards = {}   -- [Player] = { frame, percent, info }

local function cardFor(other)
	local card = cards[other]
	if card then return card end
	local frame = Instance.new("Frame")
	frame.Size = UDim2.new(0, 130, 1, 0)
	frame.BackgroundColor3 = if other == player then Color3.fromRGB(200, 60, 60) else Color3.fromRGB(40, 50, 70)
	frame.BackgroundTransparency = 0.25
	frame.Parent = bar
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 10)
	corner.Parent = frame
	card = {
		frame = frame,
		percent = label(frame, UDim2.new(1, 0, 0, 40), UDim2.new(0, 0, 0, 2), 32),
		info = label(frame, UDim2.new(1, -8, 0, 22), UDim2.new(0, 4, 0, 44), 14),
	}
	card.info.TextTruncate = Enum.TextTruncate.AtEnd
	cards[other] = card
	return card
end

Players.PlayerRemoving:Connect(function(other)
	if cards[other] then
		cards[other].frame:Destroy()
		cards[other] = nil
	end
end)

while true do
	local players = Players:GetPlayers()
	local cardWidth = if #players <= 4 then 130 elseif #players <= 6 then 104 else 84   -- 人数が増えたらカードを細くする
	for _, other in players do
		local card = cardFor(other)
		card.frame.Size = UDim2.new(0, cardWidth, 1, 0)
		local percent = other:GetAttribute("Percent") or 0
		local stocks = other:GetAttribute("Stocks") or 0
		card.percent.Text = percent .. "%"
		-- ％が高いほど赤くして、危ないことが一目でわかるようにする
		card.percent.TextColor3 = Color3.new(1, 1, 1):Lerp(Color3.fromRGB(255, 70, 50), math.min(percent / 150, 1))
		card.info.Text = if other:GetAttribute("Fighting")
			then string.rep("●", stocks) .. " " .. other.DisplayName
			else other.DisplayName
	end
	task.wait(0.15)
end
