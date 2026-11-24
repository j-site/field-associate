--!nonstrict
--[[
	ボット同士の試合シミュレーション（簡易な物理）。手ごたえの数字を調整するために使う。
	実行: luau test/sim.luau   （試合数と「人間くらいの腕前」を決めるなら -a 60 0.3）
	Roblox の本物の物理とは違うので、数字は目安。KOの出やすさ・場外からの復帰・試合の長さを見る。
]]
local Shared = require("../src/shared/SmashShared")
local BotBrain = require("../src/server/BotBrain")

BOT_SKILL, BOT_THINK = { 0.15, 0.4 }, 0.22
local G, DT, FOOT = 196.2, 1 / 60, 3
local C = Shared.Config

local function newFighter(i, layout, typeIdx)
	local def = Shared.Fighters[typeIdx]
	local s = layout.spawns[(i - 1) % #layout.spawns + 1]
	return {
		id = i, def = def, x = s[1], y = s[2] + FOOT, vx = 0, vy = 0, grounded = false, facing = 1,
		percent = 0, stocks = C.Stocks, fighting = true, shieldUntil = C.ShieldSeconds,
		stunUntil = 0, dashUntil = 0, dashDir = 1, nextDash = 0, canDouble = true,
		nextAttack = { Light = 0, Smash = 0 }, pending = nil, lastHitBy = nil, lastHitAt = -99,
		respawnAt = nil, mind = BotBrain.newMind(BOT_SKILL[1] + math.random() * (BOT_SKILL[2] - BOT_SKILL[1])), thinkEvery = BOT_THINK, move = 0, intent = nil, nextThink = math.random() * 0.1,
		stuckX = 0, stuckT = 0, offstageTime = 0,
	}
end

local function runMatch(layout, seed, verbose)
	math.randomseed(seed)
	local plats = Shared.platformsOf(layout)
	local fs = {}
	for i = 1, 4 do fs[i] = newFighter(i, layout, math.random(1, 3)) end
	if HUMAN then   -- 1人目を「人間くらいの腕前」にする（反応が遅く、ミスが多い）
		fs[1].mind = BotBrain.newMind(HUMAN_SKILL)
		fs[1].thinkEvery = 0.22
	end
	local stat = { kos = 0, selfKOs = 0, percentAtKO = 0, firstKO = nil, attacks = 0, hits = 0, stuck = 0, recoveries = 0, recoveryFails = 0 }
	local t = 0
	local function supportTop(f)
		local best = nil
		for _, p in plats do
			if f.x >= p.xmin - 0.5 and f.x <= p.xmax + 0.5 then
				local top = p.top + FOOT
				if f.y >= top - 0.5 and (best == nil or top > best) then best = top end
			end
		end
		return best
	end

	local function knockOut(f)
		stat.kos += 1
		if not stat.firstKO then stat.firstKO = t end
		if not (f.lastHitBy and t - f.lastHitAt < 8) then stat.selfKOs += 1 end
		stat.percentAtKO += f.percent
		f.stocks -= 1
		f.percent = 0
		f.lastHitBy = nil
		if f.stocks <= 0 then f.fighting = false; f.respawnAt = nil
		else f.respawnAt = t + C.RespawnDelay end
		f.vx, f.vy = 0, 0
		f.x, f.y = -9999, -9999   -- 復活待ち
	end

	local function resolve(f, kind, aim, dir)
		local spec = Shared.Attacks[kind]
		stat.attacks += 1
		for _, o in fs do
			if o ~= f and o.fighting and o.respawnAt == nil and o.shieldUntil <= t then
				if Shared.inHitbox(spec, aim, dir, f.x, f.y, o.x, o.y, 0) then
					stat.hits += 1
					o.percent = math.min(o.percent + spec.Damage * f.def.damage, 999)
					o.lastHitBy, o.lastHitAt = f.id, t
					local vx, vy = Shared.knockback(spec, aim, o.percent, o.def.weight, dir)
					o.vx, o.vy = vx, vy
					o.grounded = false
					o.stunUntil = t + Shared.stunSeconds(vx, vy)
				end
			end
		end
	end

	while t < C.MatchSeconds do
		t += DT
		local alive = 0
		for _, f in fs do if f.fighting then alive += 1 end end
		if alive <= 1 then break end

		for _, f in fs do
			if f.fighting then
				if f.respawnAt then
					if t >= f.respawnAt then
						local s = layout.spawns[(f.id - 1) % #layout.spawns + 1]
						f.x, f.y, f.vx, f.vy = s[1], s[2] + FOOT + 6, 0, 0
						f.respawnAt, f.shieldUntil, f.canDouble = nil, t + C.ShieldSeconds, true
					end
				else
					local stunned = t < f.stunUntil
					-- ボットの判断（0.1秒ごと）
					if t >= f.nextThink then
						f.nextThink = t + f.thinkEvery
						local enemies = {}
						for _, o in fs do
							if o ~= f and o.fighting and o.respawnAt == nil then table.insert(enemies, { x = o.x, y = o.y - FOOT, percent = o.percent }) end
						end
						f.intent = BotBrain.decide(f.mind, {
							x = f.x, y = f.y - FOOT, vy = f.vy, grounded = f.grounded, facing = f.facing, percent = f.percent,
							canDouble = f.canDouble, canDash = t >= f.nextDash, lightReady = t >= f.nextAttack.Light, smashReady = t >= f.nextAttack.Smash,
							stunned = stunned,
						}, enemies, plats, Shared.Attacks, t)
						local it = f.intent
						f.move = it.move
						if it.dir ~= 0 then f.facing = it.dir end
						if it.jump and not stunned then
							if f.grounded then f.vy, f.grounded = f.def.jump, false
							elseif f.canDouble then f.vy, f.canDouble = f.def.jump * 0.95, false end
						end
						if it.dash and not stunned and t >= f.nextDash then
							f.dashUntil, f.dashDir, f.nextDash = t + Shared.Dash.Time, (it.move ~= 0 and it.move or f.facing), t + Shared.Dash.Cooldown
						end
						if it.attack and not stunned and t >= f.nextAttack[it.attack] and not f.pending then
							local spec = Shared.Attacks[it.attack]
							f.nextAttack[it.attack] = t + spec.Cooldown
							f.pending = { at = t + spec.Windup, kind = it.attack, aim = it.aim, dir = f.facing }
							if f.grounded then f.vx += f.facing * (it.attack == "Smash" and C.LungeSmash or C.LungeLight) end
						end
					end
					if f.pending and t >= f.pending.at then
						resolve(f, f.pending.kind, f.pending.aim, f.pending.dir)
						f.pending = nil
					end

					-- 物理
					if t < f.dashUntil then
						f.vx = f.dashDir * Shared.Dash.Speed
					elseif stunned then
						if f.grounded then f.vx *= math.exp(-8 * DT) end
					elseif f.grounded then
						f.vx = f.move * f.def.walk
					else
						f.vx += (f.move * f.def.walk - f.vx) * math.min(1, 3 * DT)
					end
					f.vy -= G * DT
					local oldY = f.y
					f.x += f.vx * DT
					f.y += f.vy * DT
					f.grounded = false
					if f.vy <= 0 then
						for _, p in plats do
							if f.x >= p.xmin - 0.5 and f.x <= p.xmax + 0.5 then
								local top = p.top + FOOT
								if oldY >= top - 0.01 and f.y <= top then f.y, f.vy, f.grounded, f.canDouble = top, 0, true, true end
							end
						end
					end
					if Shared.outOfBounds(f.x, f.y - FOOT) then knockOut(f) end

					-- 場外にいる時間・動かない時間
					if f.fighting and f.respawnAt == nil then
						if supportTop(f) == nil then f.offstageTime += DT elseif f.offstageTime > 0 then
							stat.recoveries += 1; f.offstageTime = 0
						end
						if math.abs(f.x - f.stuckX) > 1.5 or stunned then f.stuckX, f.stuckT = f.x, 0
						else f.stuckT += DT; if f.stuckT > 6 then stat.stuck += 1; f.stuckT = -1000; if verbose then print(("stuck %s x=%.0f y=%.0f t=%.0f"):format(layout.id, f.x, f.y - FOOT, t)) end end end
					end
				end
			end
		end
	end
	local winnerList = {}
	for _, f in fs do table.insert(winnerList, { id = f.id, stocks = f.stocks, percent = f.percent, fighting = f.fighting }) end
	stat.duration = t
	stat.timedOut = t >= C.MatchSeconds
	stat.winner = Shared.pickWinner(winnerList)
	return stat
end

VERBOSE = false
local args = { ... }   -- 実行: luau test/sim.luau -a [試合数] [人間の腕前 0〜1] [ボットの腕前の下限] [上限] [ボットの反応の間隔（秒）]
BOT_SKILL = { tonumber(args[3]) or Shared.BotSkill[1], tonumber(args[4]) or Shared.BotSkill[2] }
BOT_THINK = tonumber(args[5]) or Shared.BotThink
local n = tonumber(args[1]) or 30
HUMAN_SKILL = tonumber(args[2])
HUMAN = HUMAN_SKILL ~= nil and HUMAN_SKILL > 0
local total = { kos = 0, selfKOs = 0, percentAtKO = 0, duration = 0, timedOut = 0, firstKO = 0, firstKOn = 0, attacks = 0, hits = 0, stuck = 0, draws = 0 }
local byLayout = {}
for i = 1, n do
	local layout = Shared.Layouts[(i - 1) % #Shared.Layouts + 1]
	local s = runMatch(layout, 1000 + i, VERBOSE)
	byLayout[layout.id] = byLayout[layout.id] or { n = 0, dur = 0, kos = 0, self = 0 }
	local b = byLayout[layout.id]
	b.n += 1; b.dur += s.duration; b.kos += s.kos; b.self += s.selfKOs
	total.kos += s.kos; total.selfKOs += s.selfKOs; total.percentAtKO += s.percentAtKO; total.duration += s.duration
	total.attacks += s.attacks; total.hits += s.hits; total.stuck += s.stuck
	if s.winner == 1 then total.humanWins = (total.humanWins or 0) + 1 end
	if s.timedOut then total.timedOut += 1 end
	if s.winner == nil then total.draws += 1 end
	if s.firstKO then total.firstKO += s.firstKO; total.firstKOn += 1 end
end
print(("試合数 %d"):format(n))
print(("平均の試合時間 %.0f 秒（上限 %d 秒）／ 時間切れ %d 試合 ／ 引き分け %d 試合"):format(total.duration / n, C.MatchSeconds, total.timedOut, total.draws))
print(("1試合あたりのKO %.1f 回（全員の残機の合計は %d）／ 自滅（直前に殴られていない）%.0f%%"):format(total.kos / n, 4 * C.Stocks, 100 * total.selfKOs / math.max(1, total.kos)))
print(("KOされたときの平均の％ %.0f ／ 最初のKOまで %.0f 秒"):format(total.percentAtKO / math.max(1, total.kos), total.firstKO / math.max(1, total.firstKOn)))
print(("攻撃 %.0f 回 → 命中 %.0f 回（命中率 %.0f%%）／ 1試合あたりの「動かなくなった」%.2f 回"):format(total.attacks / n, total.hits / n, 100 * total.hits / math.max(1, total.attacks), total.stuck / n))
for id, b in byLayout do
	print(("  %-8s 試合時間 %.0f 秒 / KO %.1f 回 / 自滅 %.1f 回"):format(id, b.dur / b.n, b.kos / b.n, b.self / b.n))
end

if HUMAN then
	print(("【人間くらいの腕前（腕前 %.2f・反応0.22秒）が、ボット3体と戦った結果】勝率 %.0f%%（4人の平等なら 25%%）"):format(HUMAN_SKILL, 100 * (total.humanWins or 0) / n))
end
