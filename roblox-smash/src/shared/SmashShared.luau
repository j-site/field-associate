--!nonstrict
--[[
	スカイ乱闘：共有の設定と計算
	置き場所: ReplicatedStorage の中に ModuleScript として入れ、名前を SmashShared にする

	サーバーとプレイヤー側の両方から使う。Roblox のAPIには依存しない（テストで動かせるようにするため）。
	ゲームの手ごたえは、ほとんどこのファイルの数字で決まる。
]]

local Shared = {}

---------------------------------------------------------------- 設定

Shared.Config = {
	Stocks = 3,              -- 残機
	MatchSeconds = 150,      -- 1試合の長さ
	Intermission = 12,       -- 試合前の待ち時間（ファイターを選べる）
	ReadySeconds = 3,        -- 「3・2・1」
	ResultSeconds = 8,       -- 結果を表示する時間
	MinFighters = 4,         -- 人が少ないときは、ボットで合計この人数にする
	MaxFighters = 8,
	RespawnDelay = 1.5,      -- やられてから復活するまで
	ShieldSeconds = 2.5,     -- 復活直後の無敵時間
	Blast = { Side = 115, Top = 120, Bottom = -50 },   -- ここを越えるとやられる
	ItemInterval = { 12, 18 },   -- アイテムが出る間隔（秒）
	HealAmount = 25,         -- 回復アイテムで減る％
	PowerSeconds = 10,
	PowerMultiplier = 1.6,
	LungeLight = 8,          -- 攻撃で少し前に出る速さ
	LungeSmash = 20,
}

Shared.Dash = { Speed = 62, Time = 0.16, Cooldown = 1.1 }

-- Damage: たまる％ / Base・Scale: 吹っ飛ぶ強さ = (Base + ％×Scale) ÷ 重さ / Angles: 飛ぶ角度（度）
-- Windup: ボタンを押してから当たるまで（秒）
Shared.Attacks = {
	Light = {
		Damage = 5, Range = 7.5, Base = 24, Scale = 0.38, Cooldown = 0.32, Windup = 0.04,
		Angles = { side = 32, up = 82, down = -40 },
	},
	Smash = {
		Damage = 14, Range = 8.5, Base = 46, Scale = 0.8, Cooldown = 1.0, Windup = 0.16,
		Angles = { side = 40, up = 80, down = -50 },
	},
}

-- walk: 走る速さ / jump: ジャンプ力 / damage: 与えるダメージの倍率 / weight: 重いほど飛ばされにくい
Shared.Fighters = {
	{ id = "hayate", name = "ハヤテ", info = "速い・軽い", walk = 26, jump = 62, damage = 0.85, weight = 0.85 },
	{ id = "normal", name = "スタンダード", info = "バランス型", walk = 22, jump = 60, damage = 1.0, weight = 1.0 },
	{ id = "dossiri", name = "ドッシリ", info = "強い・重い", walk = 18, jump = 56, damage = 1.3, weight = 1.35 },
}

-- ファイターの目印の色（RGB）
Shared.SlotColors = {
	{ 255, 90, 90 }, { 80, 160, 255 }, { 255, 210, 70 }, { 90, 220, 120 },
	{ 200, 110, 255 }, { 255, 150, 60 }, { 70, 220, 220 }, { 255, 130, 200 },
}

-- ボットの腕前の範囲（0〜1。大きいほど強い）と、状況を見て動きを決める間隔（秒。長いほど反応が遅い）
Shared.BotSkill = { 0.15, 0.4 }
Shared.BotThink = 0.22

Shared.BotNames = { "ゴロー", "ミケ", "タロウ", "ハナ", "ソラ", "ダイ", "リン", "ケン" }

---------------------------------------------------------------- ステージ

-- parts: 床や足場 / spawns: 出現位置 / items: アイテムが出る場所 / 値はすべて stud
Shared.Layouts = {
	{
		id = "sky", name = "スカイアイランド",
		parts = {
			{ "Main", { 70, 4, 8 }, { 0, 0, 0 }, { 70, 80, 110 }, "Slate" },
			{ "PlatformLeft", { 16, 1, 8 }, { -20, 9.5, 0 }, { 240, 190, 70 }, "SmoothPlastic" },
			{ "PlatformRight", { 16, 1, 8 }, { 20, 9.5, 0 }, { 240, 190, 70 }, "SmoothPlastic" },
			{ "PlatformTop", { 16, 1, 8 }, { 0, 17.5, 0 }, { 240, 190, 70 }, "SmoothPlastic" },
		},
		spawns = { { -30, 5 }, { 30, 5 }, { -12, 5 }, { 12, 5 }, { -24, 5 }, { 24, 5 }, { -4, 5 }, { 4, 5 } },
		items = { { 0, 2 }, { -20, 10 }, { 20, 10 }, { 0, 18 } },
	},
	{
		id = "islands", name = "ふたつの島",
		parts = {
			{ "IslandLeft", { 30, 4, 8 }, { -26, 0, 0 }, { 70, 110, 90 }, "Slate" },
			{ "IslandRight", { 30, 4, 8 }, { 26, 0, 0 }, { 70, 110, 90 }, "Slate" },
			{ "Middle", { 14, 1, 8 }, { 0, 9, 0 }, { 240, 190, 70 }, "SmoothPlastic" },
			{ "HighLeft", { 12, 1, 8 }, { -34, 16, 0 }, { 240, 120, 90 }, "SmoothPlastic" },
			{ "HighRight", { 12, 1, 8 }, { 34, 16, 0 }, { 240, 120, 90 }, "SmoothPlastic" },
		},
		spawns = { { -36, 5 }, { 36, 5 }, { -22, 5 }, { 22, 5 }, { -30, 5 }, { 30, 5 }, { -16, 5 }, { 16, 5 } },
		items = { { 0, 10 }, { -26, 2 }, { 26, 2 }, { -34, 17 }, { 34, 17 } },
	},
	{
		id = "tower", name = "三段タワー",
		parts = {
			{ "Low", { 60, 4, 8 }, { 0, 0, 0 }, { 90, 80, 120 }, "Slate" },
			{ "Mid", { 40, 1.5, 8 }, { 0, 11, 0 }, { 240, 190, 70 }, "SmoothPlastic" },
			{ "Top", { 22, 1.5, 8 }, { 0, 21, 0 }, { 240, 120, 90 }, "SmoothPlastic" },
		},
		spawns = { { -26, 5 }, { 26, 5 }, { -14, 5 }, { 14, 5 }, { -22, 5 }, { 22, 5 }, { -6, 5 }, { 6, 5 } },
		items = { { 0, 2 }, { 0, 11.75 }, { 0, 21.75 }, { -24, 2 }, { 24, 2 } },
	},
}

-- 足場の一覧（上面の高さと、左右の端）。ボットが足場を探すのに使う
function Shared.platformsOf(layout)
	local list = {}
	for _, part in layout.parts do
		local size, pos = part[2], part[3]
		table.insert(list, { xmin = pos[1] - size[1] / 2, xmax = pos[1] + size[1] / 2, top = pos[2] + size[2] / 2 })
	end
	return list
end

---------------------------------------------------------------- 戦闘の計算

-- 吹っ飛ぶ速さ（vx, vy）。％が高いほど、重さが軽いほど、遠くへ飛ぶ
function Shared.knockback(spec, aim, percent, weight, facing)
	local angle = math.rad(spec.Angles[aim] or spec.Angles.side)
	local power = (spec.Base + percent * spec.Scale) / (weight or 1)
	local vx = math.cos(angle) * power
	if aim == "side" then vx *= facing else vx *= 0.25 * facing end   -- 上・下向きは、ほぼ真上・真下に飛ぶ
	return vx, math.sin(angle) * power
end

-- 吹っ飛んでいる間、操作できない時間（秒）
function Shared.stunSeconds(vx, vy)
	local speed = math.sqrt(vx * vx + vy * vy)
	return math.clamp(speed / 400, 0.12, 0.55)
end

-- 攻撃が当たる範囲か。(ax, ay) は攻撃した人、(tx, ty, tz) は相手の位置
function Shared.inHitbox(spec, aim, facing, ax, ay, tx, ty, tz)
	local dx, dy = tx - ax, ty - ay
	if math.abs(tz) > 6 then return false end
	if aim == "up" then
		return math.abs(dx) <= spec.Range * 0.7 and dy >= -1 and dy <= 9
	elseif aim == "down" then
		return math.abs(dx) <= spec.Range * 0.7 and dy <= 1 and dy >= -9
	end
	return dx * facing > -1.5 and math.abs(dx) <= spec.Range and math.abs(dy) <= 5
end

function Shared.outOfBounds(x, y)
	local b = Shared.Config.Blast
	return math.abs(x) > b.Side or y > b.Top or y < b.Bottom
end

-- 勝者を決める。list: { { id, stocks, percent, fighting } }。決まらなければ nil（引き分け）
function Shared.pickWinner(list)
	local alive = {}
	for _, f in list do
		if f.fighting then table.insert(alive, f) end
	end
	if #alive == 0 then return nil end
	if #alive == 1 then return alive[1].id end
	table.sort(alive, function(a, b)
		if a.stocks ~= b.stocks then return a.stocks > b.stocks end
		return a.percent < b.percent
	end)
	if alive[1].stocks == alive[2].stocks and alive[1].percent == alive[2].percent then return nil end
	return alive[1].id
end

function Shared.fighterById(id)
	for i, f in Shared.Fighters do
		if f.id == id then return f, i end
	end
	return Shared.Fighters[2], 2
end

return Shared
