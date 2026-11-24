--!nonstrict
--[[
	スカイ乱闘：サーバー側
	置き場所: ServerScriptService の中に Script として入れる（名前は SmashServer）
	あわせて必要: ServerScriptService に ModuleScript「BotBrain」、ReplicatedStorage に ModuleScript「SmashShared」

	・人が少ないときはボットが参加して、1人でも試合になる
	・ステージは3種類。試合ごとに変わる
	・攻撃を当てると％がたまり、％が高いほど大きく吹っ飛ぶ。場外まで飛ばされると残機が1つ減る
	・アイテム（回復・パワー）が時々出る
	手ごたえの数字は SmashShared を変えて調整する。
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")
local RunService = game:GetService("RunService")
local Debris = game:GetService("Debris")
local TweenService = game:GetService("TweenService")
local CollectionService = game:GetService("CollectionService")
local PhysicsService = game:GetService("PhysicsService")
local DataStoreService = game:GetService("DataStoreService")

local Shared = require(ReplicatedStorage:WaitForChild("SmashShared"))
local BotBrain = require(ServerScriptService:WaitForChild("BotBrain"))
local C = Shared.Config

local SPECTATOR_CFRAME = CFrame.new(0, 14, -14)
local FOOT = 3   -- キャラクターの中心から足の裏までの高さ

---------------------------------------------------------------- 通信

local remotes = Instance.new("Folder")
remotes.Name = "SmashRemotes"
remotes.Parent = ReplicatedStorage

local function makeRemote(name)
	local r = Instance.new("RemoteEvent")
	r.Name = name
	r.Parent = remotes
	return r
end
local attackRemote = makeRemote("Attack")   -- 本人 → サーバー：攻撃（種類, 向き指定, 左右）
local selectRemote = makeRemote("Select")   -- 本人 → サーバー：ファイターの選択
local knockRemote = makeRemote("Knock")     -- サーバー → 本人：吹っ飛ばし（速さ, 操作できない秒数）
local fxRemote = makeRemote("Fx")           -- サーバー → 全員：演出（種類, ...）

local function makeValue(class, name, initial)
	local v = Instance.new(class)
	v.Name = name
	v.Value = initial
	v.Parent = remotes
	return v
end
local statusValue = makeValue("StringValue", "Status", "")     -- 画面上の大きな文字
local phaseValue = makeValue("StringValue", "Phase", "Lobby")  -- Lobby / Ready / Fight / Result
local stageValue = makeValue("StringValue", "StageName", "")
local timeValue = makeValue("NumberValue", "TimeLeft", 0)

local fightersFolder = Instance.new("Folder")   -- 全員の状態（％・残機など）。画面の表示に使う
fightersFolder.Name = "Fighters"
fightersFolder.Parent = remotes

local function fx(...)
	fxRemote:FireAllClients(...)
end

---------------------------------------------------------------- ぶつからない設定・ステージ

pcall(function() PhysicsService:RegisterCollisionGroup("Fighters") end)
pcall(function() PhysicsService:CollisionGroupSetCollidable("Fighters", "Fighters", false) end)   -- 選手どうしはすり抜ける

for _, name in { "Baseplate", "SmashStage" } do
	local old = workspace:FindFirstChild(name)
	if old then old:Destroy() end
end
for _, inst in workspace:GetDescendants() do
	if inst:IsA("SpawnLocation") then inst:Destroy() end
end

local layout = Shared.Layouts[1]
local stageFolder = nil

local function color3(rgb)
	return Color3.fromRGB(rgb[1], rgb[2], rgb[3])
end

local function block(parent, name, size, position, color, material, transparency)
	local p = Instance.new("Part")
	p.Name = name
	p.Anchored = true
	p.Size = Vector3.new(size[1], size[2], size[3])
	p.Position = Vector3.new(position[1], position[2], position[3])
	p.Color = color
	p.Material = material
	p.Transparency = transparency or 0
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

local function buildStage(newLayout)
	layout = newLayout
	if stageFolder then stageFolder:Destroy() end
	stageFolder = Instance.new("Folder")
	stageFolder.Name = "SmashStage"
	stageFolder.Parent = workspace
	for _, def in newLayout.parts do
		block(stageFolder, def[1], def[2], def[3], color3(def[4]), Enum.Material[def[5]])
	end
	-- 手前と奥に見えない壁を置いて、横から見た2Dの動きにする
	block(stageFolder, "WallFront", { 600, 600, 2 }, { 0, 100, 5 }, Color3.new(1, 1, 1), Enum.Material.SmoothPlastic, 1)
	block(stageFolder, "WallBack", { 600, 600, 2 }, { 0, 100, -5 }, Color3.new(1, 1, 1), Enum.Material.SmoothPlastic, 1)
	-- 観戦台（やられた人が見守る場所）
	block(stageFolder, "Spectator", { 50, 1, 8 }, { 0, 10, -14 }, Color3.fromRGB(120, 130, 150), Enum.Material.Glass, 0.4)
	stageValue.Value = newLayout.name
end

---------------------------------------------------------------- 選手（人とボット）

local phase = "Lobby"
local fighters = {}      -- [id] = 選手
local botCount = 0

local function setPhase(p)
	phase = p
	phaseValue.Value = p
end

local function syncFighter(f)
	local a = f.folder
	a:SetAttribute("Name", f.name)
	a:SetAttribute("Percent", math.floor(f.percent))
	a:SetAttribute("Stocks", f.stocks)
	a:SetAttribute("Fighting", f.fighting)
	a:SetAttribute("Type", Shared.Fighters[f.typeIndex].id)
	a:SetAttribute("Slot", f.slot)
	a:SetAttribute("Bot", f.kind == "bot")
	a:SetAttribute("Power", os.clock() < f.powerUntil)
	a:SetAttribute("KOs", f.kos)
end

local function newFighter(id, kind, name, player)
	local folder = Instance.new("Folder")
	folder.Name = id
	folder.Parent = fightersFolder
	local f = {
		id = id, kind = kind, name = name, player = player, folder = folder, model = nil,
		percent = 0, stocks = 0, fighting = false, typeIndex = 2, slot = 1, kos = 0,
		koLock = false, loading = false, lastHitBy = nil, lastHitAt = 0,
		nextAttack = { Light = 0, Smash = 0 }, nextDash = 0, dashUntil = 0, dashDir = 1,
		powerUntil = 0, stunUntil = 0, canDouble = true, facing = 1,
		mind = nil, intent = nil,
	}
	fighters[id] = f
	syncFighter(f)
	return f
end

local function removeFighter(f)
	fighters[f.id] = nil
	if f.folder then f.folder:Destroy() end
	if f.kind == "bot" and f.model then f.model:Destroy() end
end

local function rootOf(f)
	local character = if f.kind == "bot" then f.model else (f.player and f.player.Character)
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if humanoid and root and humanoid.Health > 0 then
		return root, humanoid, character
	end
	return nil, nil, nil
end

local function snapshot()
	local list = {}
	for _, f in fighters do table.insert(list, f) end
	return list
end

local function countFighting()
	local n, humans = 0, 0
	for _, f in fighters do
		if f.fighting then
			n += 1
			if f.kind == "player" then humans += 1 end
		end
	end
	return n, humans
end

---------------------------------------------------------------- 攻撃のモーション
-- 関節（Motor6D）を動かして、腕を振る・体を傾ける。サーバーで動かすので、ほかのプレイヤーにも見える。
-- 標準のアバター（R15）用。体型が違うときは何もしない。

-- arm: 腕の振り / lean: 体の傾き（度）。t はその動きにかける秒数
local POSES = {
	Light = { { t = 0.05, arm = -30, lean = 5 }, { t = 0.07, arm = 100, lean = -12 }, { t = 0.14, arm = 0, lean = 0 } },
	Smash = { { t = 0.16, arm = -120, lean = 10 }, { t = 0.07, arm = 110, lean = -25 }, { t = 0.25, arm = 0, lean = 0 } },
	Hit = { { t = 0.05, arm = -25, lean = 14 }, { t = 0.2, arm = 0, lean = 0 } },   -- やられたときののけぞり
}

local poseToken = setmetatable({}, { __mode = "k" })

local function pose(character, steps)
	if not character then return end
	local shoulder = character:FindFirstChild("RightShoulder", true)
	local waist = character:FindFirstChild("Waist", true)
	if not (shoulder and shoulder:IsA("Motor6D") and waist and waist:IsA("Motor6D")) then return end

	for _, joint in { shoulder, waist } do
		if joint:GetAttribute("BaseC0") == nil then joint:SetAttribute("BaseC0", joint.C0) end   -- 元の位置を覚える
	end
	local baseShoulder, baseWaist = shoulder:GetAttribute("BaseC0"), waist:GetAttribute("BaseC0")

	local token = (poseToken[character] or 0) + 1
	poseToken[character] = token   -- 新しい動きが始まったら、前の動きは打ち切る
	for _, step in steps do
		if poseToken[character] ~= token or not shoulder.Parent or not waist.Parent then return end
		local info = TweenInfo.new(step.t, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
		TweenService:Create(shoulder, info, { C0 = baseShoulder * CFrame.Angles(math.rad(step.arm), 0, 0) }):Play()
		TweenService:Create(waist, info, { C0 = baseWaist * CFrame.Angles(math.rad(step.lean), 0, 0) }):Play()
		task.wait(step.t)
	end
end

local function flash(character)
	local h = Instance.new("Highlight")
	h.FillColor = Color3.fromRGB(255, 60, 40)
	h.FillTransparency = 0.35
	h.OutlineTransparency = 1
	h.Parent = character
	Debris:AddItem(h, 0.15)
end

---------------------------------------------------------------- キャラクターの準備

local function setCollisionGroup(character)
	for _, part in character:GetDescendants() do
		if part:IsA("BasePart") then part.CollisionGroup = "Fighters" end
	end
end

local function applyStats(f, humanoid)
	local def = Shared.Fighters[f.typeIndex]
	humanoid.UseJumpPower = true
	humanoid.WalkSpeed = def.walk
	humanoid.JumpPower = def.jump
end

local function prepareCharacter(f, character)
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if humanoid then applyStats(f, humanoid) end
	character:SetAttribute("FighterId", f.id)
	CollectionService:AddTag(character, "Fighter")
	setCollisionGroup(character)
	character.DescendantAdded:Connect(function(inst)
		if inst:IsA("BasePart") then inst.CollisionGroup = "Fighters" end   -- あとから付いたアクセサリー
	end)

	local mark = Instance.new("Highlight")   -- 誰がだれか分かる、体のふちの色
	mark.Name = "Mark"
	mark.FillTransparency = 1
	mark.OutlineTransparency = 0.15
	mark.OutlineColor = color3(Shared.SlotColors[(f.slot - 1) % #Shared.SlotColors + 1])
	mark.DepthMode = Enum.HighlightDepthMode.AlwaysOnTop
	mark.Parent = character
	f.mark = mark
end

local function spawnCFrame(f)
	local s = layout.spawns[(f.slot - 1) % #layout.spawns + 1]
	return CFrame.new(s[1], s[2] + FOOT, 0)
end

local function giveShield(character, seconds)
	local ff = Instance.new("ForceField")
	ff.Parent = character
	Debris:AddItem(ff, seconds)
end

---------------------------------------------------------------- 人の出現とやられ

local knockOut

local function onPlayerCharacter(f, character)
	local humanoid = character:WaitForChild("Humanoid", 10)
	local root = character:WaitForChild("HumanoidRootPart", 10)
	if not humanoid or not root then return end
	prepareCharacter(f, character)
	humanoid.Died:Connect(function() knockOut(f) end)

	RunService.Heartbeat:Wait()   -- 出現位置が決まってから動かす
	if (phase == "Ready" or phase == "Fight") and not f.fighting then
		character:PivotTo(SPECTATOR_CFRAME)   -- 試合に出ていない人は観戦台へ
	else
		character:PivotTo(spawnCFrame(f))
		giveShield(character, if f.fighting then C.ShieldSeconds else 1)
	end
end

local function loadPlayer(f)
	if f.loading or not f.player or not f.player.Parent then return end
	f.loading = true
	pcall(function() f.player:LoadCharacter() end)
	f.loading = false
end

---------------------------------------------------------------- ボット

local BOT_COLORS = {
	Color3.fromRGB(240, 120, 120), Color3.fromRGB(120, 170, 240), Color3.fromRGB(240, 210, 110),
	Color3.fromRGB(130, 220, 150), Color3.fromRGB(200, 150, 240), Color3.fromRGB(240, 170, 110),
	Color3.fromRGB(120, 220, 220), Color3.fromRGB(240, 160, 210),
}

local function makeBotModel(f)
	local desc = Instance.new("HumanoidDescription")
	local c = BOT_COLORS[(f.slot - 1) % #BOT_COLORS + 1]
	desc.HeadColor, desc.TorsoColor, desc.LeftArmColor, desc.RightArmColor = c, c, c, c
	desc.LeftLegColor, desc.RightLegColor = c, c
	local ok, model = pcall(function()
		return Players:CreateHumanoidModelFromDescription(desc, Enum.HumanoidRigType.R15)
	end)
	if not ok or not model then return nil end
	local humanoid = model:FindFirstChildOfClass("Humanoid")
	local root = model:FindFirstChild("HumanoidRootPart")
	if not humanoid or not root then
		model:Destroy()
		return nil
	end
	model.Name = f.name
	humanoid.DisplayName = f.name
	model.Parent = workspace
	f.model = model
	prepareCharacter(f, model)
	model:PivotTo(spawnCFrame(f))
	pcall(function() root:SetNetworkOwner(nil) end)   -- 動かすのはサーバー
	giveShield(model, C.ShieldSeconds)
	return model
end

local function respawnBot(f)
	local root, humanoid, character = rootOf(f)
	if not root then return end
	humanoid.PlatformStand = false
	humanoid.Health = humanoid.MaxHealth
	character:PivotTo(spawnCFrame(f))
	root.AssemblyLinearVelocity = Vector3.zero
	giveShield(character, C.ShieldSeconds)
end

---------------------------------------------------------------- やられ・復活

function knockOut(f)
	if f.koLock then return end
	f.koLock = true

	local root = rootOf(f)
	fx("KO", if root then root.Position else Vector3.zero, f.name, f.slot)

	if phase == "Fight" and f.fighting then
		f.stocks -= 1
		if f.stocks <= 0 then f.fighting = false end
		local attacker = f.lastHitBy and fighters[f.lastHitBy]
		if attacker and os.clock() - f.lastHitAt < 8 then   -- 直前に攻撃を当てた人の得点にする
			attacker.kos += 1
			syncFighter(attacker)
		end
	end
	f.percent = 0
	f.lastHitBy = nil
	f.powerUntil = 0
	f.stunUntil = 0
	syncFighter(f)

	task.delay(C.RespawnDelay, function()
		if fighters[f.id] then
			if f.kind == "bot" then
				if f.fighting then respawnBot(f) elseif f.model then f.model:PivotTo(SPECTATOR_CFRAME) end
			else
				loadPlayer(f)
			end
		end
		f.koLock = false
	end)
end

---------------------------------------------------------------- 攻撃

local function applyKnock(target, vx, vy)
	local stun = Shared.stunSeconds(vx, vy)
	target.stunUntil = os.clock() + stun
	if target.kind == "player" then
		-- キャラクターの動きは本人の端末が計算しているので、吹っ飛びは本人の端末に伝えて動かす
		if target.player then knockRemote:FireClient(target.player, Vector3.new(vx, vy, 0), stun) end
	else
		local root, humanoid = rootOf(target)
		if root then
			humanoid.PlatformStand = true
			root.AssemblyLinearVelocity = Vector3.new(vx, vy, 0)
			task.delay(stun, function()
				if humanoid.Parent then humanoid.PlatformStand = false end
			end)
		end
	end
end

local function performAttack(f, kind, aim, dir)
	local spec = Shared.Attacks[kind]
	if not spec then return end
	if aim ~= "up" and aim ~= "down" then aim = "side" end
	if dir ~= 1 and dir ~= -1 then dir = 1 end

	local now = os.clock()
	if f.koLock or now < f.nextAttack[kind] or now < f.stunUntil then return end   -- 連打の制限はサーバーで見る
	f.nextAttack[kind] = now + spec.Cooldown

	local root, _, character = rootOf(f)
	if not root then return end
	f.facing = dir
	task.spawn(pose, character, POSES[kind])
	fx("Swing", root.Position, kind, dir)

	task.wait(spec.Windup)   -- 振りかぶってから当たる。判定はこの時点の位置で行う
	if phase ~= "Fight" or not f.fighting or f.koLock then return end
	root = rootOf(f)
	if not root then return end
	now = os.clock()

	local def = Shared.Fighters[f.typeIndex]
	local power = if now < f.powerUntil then C.PowerMultiplier else 1
	for _, o in snapshot() do
		if o ~= f and o.fighting and not o.koLock then
			local targetRoot, _, targetCharacter = rootOf(o)
			if targetRoot and not targetCharacter:FindFirstChildOfClass("ForceField") then
				local p, t = root.Position, targetRoot.Position
				if Shared.inHitbox(spec, aim, dir, p.X, p.Y, t.X, t.Y, t.Z - p.Z) then
					local damage = spec.Damage * def.damage * power
					o.percent = math.min(o.percent + damage, 999)
					o.lastHitBy, o.lastHitAt = f.id, now
					syncFighter(o)

					local vx, vy = Shared.knockback(spec, aim, o.percent, Shared.Fighters[o.typeIndex].weight, dir)
					applyKnock(o, vx, vy)
					fx("Hit", t, math.floor(damage + 0.5), math.sqrt(vx * vx + vy * vy), o.slot)
					flash(targetCharacter)
					task.spawn(pose, targetCharacter, POSES.Hit)
				end
			end
		end
	end
end

attackRemote.OnServerEvent:Connect(function(player, kind, aim, dir)
	if type(kind) ~= "string" or type(aim) ~= "string" or type(dir) ~= "number" then return end
	local f = fighters["p_" .. player.UserId]
	if f then performAttack(f, kind, aim, if dir < 0 then -1 else 1) end
end)

selectRemote.OnServerEvent:Connect(function(player, id)
	if type(id) ~= "string" then return end
	local f = fighters["p_" .. player.UserId]
	if not f or f.fighting then return end   -- 試合中は変えられない
	local _, index = Shared.fighterById(id)
	f.typeIndex = index
	local _, humanoid = rootOf(f)
	if humanoid then applyStats(f, humanoid) end
	syncFighter(f)
end)

---------------------------------------------------------------- アイテム

local items = {}   -- { part, kind }

local function clearItems()
	for _, item in items do item.part:Destroy() end
	items = {}
end

local function spawnItem()
	if #items >= 2 then return end
	local spot = layout.items[math.random(#layout.items)]
	local kind = if math.random() < 0.55 then "heal" else "power"
	local part = Instance.new("Part")
	part.Name = "Item"
	part.Shape = Enum.PartType.Ball
	part.Size = Vector3.new(2.6, 2.6, 2.6)
	part.Anchored = true
	part.CanCollide = false
	part.Material = Enum.Material.Neon
	part.Color = if kind == "heal" then Color3.fromRGB(90, 230, 130) else Color3.fromRGB(255, 150, 40)
	part.Position = Vector3.new(spot[1], spot[2] + 2.5, 0)
	part:SetAttribute("Kind", kind)
	part.Parent = stageFolder
	CollectionService:AddTag(part, "Item")   -- 回ったり上下に動く演出は、プレイヤー側で行う
	table.insert(items, { part = part, kind = kind })
end

local function checkItemPickup()
	for i = #items, 1, -1 do
		local item = items[i]
		local pos = item.part.Position
		for _, f in snapshot() do
			if f.fighting and not f.koLock then
				local root = rootOf(f)
				if root and (root.Position - pos).Magnitude < 4.5 then
					if item.kind == "heal" then
						f.percent = math.max(0, f.percent - C.HealAmount)
					else
						f.powerUntil = os.clock() + C.PowerSeconds
					end
					syncFighter(f)
					fx("Item", pos, item.kind, f.name)
					item.part:Destroy()
					table.remove(items, i)
					break
				end
			end
		end
	end
end

---------------------------------------------------------------- 毎フレームの処理

local BOT_THINK = 0.1
local botTimer = 0

local function facingOf(f, root)
	local look = root.CFrame.LookVector.X
	if look > 0.3 then return 1 elseif look < -0.3 then return -1 end
	return f.facing
end

local function thinkBot(f, now)
	local root, humanoid = rootOf(f)
	if not root or not f.fighting or f.koLock then
		f.intent = nil
		return
	end
	local stunned = now < f.stunUntil
	local grounded = humanoid.FloorMaterial ~= Enum.Material.Air
	if grounded then f.canDouble = true end

	local me = {
		x = root.Position.X, y = root.Position.Y - FOOT, vy = root.AssemblyLinearVelocity.Y, grounded = grounded,
		facing = facingOf(f, root), percent = f.percent, canDouble = f.canDouble, canDash = now >= f.nextDash,
		lightReady = now >= f.nextAttack.Light, smashReady = now >= f.nextAttack.Smash, stunned = stunned,
	}
	local enemies = {}
	for _, o in fighters do
		if o ~= f and o.fighting and not o.koLock then
			local r = rootOf(o)
			if r then table.insert(enemies, { x = r.Position.X, y = r.Position.Y - FOOT, percent = o.percent }) end
		end
	end

	local intent = BotBrain.decide(f.mind, me, enemies, Shared.platformsOf(layout), Shared.Attacks, now)
	f.intent = intent
	f.facing = intent.dir
	if stunned then return end

	if intent.jump then
		if grounded then
			humanoid.Jump = true
		elseif f.canDouble then
			f.canDouble = false
			humanoid:ChangeState(Enum.HumanoidStateType.Jumping)
		end
	end
	if intent.dash and now >= f.nextDash then
		f.nextDash = now + Shared.Dash.Cooldown
		f.dashUntil = now + Shared.Dash.Time
		f.dashDir = if intent.move ~= 0 then intent.move else intent.dir
	end
	if intent.attack then
		if grounded then
			local lunge = if intent.attack == "Smash" then C.LungeSmash else C.LungeLight
			local v = root.AssemblyLinearVelocity
			root.AssemblyLinearVelocity = Vector3.new(v.X + intent.dir * lunge, v.Y, 0)
		end
		task.spawn(performAttack, f, intent.attack, intent.aim, intent.dir)
	end
end

RunService.Heartbeat:Connect(function(dt)
	local now = os.clock()
	for _, f in snapshot() do
		local root, humanoid = rootOf(f)
		if root then
			local p = root.Position
			if not f.koLock and Shared.outOfBounds(p.X, p.Y) then
				knockOut(f)
			elseif f.kind == "bot" then
				if math.abs(p.Z) > 0.05 and math.abs(p.Z) <= 8 then root.CFrame = root.CFrame - Vector3.new(0, 0, p.Z) end   -- 奥行きを固定
				if now < f.dashUntil then
					local v = root.AssemblyLinearVelocity
					root.AssemblyLinearVelocity = Vector3.new(f.dashDir * Shared.Dash.Speed, v.Y * 0.5, 0)
				end
				local move = if f.intent and now >= f.stunUntil then f.intent.move else 0
				humanoid:Move(Vector3.new(move, 0, 0), false)
			end
		end
	end
	checkItemPickup()

	botTimer += dt
	if botTimer >= BOT_THINK then
		botTimer = 0
		if phase == "Fight" then
			for _, f in snapshot() do
				if f.kind == "bot" then thinkBot(f, now) end
			end
		end
	end
end)

-- パワーアップ中の見た目と表示（ゆっくりでよい）
task.spawn(function()
	while true do
		local now = os.clock()
		for _, f in snapshot() do
			local powered = now < f.powerUntil
			if f.mark then
				f.mark.FillTransparency = if powered then 0.55 else 1
				f.mark.FillColor = Color3.fromRGB(255, 160, 40)
			end
			if f.folder:GetAttribute("Power") ~= powered then syncFighter(f) end
		end
		task.wait(0.3)
	end
end)

---------------------------------------------------------------- 記録（勝利数・KO数）

local store = nil
pcall(function() store = DataStoreService:GetDataStore("SkyRanto_v1") end)

local function loadStats(player, stats)
	if not store then return end
	local ok, data = pcall(function() return store:GetAsync("u_" .. player.UserId) end)
	if ok then
		if type(data) == "table" then
			stats.Wins.Value = data.Wins or 0
			stats.KOs.Value = data.KOs or 0
		end
		player:SetAttribute("StatsLoaded", true)   -- 読めなかったときは、保存しない（記録を消さないため）
	end
end

local function saveStats(player)
	local stats = player:FindFirstChild("leaderstats")
	if not store or not stats or not player:GetAttribute("StatsLoaded") then return end
	pcall(function()
		store:SetAsync("u_" .. player.UserId, { Wins = stats.Wins.Value, KOs = stats.KOs.Value })
	end)
end

---------------------------------------------------------------- 参加・退出

local function onPlayerAdded(player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	for _, name in { "Wins", "KOs" } do
		local v = Instance.new("IntValue")
		v.Name = name
		v.Parent = stats
	end
	stats.Parent = player
	task.spawn(loadStats, player, stats)

	local f = newFighter("p_" .. player.UserId, "player", player.DisplayName, player)
	player.CharacterAdded:Connect(function(character) onPlayerCharacter(f, character) end)
	loadPlayer(f)
end

local function onPlayerRemoving(player)
	saveStats(player)
	local f = fighters["p_" .. player.UserId]
	if f then removeFighter(f) end
end

Players.CharacterAutoLoads = false   -- 出現はすべてこのスクリプトで管理する
Players.PlayerAdded:Connect(onPlayerAdded)
Players.PlayerRemoving:Connect(onPlayerRemoving)
for _, player in Players:GetPlayers() do task.spawn(onPlayerAdded, player) end

game:BindToClose(function()
	for _, player in Players:GetPlayers() do saveStats(player) end
end)

---------------------------------------------------------------- 試合の進行

local function humanFighters()
	local list = {}
	for _, f in fighters do
		if f.kind == "player" then table.insert(list, f) end
	end
	table.sort(list, function(a, b) return a.id < b.id end)
	return list
end

local function credit(f)
	if f.player and f.player.Parent then
		local stats = f.player:FindFirstChild("leaderstats")
		if stats then stats.KOs.Value += f.kos end
	end
end

local lastLayout = nil

local function chooseLayout()
	local pick = Shared.Layouts[math.random(#Shared.Layouts)]
	while pick == lastLayout and #Shared.Layouts > 1 do
		pick = Shared.Layouts[math.random(#Shared.Layouts)]
	end
	lastLayout = pick
	return pick
end

local function startMatch()
	buildStage(chooseLayout())
	clearItems()

	-- 出る人を決める（人が多いときは先着。残りは観戦）
	local humans = humanFighters()
	local entrants = {}
	for i = 1, math.min(#humans, C.MaxFighters) do table.insert(entrants, humans[i]) end
	for _, f in humans do f.fighting = false end

	-- ボットで人数をそろえる
	local bots = math.max(0, math.min(C.MinFighters, C.MaxFighters) - #entrants)
	for _ = 1, bots do
		botCount += 1
		local name = Shared.BotNames[(botCount - 1) % #Shared.BotNames + 1]
		local f = newFighter("b_" .. botCount, "bot", "BOT " .. name, nil)
		f.typeIndex = math.random(#Shared.Fighters)
		f.mind = BotBrain.newMind(0.4 + math.random() * 0.3)
		table.insert(entrants, f)
	end

	for i, f in entrants do
		f.slot, f.fighting, f.stocks, f.percent, f.kos = i, true, C.Stocks, 0, 0
		f.powerUntil, f.stunUntil, f.koLock = 0, 0, false
		syncFighter(f)
	end
	for _, f in humans do
		if not f.fighting then syncFighter(f) end
		task.spawn(loadPlayer, f)
	end
	local entered = 0
	for _, f in entrants do
		if f.kind == "bot" and not makeBotModel(f) then
			removeFighter(f)   -- ボットを作れなかったときは、その人数は減らす
			f.fighting = false
		else
			entered += 1
		end
	end
	return entered
end

local function endMatch(winnerId, reason)
	setPhase("Result")
	timeValue.Value = 0
	local winner = winnerId and fighters[winnerId]
	if winner then
		statusValue.Value = winner.name .. " の勝ち！"
		fx("Win", winner.name, winner.kind == "player")
		if winner.player then
			local stats = winner.player:FindFirstChild("leaderstats")
			if stats then stats.Wins.Value += 1 end
		end
	else
		statusValue.Value = reason or "引き分け"
		fx("Win", "", false)
	end
	for _, f in snapshot() do
		if f.kind == "player" then credit(f); saveStats(f.player) end
		f.fighting = false
		f.kos = if f.kind == "player" then f.kos else 0
		syncFighter(f)
	end
	clearItems()
	task.wait(C.ResultSeconds)
end

local function cleanupBots()
	for _, f in snapshot() do
		if f.kind == "bot" then removeFighter(f) end
	end
end

local function fightLoop()
	local deadline = os.clock() + C.MatchSeconds
	local nextItem = os.clock() + C.ItemInterval[1]
	while true do
		task.wait(0.25)
		local alive, humansAlive = countFighting()
		if #humanFighters() == 0 then return nil, "引き分け" end
		if alive <= 1 then break end
		if humansAlive == 0 then
			-- 人がみんなやられたら、ボットの観戦はせずに終わる
			local list = {}
			for _, f in fighters do table.insert(list, { id = f.id, stocks = f.stocks, percent = f.percent, fighting = f.fighting }) end
			return Shared.pickWinner(list), "ゲームオーバー"
		end
		local left = deadline - os.clock()
		if left <= 0 then break end
		timeValue.Value = math.ceil(left)
		statusValue.Value = ""
		if os.clock() >= nextItem then
			spawnItem()
			nextItem = os.clock() + C.ItemInterval[1] + math.random() * (C.ItemInterval[2] - C.ItemInterval[1])
		end
	end
	local list = {}
	for _, f in fighters do table.insert(list, { id = f.id, stocks = f.stocks, percent = f.percent, fighting = f.fighting }) end
	return Shared.pickWinner(list), nil
end

task.spawn(function()
	buildStage(Shared.Layouts[1])
	while true do
		setPhase("Lobby")
		statusValue.Value = ""
		timeValue.Value = 0
		while #humanFighters() == 0 do task.wait(1) end

		local ok = true
		for t = C.Intermission, 1, -1 do
			if #humanFighters() == 0 then ok = false; break end
			statusValue.Value = "まもなく試合開始  " .. t
			timeValue.Value = t
			task.wait(1)
		end
		local entered = if ok then startMatch() else 0
		if ok and entered < 2 then
			-- 対戦相手がそろわなかったとき（ボットを作れなかったなど）は、試合を始めずに少し待つ
			for _, f in snapshot() do
				if f.kind == "bot" then removeFighter(f) else f.fighting = false; syncFighter(f) end
			end
			statusValue.Value = "対戦相手を集めています…"
			task.wait(5)
		elseif ok then
			setPhase("Ready")
			for t = C.ReadySeconds, 1, -1 do
				statusValue.Value = tostring(t)
				fx("Count", t)
				task.wait(1)
			end
			setPhase("Fight")
			statusValue.Value = "ファイト！"
			fx("Count", 0)
			task.delay(1.5, function()
				if phase == "Fight" then statusValue.Value = "" end
			end)
			local winnerId, reason = fightLoop()
			endMatch(winnerId, reason)
			cleanupBots()
			for _, f in humanFighters() do task.spawn(loadPlayer, f) end   -- 全員をステージに戻す
			task.wait(1)
		end
	end
end)
