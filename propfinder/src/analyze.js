/* ============================================================
 *  物件1件を丸ごと分析する統合レイヤー
 *
 *  入力は「物件の生データ + 前提条件」、出力は判断に必要な指標一式。
 *  前提（融資条件・税率・空室率）は必ず明示的に持ち回り、
 *  どの数字がどの仮定に依存しているか追えるようにする。
 * ============================================================ */

import { DEFAULT_RATES, acquisitionCosts, splitLandBuilding } from "./costs.js";
import { depreciationSchedule } from "./depreciation.js";
import { grossYield, noi, netYield, debtRatio, dscr, cashflowByYear, paybackYears } from "./metrics.js";
import { costApproach, incomeApproach, priceOpinion } from "./valuation.js";
import { estimateSalePrice, saleProceeds, investmentReturn } from "./exit.js";

export const DEFAULT_ASSUMPTIONS = {
  // 融資条件
  ltv: 0.9,             // 借入割合（物件価格に対して）
  loanRate: 0.022,      // 金利
  loanYears: 25,        // 返済期間
  loanYearsLimitedByLife: true, // 残存耐用年数で返済期間を制限する（金融機関の一般的な考え方）

  // 運用前提
  holdYears: 10,        // 保有年数
  vacancyRate: 0.10,
  rentDeclineRate: 0.01,// 年あたりの賃料下落
  incomeTaxRate: 0.33,  // 保有期間中の実効税率（個人の課税所得帯 or 法人実効税率）

  // 出口前提
  exitCapRate: null,    // 指定があれば収益還元で売却価格を想定
  annualPriceDecline: 0.01,
  longTermBoundaryYears: 6,

  // 評価前提
  marketCapRate: 0.08   // 収益還元価格を出すときの還元利回り
};

/**
 * 融資期間の上限。多くの金融機関は「法定耐用年数 - 築年数」を目安にする。
 * 築古だと期間が極端に短くなり、返済比率が跳ね上がる現実を反映させる。
 */
import { LEGAL_USEFUL_LIFE } from "./depreciation.js";
export function maxLoanYears(structure, ageYears) {
  const legal = LEGAL_USEFUL_LIFE[structure] ?? 0;
  return Math.max(0, legal - ageYears);
}

export function analyze(propertyInput, assumptionsInput = {}, ratesInput = {}) {
  const A = { ...DEFAULT_ASSUMPTIONS, ...assumptionsInput };
  const R = { ...DEFAULT_RATES, ...ratesInput };

  // --- 1. 価格の内訳 ---
  const split = splitLandBuilding(propertyInput, R);
  const property = {
    ...propertyInput,
    landPrice: split.landPrice,
    buildingPrice: split.buildingPrice,
    vacancyRate: propertyInput.vacancyRate ?? A.vacancyRate
  };

  // --- 2. 融資条件 ---
  const cap = maxLoanYears(property.structure, property.ageYears);
  const loanYears = A.loanYearsLimitedByLife ? Math.min(A.loanYears, cap) : A.loanYears;
  const loanAmount = Math.round(property.price * A.ltv);
  const loan = loanYears > 0 && loanAmount > 0
    ? { principal: loanAmount, annualRate: A.loanRate, years: loanYears }
    : { principal: 0, annualRate: A.loanRate, years: 0 };
  property.loanAmount = loan.principal;

  // --- 3. 購入諸費用と総投資額 ---
  const acq = acquisitionCosts(property, R);
  const totalInvestment = property.price + acq.total;
  const equity = totalInvestment - loan.principal; // 自己資金（頭金＋諸費用）

  // --- 4. 収益指標 ---
  const gross = grossYield(property);
  const income = noi(property, R);
  const net = netYield({ noiValue: income.noi, totalInvestment });

  // --- 5. 減価償却とキャッシュフロー ---
  const dep = depreciationSchedule({
    buildingPrice: property.buildingPrice,
    structure: property.structure,
    ageYears: property.ageYears,
    holdYears: A.holdYears
  });
  const cf = cashflowByYear({
    noiValue: income.noi,
    loan,
    depreciationRows: dep.years,
    holdYears: A.holdYears,
    taxRate: A.incomeTaxRate,
    rentDeclineRate: A.rentDeclineRate
  });
  const ratio = debtRatio({ annualDebtService: cf.annualDebtService, grossRent: income.grossRent });
  const cover = dscr({ noiValue: income.noi, annualDebtService: cf.annualDebtService });
  const payback = paybackYears({ equity, cashflowRows: cf.rows });

  // --- 6. 価格評価 ---
  const costVal = costApproach(property, { replacementCost: ratesInput.replacementCost });
  const incomeVal = incomeApproach({ noi: income.noi, capRate: A.marketCapRate });
  const opinion = priceOpinion({
    price: property.price,
    costValue: costVal.total || null,
    incomeValue: incomeVal.value
  });

  // --- 7. 出口 ---
  const exitNoi = cf.rows.length ? cf.rows[cf.rows.length - 1].noi : income.noi;
  const sale = estimateSalePrice({
    purchasePrice: property.price,
    exitNoi,
    exitCapRate: A.exitCapRate,
    annualPriceDecline: A.annualPriceDecline,
    holdYears: A.holdYears
  });
  const proceeds = saleProceeds({
    salePrice: sale.price,
    acquisitionPrice: property.price,
    acquisitionCostTotal: acq.total,
    accumulatedDepreciation: dep.accumulated,
    loan,
    holdYears: A.holdYears,
    rates: R,
    longTermBoundaryYears: A.longTermBoundaryYears
  });
  const ret = investmentReturn({ equity, cashflowRows: cf.rows, netProceeds: proceeds.netProceeds });

  return {
    property,
    assumptions: A,
    priceSplit: split,
    loan: { ...loan, maxYearsByLife: cap, monthlyPayment: cf.monthlyPayment, annualDebtService: cf.annualDebtService },
    acquisition: acq,
    totalInvestment,
    equity,
    income,
    yields: { gross, net },
    debtRatio: ratio,
    dscr: cover,
    depreciation: dep,
    cashflow: cf,
    paybackYears: payback,
    valuation: { cost: costVal, income: incomeVal, opinion },
    exit: { ...sale, ...proceeds },
    returns: ret
  };
}
