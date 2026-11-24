--!nonstrict
--[[
	Roblox のAPIを真似た仮の環境（サーバーのスクリプトを、Studioなしで動かして確かめるためのもの）。
	使うAPIだけを真似ている。物理は簡易（重力・足場への着地・歩き・ジャンプ）。
	本物の Roblox とは違うので、ここで通っても Studio での確認は必要。
]]
local Mock = { now = 0, errors = {}, fx = {}, knocks = {}, humanoids = {}, players = {}, boundToClose = {} }

local realRequire = require
-- os は書き換えできないので、テスト用に作るスクリプトの os.clock() を __mockclock() に置き換えて使う（tools/run_tests.sh）
__mockclock = function() return Mock.now end

---------------------------------------------------------------- 値の型

local V3MT = {}
local function V3(x, y, z) return setmetatable({ X = x or 0, Y = y or 0, Z = z or 0 }, V3MT) end
V3MT.__index = function(t, k)
	if k == "Magnitude" then return math.sqrt(t.X * t.X + t.Y * t.Y + t.Z * t.Z) end
	if k == "Unit" then
		local m = math.sqrt(t.X * t.X + t.Y * t.Y + t.Z * t.Z)
		return V3(t.X / m, t.Y / m, t.Z / m)
	end
	if k == "Lerp" then
		return function(a, b, f) return V3(a.X + (b.X - a.X) * f, a.Y + (b.Y - a.Y) * f, a.Z + (b.Z - a.Z) * f) end
	end
	return nil
end
V3MT.__add = function(a, b) return V3(a.X + b.X, a.Y + b.Y, a.Z + b.Z) end
V3MT.__sub = function(a, b) return V3(a.X - b.X, a.Y - b.Y, a.Z - b.Z) end
V3MT.__mul = function(a, b)
	if type(a) == "number" then return V3(a * b.X, a * b.Y, a * b.Z) end
	if type(b) == "number" then return V3(a.X * b, a.Y * b, a.Z * b) end
	return V3(a.X * b.X, a.Y * b.Y, a.Z * b.Z)
end
V3MT.__unm = function(a) return V3(-a.X, -a.Y, -a.Z) end
V3MT.__tostring = function(a) return ("(%.1f, %.1f, %.1f)"):format(a.X, a.Y, a.Z) end
Vector3 = { new = V3, zero = V3(0, 0, 0), one = V3(1, 1, 1) }
local realTypeof = typeof
typeof = function(v)
	if getmetatable(v) == V3MT then return "Vector3" end
	return realTypeof(v)
end

local CFMT = {}
local function CF(p, look) return setmetatable({ Position = p or V3(0, 0, 0), LookVector = look or V3(0, 0, -1) }, CFMT) end
CFMT.__mul = function(a, b) return CF(a.Position + b.Position, a.LookVector) end
CFMT.__sub = function(a, v) return CF(a.Position - v, a.LookVector) end
CFMT.__add = function(a, v) return CF(a.Position + v, a.LookVector) end
CFrame = {
	new = function(x, y, z)
		if type(x) == "table" then return CF(x) end
		return CF(V3(x or 0, y or 0, z or 0))
	end,
	Angles = function() return CF(V3(0, 0, 0)) end,
	lookAt = function(from, to)
		local d = to - from
		local m = d.Magnitude
		return CF(from, if m > 0 then V3(d.X / m, d.Y / m, d.Z / m) else V3(0, 0, -1))
	end,
}

local C3MT = { __index = { Lerp = function(a, b, f) return setmetatable({ R = a.R + (b.R - a.R) * f, G = a.G + (b.G - a.G) * f, B = a.B + (b.B - a.B) * f }, getmetatable(a)) end } }
Color3 = {
	fromRGB = function(r, g, b) return setmetatable({ R = r / 255, G = g / 255, B = b / 255 }, C3MT) end,
	new = function(r, g, b) return setmetatable({ R = r, G = g, B = b }, C3MT) end,
}
UDim2 = { new = function(...) return { ... } end, fromOffset = function(x, y) return { 0, x, 0, y } end, fromScale = function(x, y) return { x, 0, y, 0 } end }
UDim = { new = function(a, b) return { a, b } end }
Vector2 = { new = function(x, y) return { X = x, Y = y } end }
TweenInfo = { new = function(...) return { ... } end }

-- Enum.Material.Slate のように、どんな名前でも文字列を返す
local function enumTable(path)
	return setmetatable({}, { __index = function(_, k) return path .. "." .. k end })
end
Enum = setmetatable({ RenderPriority = { Camera = { Value = 200 } } }, { __index = function(_, k) return enumTable("Enum." .. k) end })

---------------------------------------------------------------- 時間とスレッド

local waiting = {}
local function resume(co, ...)
	local ok, err = coroutine.resume(co, ...)
	if not ok then table.insert(Mock.errors, tostring(err) .. "\n" .. debug.traceback(co)) end
end
task = {}
function task.spawn(fn, ...)
	local co = coroutine.create(fn)
	resume(co, ...)
	return co
end
function task.wait(t)
	table.insert(waiting, { wake = Mock.now + (t or 0.03), co = coroutine.running() })
	coroutine.yield()
	return t
end
function task.delay(t, fn, ...)
	local args = { ... }
	task.spawn(function()
		task.wait(t)
		fn(table.unpack(args))
	end)
end

---------------------------------------------------------------- 合図（イベント）

local function newSignal()
	local s = { handlers = {}, waiters = {} }
	function s:Connect(fn)
		table.insert(self.handlers, fn)
		return { Disconnect = function() end }
	end
	function s:Wait()
		table.insert(self.waiters, coroutine.running())
		return coroutine.yield()
	end
	function s:Fire(...)
		for _, fn in self.handlers do task.spawn(fn, ...) end
		local w = self.waiters
		self.waiters = {}
		for _, co in w do resume(co, ...) end
	end
	return s
end

---------------------------------------------------------------- Instance

local EVENTS = { ChildAdded = true, DescendantAdded = true, Died = true, OnServerEvent = true, OnClientEvent = true, CharacterAdded = true, PlayerAdded = true, PlayerRemoving = true, Heartbeat = true, Changed = true, StateChanged = true, JumpRequest = true, InputBegan = true, RenderStepped = true, Activated = true }
local BASEPART = { Part = true, MeshPart = true }
local methods = {}
local InstMT = {}

local function newInstance(class)
	local self = setmetatable({ _class = class, _name = class, _parent = nil, _children = {}, _attrs = {}, _props = {}, _signals = {} }, InstMT)
	if BASEPART[class] then
		self._props.CFrame = CF(V3(0, 0, 0))
		self._props.Size = V3(1, 1, 1)
		self._props.AssemblyLinearVelocity = V3(0, 0, 0)
		self._props.Anchored = false
		self._props.CanCollide = true
		self._props.Transparency = 0
	elseif class == "IntValue" or class == "NumberValue" then self._props.Value = 0
	elseif class == "StringValue" then self._props.Value = ""
	elseif class == "Humanoid" then
		self._props.Health, self._props.MaxHealth, self._props.WalkSpeed, self._props.JumpPower = 100, 100, 16, 50
		self._props.PlatformStand, self._props.Jump, self._props.FloorMaterial = false, false, Enum.Material.Air
		self._props.MoveDirection = V3(0, 0, 0)
		self._moveX = 0
		table.insert(Mock.humanoids, self)
	end
	return self
end

local function isDescendantAdded(inst, child)
	local p = inst
	while p do
		if p._signals.DescendantAdded then p._signals.DescendantAdded:Fire(child) end
		p = p._parent
	end
end

local function setParent(self, parent)
	if self._parent then
		for i, c in self._parent._children do
			if c == self then table.remove(self._parent._children, i) break end
		end
	end
	self._parent = parent
	if parent then
		table.insert(parent._children, self)
		if parent._signals.ChildAdded then parent._signals.ChildAdded:Fire(self) end
		isDescendantAdded(parent, self)
	end
end

InstMT.__index = function(self, k)
	if methods[k] then return methods[k] end
	if k == "Name" then return self._name end
	if k == "Parent" then return self._parent end
	if k == "ClassName" then return self._class end
	if BASEPART[self._class] and k == "Position" then return self._props.CFrame.Position end
	if EVENTS[k] then
		self._signals[k] = self._signals[k] or newSignal()
		return self._signals[k]
	end
	local v = self._props[k]
	if v ~= nil then return v end
	for _, c in self._children do
		if c._name == k then return c end
	end
	return nil
end
InstMT.__newindex = function(self, k, v)
	if k == "Name" then self._name = v
	elseif k == "Parent" then setParent(self, v)
	elseif k == "Value" then
		self._props.Value = v
		if self._signals.Changed then self._signals.Changed:Fire(v) end
	elseif BASEPART[self._class] and k == "Position" then self._props.CFrame = CF(v, self._props.CFrame.LookVector)
	else self._props[k] = v end
end

function methods.Destroy(self)
	for _, c in table.clone(self._children) do c:Destroy() end
	setParent(self, nil)
	self._destroyed = true
end
function methods.FindFirstChild(self, name, recursive)
	for _, c in self._children do
		if c._name == name then return c end
	end
	if recursive then
		for _, c in self._children do
			local r = c:FindFirstChild(name, true)
			if r then return r end
		end
	end
	return nil
end
function methods.FindFirstChildOfClass(self, class)
	for _, c in self._children do
		if c._class == class then return c end
	end
	return nil
end
function methods.WaitForChild(self, name) return self:FindFirstChild(name) end
function methods.GetChildren(self) return table.clone(self._children) end
function methods.GetDescendants(self)
	local list = {}
	local function walk(n) for _, c in n._children do table.insert(list, c); walk(c) end end
	walk(self)
	return list
end
function methods.IsA(self, class)
	if self._class == class then return true end
	if class == "BasePart" then return BASEPART[self._class] == true end
	return class == "Instance"
end
function methods.SetAttribute(self, k, v) self._attrs[k] = v end
function methods.GetAttribute(self, k) return self._attrs[k] end
function methods.PivotTo(self, cf)
	local root = self:FindFirstChild("HumanoidRootPart")
	if root then root._props.CFrame = CF(cf.Position, root._props.CFrame.LookVector) end
end
function methods.SetNetworkOwner() end
function methods.Move(self, v) self._moveX = v.X; self._props.MoveDirection = V3(v.X, 0, v.Z) end
function methods.GetPropertyChangedSignal(self, name)
	self._signals["prop:" .. name] = self._signals["prop:" .. name] or newSignal()
	return self._signals["prop:" .. name]
end
function methods.GetState(self)
	return if self._props.FloorMaterial == Enum.Material.Air then Enum.HumanoidStateType.Freefall else Enum.HumanoidStateType.Running
end
function methods.Play() end
function methods.SetTitle() end
function methods.SetPosition() end
function methods.WorldToViewportPoint(self, v)
	local c = self._props.CFrame.Position
	return V3(640 + (v.X - c.X) * 8, 360 - (v.Y - c.Y) * 8, 10), true
end
function methods.FireServer(self, ...)
	self.OnServerEvent:Fire(Mock.Players._props.LocalPlayer, ...)
end
function methods.ChangeState(self, state)
	if state == Enum.HumanoidStateType.Jumping then self._props.AssemblyJump = true end
end
function methods.FireClient(self, player, ...)
	table.insert(Mock.knocks, { player = player, args = { ... } })
	if Mock.onKnock then Mock.onKnock(player, ...) end
	if self._signals.OnClientEvent and player == Mock.Players._props.LocalPlayer then self._signals.OnClientEvent:Fire(...) end
end
function methods.FireAllClients(self, ...)
	table.insert(Mock.fx, { ... })
	if self._signals.OnClientEvent then self._signals.OnClientEvent:Fire(...) end
end
function methods.LoadCharacter(self)
	if self.Character then self.Character:Destroy() end
	local c = Mock.buildCharacter(self.DisplayName)
	c.Parent = workspace
	self._props.Character = c
	if self._signals.CharacterAdded then self._signals.CharacterAdded:Fire(c) end
end

Instance = { new = function(class) return newInstance(class) end }

function Mock.buildCharacter(name)
	local model = newInstance("Model")
	model._name = name
	local root = newInstance("Part"); root._name = "HumanoidRootPart"; root.Parent = model
	root._props.CFrame = CF(V3(0, 5, 0))
	local hum = newInstance("Humanoid"); hum.Parent = model
	local torso = newInstance("Part"); torso._name = "UpperTorso"; torso.Parent = model
	local shoulder = newInstance("Motor6D"); shoulder._name = "RightShoulder"; shoulder.Parent = torso
	shoulder._props.C0 = CF(V3(1, 0.5, 0))
	local waist = newInstance("Motor6D"); waist._name = "Waist"; waist.Parent = torso
	waist._props.C0 = CF(V3(0, 0.2, 0))
	return model
end

---------------------------------------------------------------- サービス

local services = {}
local function service(name)
	local s = newInstance(name)
	services[name] = s
	return s
end

local Players = service("Players")
function Players.GetPlayers() return table.clone(Mock.players) end
function Players.CreateHumanoidModelFromDescription(_, desc, rig)
	if Mock.botFail then error("ボットを作れない（テスト）") end
	return Mock.buildCharacter("Rig")
end
local ReplicatedStorage = service("ReplicatedStorage")
local ServerScriptService = service("ServerScriptService")
local RunService = service("RunService")
Mock.renderSteps = {}
function RunService.BindToRenderStep(_, name, _, fn) Mock.renderSteps[name] = fn end
local heartbeat = newSignal()
RunService._signals.Heartbeat = heartbeat

local Debris = service("Debris")
function Debris.AddItem(_, inst, t) task.delay(t, function() inst:Destroy() end) end
local CollectionService = service("CollectionService")
CollectionService._tags = {}
function CollectionService.AddTag(_, inst, tag)
	CollectionService._tags[tag] = CollectionService._tags[tag] or {}
	table.insert(CollectionService._tags[tag], inst)
end
function CollectionService.GetTagged(_, tag) return CollectionService._tags[tag] or {} end
local TweenService = service("TweenService")
function TweenService.Create(_, inst, info, props)
	return { Play = function() for k, v in props do inst._props[k] = v end end }
end
local UserInputService = service("UserInputService")
UserInputService._props.TouchEnabled = false
local ContextActionService = service("ContextActionService")
function ContextActionService.BindAction(_, name, fn) Mock.actions = Mock.actions or {}; Mock.actions[name] = fn end
local SoundService = service("SoundService")
local StarterPlayer = service("StarterPlayer")
local PhysicsService = service("PhysicsService")
function PhysicsService.RegisterCollisionGroup() end
function PhysicsService.CollisionGroupSetCollidable() end
local DataStoreService = service("DataStoreService")
Mock.storeData = {}
function DataStoreService.GetDataStore()
	return {
		GetAsync = function(_, k) return Mock.storeData[k] end,
		SetAsync = function(_, k, v) Mock.storeData[k] = v end,
	}
end

workspace = newInstance("Workspace")
local camera = newInstance("Camera")
camera._props.ViewportSize = { X = 1280, Y = 720 }
camera._props.CFrame = CF(V3(0, 10, 70))
workspace._props.CurrentCamera = camera
Mock.camera = camera
game = newInstance("DataModel")
function game.GetService(_, name) return services[name] or error("未対応のサービス: " .. name) end
function game.BindToClose(_, fn) table.insert(Mock.boundToClose, fn) end

-- モジュールを require できるように
function Mock.registerModule(parent, name, path)
	local inst = newInstance("ModuleScript")
	inst._name = name
	inst._module = realRequire(path)
	inst.Parent = parent
end
require = function(x)
	if type(x) == "table" and x._module ~= nil then return x._module end
	return realRequire(x)
end
Mock.ReplicatedStorage, Mock.ServerScriptService, Mock.workspace, Mock.Players = ReplicatedStorage, ServerScriptService, workspace, Players

---------------------------------------------------------------- プレイヤーの追加・削除

function Mock.addPlayer(name, userId)
	local p = newInstance("Player")
	p._name = name
	p._props.DisplayName, p._props.UserId = name, userId
	table.insert(Mock.players, p)
	local gui = newInstance("PlayerGui"); gui._name = "PlayerGui"; gui.Parent = p
	p.Parent = Players
	Players.PlayerAdded:Fire(p)
	return p
end
function Mock.removePlayer(p)
	for i, q in Mock.players do if q == p then table.remove(Mock.players, i) break end end
	Players.PlayerRemoving:Fire(p)
	if p.Character then p.Character:Destroy() end
	p:Destroy()
end

---------------------------------------------------------------- 簡易な物理と時間の進行

local G = 196.2
local function stageParts()
	local stage = workspace:FindFirstChild("SmashStage")
	local list = {}
	if stage then
		for _, p in stage._children do
			if p._class == "Part" and p._props.Anchored and p._name ~= "WallFront" and p._name ~= "WallBack" and p._props.CanCollide ~= false and p._props.Transparency ~= 1 then
				table.insert(list, p)
			end
		end
	end
	return list
end

local function physics(dt)
	local parts = stageParts()
	for _, h in Mock.humanoids do
		local character = h.Parent
		local root = character and character:FindFirstChild("HumanoidRootPart")
		if root and not h._destroyed and h.Health > 0 then
			local cf = root._props.CFrame
			local pos, vel = cf.Position, root._props.AssemblyLinearVelocity
			local vx, vy = vel.X, vel.Y
			local grounded = h._props.FloorMaterial ~= Enum.Material.Air
			if h._props.Jump then vy, h._props.Jump = h._props.JumpPower, false end
			if h._props.AssemblyJump then vy, h._props.AssemblyJump = h._props.JumpPower, false end
			local ground = h._props.FloorMaterial ~= Enum.Material.Air
			if h._props.PlatformStand then
				if ground then vx *= math.exp(-8 * dt) end
			elseif ground then
				vx = h._moveX * h._props.WalkSpeed
			else
				vx += (h._moveX * h._props.WalkSpeed - vx) * math.min(1, 3 * dt)
			end
			vy -= G * dt
			local oldBottom = pos.Y - 3
			local nx, ny = pos.X + vx * dt, pos.Y + vy * dt
			local landed = false
			if vy <= 0 then
				for _, p in parts do
					local pp, size = p._props.CFrame.Position, p._props.Size
					local top = pp.Y + size.Y / 2
					if nx >= pp.X - size.X / 2 - 0.5 and nx <= pp.X + size.X / 2 + 0.5 and oldBottom >= top - 0.01 and ny - 3 <= top then
						ny, vy, landed = top + 3, 0, true
					end
				end
			end
			h._props.FloorMaterial = if landed then Enum.Material.Slate else Enum.Material.Air
			if h._lastGrounded ~= landed then
				h._lastGrounded = landed
				if h._signals.StateChanged then
					h._signals.StateChanged:Fire(nil, if landed then Enum.HumanoidStateType.Landed else Enum.HumanoidStateType.Freefall)
				end
			end
			local look = cf.LookVector
			if h._moveX ~= 0 and not h._props.PlatformStand then look = V3(h._moveX > 0 and 1 or -1, 0, 0) end
			root._props.CFrame = CF(V3(nx, ny, pos.Z), look)
			root._props.AssemblyLinearVelocity = V3(vx, vy, 0)
		end
	end
end

function Mock.step(dt)
	Mock.now += dt
	physics(dt)
	local due, rest = {}, {}
	for _, w in waiting do
		if w.wake <= Mock.now then table.insert(due, w) else table.insert(rest, w) end
	end
	waiting = rest
	for _, w in due do resume(w.co) end
	heartbeat:Fire(dt)
	for _, fn in Mock.renderSteps do task.spawn(fn, dt) end
	if camera._signals.RenderStepped then camera._signals.RenderStepped:Fire(dt) end
	if RunService._signals.RenderStepped then RunService._signals.RenderStepped:Fire(dt) end
end

function Mock.run(seconds, dt, until_)
	dt = dt or 1 / 30
	local steps = math.floor(seconds / dt)
	for _ = 1, steps do
		Mock.step(dt)
		if until_ and until_() then return true end
	end
	return false
end

Mock.V3, Mock.CF, Mock.newInstance = V3, CF, newInstance
return Mock
