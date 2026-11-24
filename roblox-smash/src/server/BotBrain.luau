--!nonstrict
--[[
	スカイ乱闘：ボットの頭脳
	置き場所: ServerScriptService の中に ModuleScript として入れ、名前を BotBrain にする

	「いまの状況」を渡すと、「どう動くか」を返すだけの計算。Roblox のAPIには依存しない。
]]

local BotBrain = {}

local function sign(n)
	if n > 0.5 then return 1 elseif n < -0.5 then return -1 end
	return 0
end

-- いまの位置の真下にある足場の上面の高さ。なければ nil（場外）
function BotBrain.supportBelow(platforms, x, y)
	local best = nil
	for _, p in platforms do
		if x >= p.xmin - 1 and x <= p.xmax + 1 and p.top <= y + 3 then
			if best == nil or p.top > best.top then best = p end
		end
	end
	return best
end

-- 場外から戻るときの目標地点（いちばん近い足場の、端から少し内側）
function BotBrain.recoveryTarget(platforms, x, y, preferX)
	local best, bestDist = nil, math.huge
	for _, p in platforms do
		local tx = math.clamp(preferX or x, p.xmin + 3, p.xmax - 3)
		local dist = math.abs(tx - (preferX or x)) + math.max(0, p.top - y) * 0.6 + math.max(0, y - p.top) * 0.2
		if preferX then dist += math.abs(tx - x) * 0.05 end
		if dist < bestDist then best, bestDist = { x = tx, top = p.top }, dist end
	end
	return best
end

function BotBrain.newMind(skill)
	return { skill = skill or 0.6, nextAttackAt = 0, patience = 0.6, blockedSince = nil, leapUntil = 0, leapX = 0 }
end

--[[
	me: { x, y, vy, grounded, facing, percent, canDouble, canDash, lightReady, smashReady, stunned }
	enemies: { { x, y, percent } }
	戻り値: { move = -1/0/1, jump, dash, attack = nil/"Light"/"Smash", aim = "side"/"up"/"down", dir = -1/1 }
]]
function BotBrain.decide(mind, me, enemies, platforms, attacks, now, rng)
	rng = rng or math.random
	local intent = { move = 0, jump = false, dash = false, attack = nil, aim = "side", dir = me.facing }
	if me.stunned then return intent end

	local support = BotBrain.supportBelow(platforms, me.x, me.y)
	if not support then
		-- 場外：足場に向かって戻る
		local leaping = now < mind.leapUntil
		local target = BotBrain.recoveryTarget(platforms, me.x, me.y, leaping and mind.leapX or nil)
		if leaping and me.y < target.top - 8 then target = BotBrain.recoveryTarget(platforms, me.x, me.y) end   -- 落ちすぎたら、普通に戻る
		intent.move = sign(target.x - me.x)
		if intent.move ~= 0 then intent.dir = intent.move end
		if me.vy < 0 and me.canDouble and me.y < target.top + 5 then intent.jump = true end
		if me.canDash and math.abs(target.x - me.x) > 9 and me.y > target.top - 10 then intent.dash = true end
		return intent
	end

	-- いちばん近い相手を狙う
	local target, bestScore = nil, math.huge
	for _, e in enemies do
		local score = math.abs(e.x - me.x) + math.abs(e.y - me.y) * 1.5 - math.min(e.percent, 150) * 0.05
		if score < bestScore then target, bestScore = e, score end
	end
	if not target then return intent end

	local dx, dy = target.x - me.x, target.y - me.y
	local toward = sign(dx)
	if toward ~= 0 then intent.dir = toward end
	local range = attacks.Light.Range

	-- 近づく
	if math.abs(dx) > range * 0.7 then intent.move = toward end

	-- 足場の端：普通は落ちない。相手が別の足場にいて、しばらく進めないときは、思い切って跳び移る
	if intent.move ~= 0 then
		local ahead = me.x + intent.move * 4
		local atEdge = ahead < support.xmin + 0.5 or ahead > support.xmax - 0.5
		if atEdge and dy > -4 then
			if now < mind.leapUntil then
				local edgeDist = if intent.move > 0 then support.xmax - me.x else me.x - support.xmin
				if me.grounded and edgeDist < 3 then intent.jump = true end
			else
				intent.move = 0
				mind.blockedSince = mind.blockedSince or now
				if now - mind.blockedSince > mind.patience and math.abs(dx) < 50 then
					mind.leapUntil, mind.leapX, mind.blockedSince = now + 1.6, target.x, nil
					mind.patience = 0.4 + rng() * 1.0
				end
			end
		else
			mind.blockedSince = nil
		end
	else
		mind.blockedSince = nil
	end

	-- 相手が上にいるときはジャンプで追いかける
	if dy > 4.5 then
		if me.grounded and math.abs(dx) < 22 then
			intent.jump = true
		elseif me.canDouble and me.vy < -2 then
			intent.jump = true
		end
	end

	-- うっかり（腕前が低いほど増える）
	if rng() < (1 - mind.skill) * 0.12 then
		intent.move, intent.jump = 0, false
		return intent
	end

	-- 攻撃
	local inRange = math.abs(dx) <= range and math.abs(dy) <= 5
	local aboveRange = math.abs(dx) <= range * 0.7 and dy > 3 and dy <= 9
	if now >= mind.nextAttackAt and (inRange or aboveRange) then
		if aboveRange then intent.aim = "up"
		elseif dy < -3 and not me.grounded then intent.aim = "down" end
		local wantSmash = me.smashReady and (target.percent > 85 or rng() < 0.15 + mind.skill * 0.15)
		if wantSmash then
			intent.attack = "Smash"
		elseif me.lightReady then
			intent.attack = "Light"
		end
		if intent.attack then
			mind.nextAttackAt = now + (0.2 + rng() * 0.5) * (1.5 - mind.skill)
		end
	end
	return intent
end

return BotBrain
