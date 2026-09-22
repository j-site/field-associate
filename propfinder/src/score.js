/* ============================================================
 *  スクリーニングとスコアリング
 *
 *  2つの目的を別々の基準で評価する。
 *    rental … 賃貸として保有する（CF・積算・出口を総合）
 *    resale … 販売用に仕入れる（仕入値と想定売値の差が主役）
 *
 *  「足切り条件（knockout）」で論外の物件を落とし、
 *  残ったものを重み付きスコアで並べる、という二段構えにしている。
 * ============================================================ */

export const DEFAULT_CRITERIA = {
  rental: {
    knockout: {
      minGrossYield: 0.08,      // 表面利回りの下限（粗選別）
      minDscr: 1.2,             // これを割ると返済が危うい
      maxDebtRatio: 0.55,       // 返済比率の上限
      minMonthlyCashflow: 0,    // 月々の税引後CFの下限（円）
      minCostRatio: 0.6,        // 積算価格 ÷ 売出価格の下限（融資の出やすさ）
      maxAgeOverLife: true      // 残存耐用年数0（＝融資期間が取れない）を除外するか
    },
    weights: {
      netYield: 0.30,           // 実質利回り
      cashflow: 0.25,           // 月々のCF
      costRatio: 0.25,          // 積算評価
      exitIrr: 0.20             // 出口まで含めたIRR
    },
    targets: {                  // この水準で100点
      netYield: 0.07,
      monthlyCashflow: 150000,
      costRatio: 1.10,
      irr: 0.15
    }
  },
  resale: {
    knockout: {
      minSpreadRatio: 0.15,     // 想定売却益 ÷ 総投資額 の下限
      minCostRatio: 0.9,        // 積算より十分安く仕入れられているか
      maxHoldYears: 2
    },
    weights: {
      spreadRatio: 0.50,        // 転売益率
      costRatio: 0.30,          // 積算との乖離（＝割安度）
      liquidity: 0.20           // 流動性（価格帯・築年から簡易推定）
    },
    targets: {
      spreadRatio: 0.30,
      costRatio: 1.30,
      liquidity: 1.0
    }
  }
};

export const SCORE_MAX = 150;

/**
 * target を100点として正規化する。
 * 100点超はそのまま伸ばすと1つの軸が全体を支配してしまうので逓減させるが、
 * 完全に頭打ちにすると優良物件どうしの序列が消えるため上限は150点とする。
 */
function scaleScore(value, target) {
  if (target === 0) return 0;
  if (value == null || !isFinite(value)) return 0;
  const raw = (value / target) * 100;
  if (raw <= 100) return Math.max(0, raw);
  return Math.min(SCORE_MAX, 100 + (raw - 100) * 0.5);
}

/**
 * 評価できない軸を除外し、残った軸の重みを再配分して加重平均する。
 * 情報が無い軸を0点として扱うと、単に情報が足りないだけの物件を
 * 「悪い物件」と誤判定してしまうため。
 */
function weightedScore(parts, weights, unavailableKeys = []) {
  const usable = Object.keys(weights).filter(k => !unavailableKeys.includes(k));
  const totalWeight = usable.reduce((s, k) => s + weights[k], 0);
  if (totalWeight === 0) return 0;
  return usable.reduce((s, k) => s + parts[k] * (weights[k] / totalWeight), 0);
}

/** 賃貸保有としての評価 */
export function scoreRental(analysis, criteria = DEFAULT_CRITERIA.rental) {
  const { knockout: K, weights: W, targets: T } = criteria;
  const monthlyCf = Math.round(analysis.cashflow.rows[0]?.atcf / 12) || 0;
  const costRatio = analysis.valuation.cost.ratioToPrice;
  const costKnown = costRatio != null;
  const irrValue = analysis.returns.irr;

  const reasons = [];
  const warnings = [];
  if (!costKnown) {
    warnings.push("土地単価（路線価）が不明なため積算評価は判定対象外。国交省APIか路線価の入力で補完できる");
  }
  if (analysis.yields.gross < K.minGrossYield) {
    reasons.push(`表面利回り ${(analysis.yields.gross * 100).toFixed(2)}% < 基準 ${(K.minGrossYield * 100).toFixed(1)}%`);
  }
  if (analysis.dscr < K.minDscr) {
    reasons.push(`DSCR ${analysis.dscr.toFixed(2)} < 基準 ${K.minDscr}`);
  }
  if (analysis.debtRatio > K.maxDebtRatio) {
    reasons.push(`返済比率 ${(analysis.debtRatio * 100).toFixed(1)}% > 基準 ${(K.maxDebtRatio * 100).toFixed(0)}%`);
  }
  if (monthlyCf < K.minMonthlyCashflow) {
    reasons.push(`月次CF ${monthlyCf.toLocaleString()}円 < 基準 ${K.minMonthlyCashflow.toLocaleString()}円`);
  }
  if (costKnown && costRatio < K.minCostRatio) {
    reasons.push(`積算比率 ${(costRatio * 100).toFixed(0)}% < 基準 ${(K.minCostRatio * 100).toFixed(0)}%`);
  }
  if (K.maxAgeOverLife && analysis.loan.maxYearsByLife <= 0) {
    reasons.push("残存耐用年数0年（融資期間が取れない）");
  }

  const parts = {
    netYield: scaleScore(analysis.yields.net, T.netYield),
    cashflow: scaleScore(monthlyCf, T.monthlyCashflow),
    costRatio: costKnown ? scaleScore(costRatio, T.costRatio) : null,
    exitIrr: scaleScore(irrValue, T.irr)
  };
  const total = weightedScore(parts, W, costKnown ? [] : ["costRatio"]);

  return {
    purpose: "rental",
    passed: reasons.length === 0,
    reasons,
    warnings,
    parts,
    score: Math.round(total * 10) / 10,
    highlights: {
      表面利回り: analysis.yields.gross,
      実質利回り: analysis.yields.net,
      月次CF: monthlyCf,
      DSCR: analysis.dscr,
      返済比率: analysis.debtRatio,
      積算比率: costRatio,
      IRR: irrValue
    }
  };
}

/**
 * 販売用（買取り再販）としての評価。
 * 想定売値は「積算価格」と「収益還元価格」の低い方を基準に、
 * 値付けの現実性を考えて安全率をかける。
 */
export function scoreResale(analysis, criteria = DEFAULT_CRITERIA.resale, opts = {}) {
  const { knockout: K, weights: W, targets: T } = criteria;
  const safety = opts.saleSafetyFactor ?? 0.95;   // 想定売値に対する安全率
  const renovationCost = opts.renovationCost ?? analysis.property.renovationCost ?? 0;

  const candidates = [
    analysis.valuation.cost.total,
    analysis.valuation.income.value
  ].filter(v => v != null && v > 0);
  const assumedSalePrice = candidates.length ? Math.round(Math.min(...candidates) * safety) : null;

  let spread = null, spreadRatio = null, saleCostTotal = 0;
  if (assumedSalePrice != null) {
    // 売却時の仲介手数料等はざっくり4%で見る（厳密な内訳は costs.saleCosts 側）
    saleCostTotal = Math.round(assumedSalePrice * 0.04);
    const totalCost = analysis.totalInvestment + renovationCost;
    spread = assumedSalePrice - saleCostTotal - totalCost;
    spreadRatio = totalCost > 0 ? spread / totalCost : null;
  }

  const costRatio = analysis.valuation.cost.ratioToPrice;
  const costKnown = costRatio != null;
  // 流動性：価格が小さく築が浅いほど売りやすい、という単純なヒューリスティック
  const priceFactor = analysis.property.price <= 30000000 ? 1.0
    : analysis.property.price <= 80000000 ? 0.8
    : analysis.property.price <= 200000000 ? 0.6 : 0.4;
  const ageFactor = analysis.property.ageYears <= 15 ? 1.0
    : analysis.property.ageYears <= 30 ? 0.8 : 0.6;
  const liquidity = priceFactor * ageFactor;

  const reasons = [];
  const warnings = [];
  if (!costKnown) {
    warnings.push("土地単価（路線価）が不明なため積算評価は判定対象外。国交省APIか路線価の入力で補完できる");
  }
  if (spreadRatio == null) reasons.push("想定売値を算出できない（積算・収益還元のいずれも不明）");
  else if (spreadRatio < K.minSpreadRatio) {
    reasons.push(`想定利益率 ${(spreadRatio * 100).toFixed(1)}% < 基準 ${(K.minSpreadRatio * 100).toFixed(0)}%`);
  }
  if (costKnown && costRatio < K.minCostRatio) {
    reasons.push(`積算比率 ${(costRatio * 100).toFixed(0)}% < 基準 ${(K.minCostRatio * 100).toFixed(0)}%`);
  }

  const parts = {
    spreadRatio: scaleScore(spreadRatio, T.spreadRatio),
    costRatio: costKnown ? scaleScore(costRatio, T.costRatio) : null,
    liquidity: scaleScore(liquidity, T.liquidity)
  };
  const total = weightedScore(parts, W, costKnown ? [] : ["costRatio"]);

  return {
    purpose: "resale",
    passed: reasons.length === 0,
    reasons,
    warnings,
    parts,
    score: Math.round(total * 10) / 10,
    highlights: {
      想定売値: assumedSalePrice,
      売却諸費用: saleCostTotal,
      改修費: renovationCost,
      総投資額: analysis.totalInvestment,
      想定利益: spread,
      利益率: spreadRatio,
      積算比率: costRatio,
      流動性: liquidity
    }
  };
}

/** 両方の目的で評価し、向いている方を返す */
export function evaluate(analysis, criteria = DEFAULT_CRITERIA, opts = {}) {
  const rental = scoreRental(analysis, criteria.rental);
  const resale = scoreResale(analysis, criteria.resale, opts);
  const best = (() => {
    if (rental.passed && !resale.passed) return "rental";
    if (!rental.passed && resale.passed) return "resale";
    if (!rental.passed && !resale.passed) return null;
    return rental.score >= resale.score ? "rental" : "resale";
  })();
  return { rental, resale, recommended: best };
}
