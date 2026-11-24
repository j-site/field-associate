--!nonstrict
-- 共有の計算とボットの頭脳のテスト。 実行: luau test/pure.test.luau （roblox-smash フォルダで）
local Shared = require("../src/shared/SmashShared")
local BotBrain = require("../src/server/BotBrain")

local passed, failed = 0, 0
local function test(name, fn)
	local ok, err = pcall(fn)
	if ok then passed += 1; print("ok   " .. name)
	else failed += 1; print("FAIL " .. name .. " : " .. tostring(err)) end
end
local function eq(a, b, msg) if a ~= b then error((msg or "") .. " 期待 " .. tostring(b) .. " 実際 " .. tostring(a), 2) end end
local function truthy(v, msg) if not v then error(msg or "偽", 2) end end

test("％が高いほど遠くへ飛ぶ", function()
	local L = Shared.Attacks.Light
	local vx0 = Shared.knockback(L, "side", 0, 1, 1)
	local vx100 = Shared.knockback(L, "side", 100, 1, 1)
	truthy(vx100 > vx0 * 2, "100%は0%の2倍以上")
end)

test("向きの符号と、重さの効果", function()
	local S = Shared.Attacks.Smash
	local rx, ry = Shared.knockback(S, "side", 50, 1, 1)
	local lx, ly = Shared.knockback(S, "side", 50, -1 == -1 and 1 or 1, -1)
	truthy(rx > 0 and lx < 0 and ry > 0, "右向きは+x、左向きは-x、上にも飛ぶ")
	local hx = Shared.knockback(S, "side", 50, 1.35, 1)
	local fx = Shared.knockback(S, "side", 50, 0.85, 1)
	truthy(hx < rx and rx < fx, "重いほど飛ばない")
end)

test("上向きの攻撃は、ほぼ真上に飛ぶ", function()
	local vx, vy = Shared.knockback(Shared.Attacks.Smash, "up", 80, 1, 1)
	truthy(vy > math.abs(vx) * 4, "上向き")
	local dx, dy = Shared.knockback(Shared.Attacks.Smash, "down", 80, 1, 1)
	truthy(dy < 0, "下向きは下に飛ぶ")
end)

test("操作できない時間は 0.12〜0.55 秒", function()
	eq(Shared.stunSeconds(0, 0), 0.12)
	eq(Shared.stunSeconds(1000, 1000), 0.55)
end)

test("当たり判定：前は当たり、後ろと遠くは外れる", function()
	local L = Shared.Attacks.Light
	truthy(Shared.inHitbox(L, "side", 1, 0, 0, 5, 0, 0), "前")
	truthy(not Shared.inHitbox(L, "side", 1, 0, 0, -5, 0, 0), "後ろ")
	truthy(not Shared.inHitbox(L, "side", 1, 0, 0, 12, 0, 0), "遠い")
	truthy(not Shared.inHitbox(L, "side", 1, 0, 0, 5, 9, 0), "高すぎる")
	truthy(not Shared.inHitbox(L, "side", 1, 0, 0, 5, 0, 8), "奥行きが違う")
	truthy(Shared.inHitbox(L, "side", -1, 0, 0, -5, 0, 0), "左向き")
end)

test("当たり判定：上と下", function()
	local L = Shared.Attacks.Light
	truthy(Shared.inHitbox(L, "up", 1, 0, 0, 1, 6, 0), "真上")
	truthy(not Shared.inHitbox(L, "up", 1, 0, 0, 1, -4, 0), "上向きで下の相手")
	truthy(Shared.inHitbox(L, "down", 1, 0, 0, 1, -6, 0), "真下")
end)

test("場外の判定", function()
	truthy(not Shared.outOfBounds(0, 0))
	truthy(Shared.outOfBounds(116, 0))
	truthy(Shared.outOfBounds(0, -51))
	truthy(Shared.outOfBounds(0, 121))
end)

test("勝者の決め方", function()
	eq(Shared.pickWinner({ { id = "a", stocks = 1, percent = 10, fighting = true }, { id = "b", stocks = 0, percent = 0, fighting = false } }), "a")
	eq(Shared.pickWinner({ { id = "a", stocks = 0, percent = 0, fighting = false } }), nil, "全員脱落は引き分け")
	eq(Shared.pickWinner({ { id = "a", stocks = 2, percent = 90, fighting = true }, { id = "b", stocks = 3, percent = 200, fighting = true } }), "b", "残機が多い方")
	eq(Shared.pickWinner({ { id = "a", stocks = 2, percent = 30, fighting = true }, { id = "b", stocks = 2, percent = 60, fighting = true } }), "a", "％が低い方")
	eq(Shared.pickWinner({ { id = "a", stocks = 2, percent = 30, fighting = true }, { id = "b", stocks = 2, percent = 30, fighting = true } }), nil, "同点は引き分け")
end)

test("ステージ：出現位置とアイテムの場所が、足場の上にある", function()
	for _, layout in Shared.Layouts do
		local plats = Shared.platformsOf(layout)
		eq(#layout.spawns >= Shared.Config.MaxFighters, true, layout.id .. " の出現位置が足りない")
		for i, s in layout.spawns do
			local sup = BotBrain.supportBelow(plats, s[1], s[2])
			truthy(sup ~= nil, layout.id .. " 出現位置" .. i .. "の下に足場がない")
			truthy(s[2] - sup.top >= 2 and s[2] - sup.top <= 8, layout.id .. " 出現位置" .. i .. "が足場から離れすぎ")
		end
		for i, it in layout.items do
			local sup = BotBrain.supportBelow(plats, it[1], it[2] + 0.5)
			truthy(sup ~= nil and math.abs(sup.top - it[2]) < 0.6, layout.id .. " アイテム" .. i .. "が足場の上面にない")
		end
	end
end)

test("ステージ：すべての足場に、ジャンプ（2段）で届く", function()
	-- ジャンプ力から計算した、1回・2回で上がれる高さ
	local g = 196.2
	for _, f in Shared.Fighters do
		local one = f.jump * f.jump / (2 * g)
		local two = one * 2.3
		for _, layout in Shared.Layouts do
			local plats = Shared.platformsOf(layout)
			table.sort(plats, function(a, b) return a.top < b.top end)
			-- 隣り合う高さの足場の差が、2段ジャンプで上がれる範囲か
			for i = 2, #plats do
				if plats[i].top > plats[i - 1].top + 0.01 and plats[i].xmin < plats[i - 1].xmax + 12 then
					truthy(plats[i].top - plats[i - 1].top <= two, layout.id .. " " .. f.id .. " 届かない足場")
				end
			end
		end
	end
end)

---------------------------------------------------------------- ボット

local plats = Shared.platformsOf(Shared.Layouts[1])
local function me(t)
	local m = { x = 0, y = 4, vy = 0, grounded = true, facing = 1, percent = 0, canDouble = true, canDash = true,
		lightReady = true, smashReady = true, stunned = false }
	for k, v in t do m[k] = v end
	return m
end
local noMistakes = function() return 0.99 end

test("ボット：相手に向かって歩く", function()
	local mind = BotBrain.newMind(1)
	local i = BotBrain.decide(mind, me({ x = -20 }), { { x = 10, y = 4, percent = 0 } }, plats, Shared.Attacks, 0, noMistakes)
	eq(i.move, 1)
	i = BotBrain.decide(mind, me({ x = 25 }), { { x = 5, y = 4, percent = 0 } }, plats, Shared.Attacks, 0, noMistakes)
	eq(i.move, -1)
end)

test("ボット：射程に入ったら攻撃する", function()
	local mind = BotBrain.newMind(1)
	local i = BotBrain.decide(mind, me({ x = 0 }), { { x = 5, y = 4, percent = 0 } }, plats, Shared.Attacks, 0, noMistakes)
	eq(i.attack, "Light")
	eq(i.aim, "side")
	-- 攻撃した直後は、少し間をあける
	i = BotBrain.decide(mind, me({ x = 0 }), { { x = 5, y = 4, percent = 0 } }, plats, Shared.Attacks, 0.05, noMistakes)
	eq(i.attack, nil)
end)

test("ボット：％が高い相手にはスマッシュを使う", function()
	local mind = BotBrain.newMind(1)
	local i = BotBrain.decide(mind, me({ x = 0 }), { { x = 5, y = 4, percent = 120 } }, plats, Shared.Attacks, 0, noMistakes)
	eq(i.attack, "Smash")
end)

test("ボット：頭の上の相手には上向きに攻撃する", function()
	local mind = BotBrain.newMind(1)
	local i = BotBrain.decide(mind, me({ x = 0 }), { { x = 1, y = 9, percent = 0 } }, plats, Shared.Attacks, 0, noMistakes)
	eq(i.aim, "up")
end)

test("ボット：場外に出たら足場に戻る", function()
	local mind = BotBrain.newMind(1)
	-- 左の外で落下中 → 右へ進み、2段ジャンプを使う
	local i = BotBrain.decide(mind, me({ x = -45, y = -4, vy = -30, grounded = false }), { { x = 0, y = 4, percent = 0 } }, plats, Shared.Attacks, 0, noMistakes)
	eq(i.move, 1)
	eq(i.jump, true)
	-- 右の外 → 左へ
	i = BotBrain.decide(mind, me({ x = 50, y = 0, vy = -10, grounded = false }), { { x = 0, y = 4, percent = 0 } }, plats, Shared.Attacks, 0, noMistakes)
	eq(i.move, -1)
	-- 2段ジャンプを使い切っていたら、ダッシュで戻る
	i = BotBrain.decide(mind, me({ x = -55, y = 3, vy = -5, grounded = false, canDouble = false }), { { x = 0, y = 4, percent = 0 } }, plats, Shared.Attacks, 0, noMistakes)
	eq(i.dash, true)
end)

test("ボット：足場の端から自分で落ちない", function()
	local mind = BotBrain.newMind(1)
	-- 端（x=34）にいて、相手は外側の下にいない → 外へ歩かない
	local i = BotBrain.decide(mind, me({ x = 34.5 }), { { x = 60, y = 4, percent = 0 } }, plats, Shared.Attacks, 0, noMistakes)
	eq(i.move, 0)
end)

test("ボット：操作できないときは何もしない", function()
	local mind = BotBrain.newMind(1)
	local i = BotBrain.decide(mind, me({ stunned = true }), { { x = 5, y = 4, percent = 0 } }, plats, Shared.Attacks, 0, noMistakes)
	eq(i.move, 0); eq(i.attack, nil); eq(i.jump, false)
end)

test("ボット：相手がいなくても止まらない（エラーにならない）", function()
	local i = BotBrain.decide(BotBrain.newMind(1), me({}), {}, plats, Shared.Attacks, 0, noMistakes)
	eq(i.attack, nil)
end)

print(("\n%d 件成功 / %d 件失敗"):format(passed, failed))
if failed > 0 then error("テストに失敗しました") end
