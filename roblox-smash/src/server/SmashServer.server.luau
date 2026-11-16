--[[
	スカイ乱闘（仮称）サーバー側
	置き場所: ServerScriptService の中に Script として入れる

	・空に浮かぶステージを自動で作る
	・攻撃を当てるとダメージ（％）がたまり、％が高いほど大きく吹っ飛ぶ
	・画面の外まで飛ばされると残機が1つ減る。最後まで残った人の勝ち
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Debris = game:GetService("Debris")

-- ここの数字を変えると、ゲームの手ごたえを調整できる
local CONFIG = {
	MinPlayers = 2,        -- 試合を始める人数
	Stocks = 3,            -- 残機
	MatchSeconds = 180,    -- 1試合の長さ
	Intermission = 8,      -- 試合前の待ち時間
	ResultSeconds = 6,     -- 結果を表示する時間
	RespawnDelay = 1.2,    -- やられてから復活するまで
	ShieldSeconds = 2,     -- 復活直後の無敵時間
	WalkSpeed = 22,
	JumpPower = 60,
	Blast = { Side = 110, Top = 140, Bottom = -45 },   -- ここを越えるとやられる
	Attacks = {
		-- Damage: たまる％ / Base・Scale: 吹っ飛ぶ強さ = Base + ％×Scale / Angle: 飛ぶ角度
		Light = { Damage = 6, Range = 6.5, Base = 30, Scale = 0.6, Angle = 30, Cooldown = 0.35 },
		Smash = { Damage = 15, Range = 8, Base = 55, Scale = 1.2, Angle = 42, Cooldown = 1.2 },
	},
}

local SPAWN_X = { -24, -8, 8, 24 }
local SPAWN_Y = 8
local SPECTATOR_CFRAME = CFrame.new(0, 14, -14)

---------------------------------------------------------------- ステージ

for _, name in { "Baseplate", "SmashStage" } do
	local old = workspace:FindFirstChild(name)
	if old then old:Destroy() end
end
for _, inst in workspace:GetDescendants() do
	if inst:IsA("SpawnLocation") then inst:Destroy() end
end

local stage = Instance.new("Folder")
stage.Name = "SmashStage"
stage.Parent = workspace

local function block(name, size, position, color, material, transparency)
	local p = Instance.new("Part")
	p.Name = name
	p.Anchored = true
	p.Size = size
	p.Position = position
	p.Color = color
	p.Material = material or Enum.Material.SmoothPlastic
	p.Transparency = transparency or 0
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = stage
	return p
end

block("Main", Vector3.new(70, 4, 8), Vector3.new(0, 0, 0), Color3.fromRGB(70, 80, 110), Enum.Material.Slate)
block("PlatformLeft", Vector3.new(16, 1, 8), Vector3.new(-20, 9.5, 0), Color3.fromRGB(240, 190, 70))
block("PlatformRight", Vector3.new(16, 1, 8), Vector3.new(20, 9.5, 0), Color3.fromRGB(240, 190, 70))
block("PlatformTop", Vector3.new(16, 1, 8), Vector3.new(0, 17.5, 0), Color3.fromRGB(240, 190, 70))
-- 手前と奥に見えない壁を置いて、横から見た2Dの動きにする
block("WallFront", Vector3.new(600, 600, 2), Vector3.new(0, 100, 5), Color3.new(1, 1, 1), nil, 1)
block("WallBack", Vector3.new(600, 600, 2), Vector3.new(0, 100, -5), Color3.new(1, 1, 1), nil, 1)
-- 観戦台（やられた人と、途中から来た人が立つ場所）
block("Spectator", Vector3.new(50, 1, 8), Vector3.new(0, 10, -14), Color3.fromRGB(120, 130, 150), Enum.Material.Glass, 0.4)

---------------------------------------------------------------- 通信

local remotes = Instance.new("Folder")
remotes.Name = "SmashRemotes"
remotes.Parent = ReplicatedStorage

local attackRemote = Instance.new("RemoteEvent")
attackRemote.Name = "Attack"
attackRemote.Parent = remotes

local knockRemote = Instance.new("RemoteEvent")
knockRemote.Name = "Knockback"
knockRemote.Parent = remotes

local status = Instance.new("StringValue")
status.Name = "Status"
status.Parent = remotes

---------------------------------------------------------------- プレイヤーの状態

local phase = "Waiting"   -- Waiting / Intermission / Fight / Result
local data = {}           -- [Player] = { stocks, percent, fighting, slot, ... }

local function sync(player)
	local d = data[player]
	if not d then return end
	player:SetAttribute("Percent", math.floor(d.percent))
	player:SetAttribute("Stocks", d.stocks)
	player:SetAttribute("Fighting", d.fighting)
end

local function rootOf(player)
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if humanoid and root and humanoid.Health > 0 then
		return root, humanoid
	end
	return nil, nil
end

local function burst(position, color, size)
	local p = Instance.new("Part")
	p.Shape = Enum.PartType.Ball
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.Material = Enum.Material.Neon
	p.Color = color
	p.Size = Vector3.one * size
	p.Position = position
	p.Transparency = 0.3
	p.Parent = workspace
	Debris:AddItem(p, 0.15)
end

local function spawnCharacter(player)
	local d = data[player]
	if not d or d.loading then return end
	d.loading = true
	pcall(function() player:LoadCharacter() end)
	d.loading = false
end

local knockOut

local function onCharacter(player, character)
	local d = data[player]
	if not d then return end
	local humanoid = character:WaitForChild("Humanoid", 10)
	local root = character:WaitForChild("HumanoidRootPart", 10)
	if not humanoid or not root then return end

	humanoid.UseJumpPower = true
	humanoid.JumpPower = CONFIG.JumpPower
	humanoid.WalkSpeed = CONFIG.WalkSpeed
	humanoid.Died:Connect(function() knockOut(player) end)

	RunService.Heartbeat:Wait()   -- 出現位置が決まってから動かす
	if phase == "Fight" and not d.fighting then
		character:PivotTo(SPECTATOR_CFRAME)
	else
		character:PivotTo(CFrame.new(SPAWN_X[(d.slot - 1) % #SPAWN_X + 1], SPAWN_Y, 0))
		local shield = Instance.new("ForceField")
		shield.Parent = character
		Debris:AddItem(shield, CONFIG.ShieldSeconds)
	end
end

function knockOut(player)
	local d = data[player]
	if not d or d.koLock then return end
	d.koLock = true

	local root = rootOf(player)
	if root then burst(root.Position, Color3.fromRGB(255, 240, 150), 30) end

	if phase == "Fight" and d.fighting then
		d.stocks -= 1
		if d.stocks <= 0 then d.fighting = false end
		-- 直前に攻撃を当てた人の得点にする
		local attacker = d.lastHitBy
		if attacker and attacker.Parent and os.clock() - d.lastHitAt < 8 then
			local stats = attacker:FindFirstChild("leaderstats")
			if stats then stats.KOs.Value += 1 end
		end
	end
	d.percent = 0
	d.lastHitBy = nil
	sync(player)

	task.delay(CONFIG.RespawnDelay, function()
		if player.Parent then spawnCharacter(player) end
		d.koLock = false
	end)
end

Players.CharacterAutoLoads = false   -- 復活はすべてこのスクリプトで管理する

local function onPlayer(player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	for _, name in { "Wins", "KOs" } do
		local v = Instance.new("IntValue")
		v.Name = name
		v.Parent = stats
	end
	stats.Parent = player

	data[player] = {
		stocks = 0, percent = 0, fighting = false, slot = #Players:GetPlayers(),
		lastHitBy = nil, lastHitAt = 0, nextAttack = {}, loading = false, koLock = false,
	}
	sync(player)
	player.CharacterAdded:Connect(function(character) onCharacter(player, character) end)
	spawnCharacter(player)
end

Players.PlayerAdded:Connect(onPlayer)
Players.PlayerRemoving:Connect(function(player) data[player] = nil end)
for _, player in Players:GetPlayers() do task.spawn(onPlayer, player) end

---------------------------------------------------------------- 攻撃

-- 試合中は、試合に出ている人どうしだけが当たる。試合の外では、誰でも練習で殴り合える
local function canFight(player)
	local d = data[player]
	return d ~= nil and not d.koLock and (phase ~= "Fight" or d.fighting)
end

attackRemote.OnServerEvent:Connect(function(player, kind)
	if type(kind) ~= "string" then return end
	local spec = CONFIG.Attacks[kind]
	local d = data[player]
	if not spec or not d or not canFight(player) then return end

	local now = os.clock()
	if now < (d.nextAttack[kind] or 0) then return end   -- 連打の制限はサーバーで見る
	d.nextAttack[kind] = now + spec.Cooldown

	local root = rootOf(player)
	if not root then return end
	local facing = if root.CFrame.LookVector.X < 0 then -1 else 1
	burst(root.Position + Vector3.new(facing * spec.Range * 0.6, 0.5, 0), Color3.fromRGB(255, 255, 255), spec.Range * 0.6)

	for _, target in Players:GetPlayers() do
		local td = data[target]
		if target ~= player and td and canFight(target) then
			local targetRoot = rootOf(target)
			if targetRoot and not target.Character:FindFirstChildOfClass("ForceField") then
				local offset = targetRoot.Position - root.Position
				local inFront = offset.X * facing > -1.5 and math.abs(offset.X) <= spec.Range
				if inFront and math.abs(offset.Y) <= 5 and math.abs(offset.Z) <= 6 then
					td.percent = math.min(td.percent + spec.Damage, 999)
					td.lastHitBy = player
					td.lastHitAt = now
					sync(target)

					local power = spec.Base + td.percent * spec.Scale
					local angle = math.rad(spec.Angle)
					local velocity = Vector3.new(facing * math.cos(angle), math.sin(angle), 0) * power
					-- キャラクターの動きは本人の端末が計算しているので、吹っ飛びは本人の端末に伝えて動かす
					knockRemote:FireClient(target, velocity)
					burst(targetRoot.Position, Color3.fromRGB(255, 120, 60), 3 + power / 25)
				end
			end
		end
	end
end)

RunService.Heartbeat:Connect(function()
	for player, d in data do
		if not d.koLock then
			local root = rootOf(player)
			if root then
				local p = root.Position
				if math.abs(p.X) > CONFIG.Blast.Side or p.Y > CONFIG.Blast.Top or p.Y < CONFIG.Blast.Bottom then
					knockOut(player)
				end
			end
		end
	end
end)

---------------------------------------------------------------- 試合の進行

local function fighters()
	local list = {}
	for player, d in data do
		if d.fighting then table.insert(list, player) end
	end
	return list
end

task.spawn(function()
	while true do
		phase = "Waiting"
		while #Players:GetPlayers() < CONFIG.MinPlayers do
			status.Value = ("あと%d人で試合開始（今は練習できます）"):format(CONFIG.MinPlayers - #Players:GetPlayers())
			task.wait(1)
		end

		phase = "Intermission"
		for t = CONFIG.Intermission, 1, -1 do
			status.Value = ("まもなく試合開始 %d"):format(t)
			task.wait(1)
		end
		if #Players:GetPlayers() < CONFIG.MinPlayers then continue end

		phase = "Fight"
		for i, player in Players:GetPlayers() do
			local d = data[player]
			if d then
				d.fighting, d.stocks, d.percent, d.slot = true, CONFIG.Stocks, 0, i
				sync(player)
				task.spawn(spawnCharacter, player)
			end
		end

		local deadline = os.clock() + CONFIG.MatchSeconds
		local winner = nil
		while true do
			task.wait(0.25)
			local alive = fighters()
			if #alive <= 1 then
				winner = alive[1]
				break
			end
			local left = deadline - os.clock()
			if left <= 0 then
				-- 時間切れ：残機が多い人、同じなら％が低い人の勝ち
				table.sort(alive, function(a, b)
					local da, db = data[a], data[b]
					if da.stocks ~= db.stocks then return da.stocks > db.stocks end
					return da.percent < db.percent
				end)
				local first, second = data[alive[1]], data[alive[2]]
				if first.stocks ~= second.stocks or first.percent ~= second.percent then winner = alive[1] end
				break
			end
			status.Value = ("のこり %d:%02d"):format(left // 60, left % 60)
		end

		phase = "Result"
		if winner and winner.Parent then
			winner.leaderstats.Wins.Value += 1
			status.Value = winner.DisplayName .. " の勝ち！"
		else
			status.Value = "引き分け"
		end
		for player, d in data do
			d.fighting, d.stocks = false, 0
			sync(player)
		end
		task.wait(CONFIG.ResultSeconds)

		phase = "Waiting"
		for player in data do task.spawn(spawnCharacter, player) end   -- 全員をステージに戻す
		task.wait(1)
	end
end)
