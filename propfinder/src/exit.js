/* ============================================================
 *  出口（売却）シミュレーションと投資収益率
 * ============================================================ */

import { saleCosts } from "./costs.js";
import { remainingBalance } from "./loan.js";

/** 個人の譲渡所得税率（復興特別所得税込み） */
export const TRANSFER_TAX_RATE = {
  short: 0.3963,  // 短期譲渡：所得税30% + 復興0.63% + 住民税9%
  long: 0.20315   // 長期譲渡：所得税15% + 復興0.315% + 住民税5%
};

/**
 * 長期譲渡になるかの判定。
 * 所有期間は「譲渡した年の1月1日時点」で判定するため、暦の上では6年目の売却で
 * ようやく長期になるケースが多い。安全側に倒して既定は 6年以上を長期とする。
 */
export function isLongTerm(holdYears, { boundaryYears = 6 } = {}) {
  return holdYears >= boundaryYears;
}

/**
 * 売却価格の想定。
 *   capRate 指定時 … 売却時NOI ÷ 出口キャップレート（収益還元）
 *   それ以外       … 購入価格 × (1 - 年あたり下落率)^保有年数
 */
export function estimateSalePrice({ purchasePrice, exitNoi, exitCapRate, annualPriceDecline = 0.01, holdYears }) {
  if (exitCapRate && exitCapRate > 0 && exitNoi != null) {
    return { price: Math.round(exitNoi / exitCapRate), method: `出口Cap ${(exitCapRate * 100).toFixed(1)}%` };
  }
  const price = Math.round(purchasePrice * Math.pow(1 - annualPriceDecline, holdYears));
  return { price, method: `年${(annualPriceDecline * 100).toFixed(1)}%下落想定` };
}

/**
 * 売却時の手取り。
 *   譲渡所得 = 売却価格 - 取得費 - 譲渡費用
 *   取得費   = 取得価額（物件価格＋取得時諸費用）- 建物の減価償却累計額
 *   手取り   = 売却価格 - 譲渡費用 - 残債 - 譲渡税
 */
export function saleProceeds({
  salePrice,
  acquisitionPrice,        // 物件価格
  acquisitionCostTotal,    // 購入諸費用
  accumulatedDepreciation, // 建物の減価償却累計額
  loan,                    // { principal, annualRate, years }
  holdYears,
  rates = {},
  taxRateOverride = null,  // 法人などで税率が違う場合
  longTermBoundaryYears = 6
}) {
  const costs = saleCosts(salePrice, rates);
  const balance = loan && loan.principal > 0
    ? Math.round(remainingBalance({ ...loan, monthsElapsed: holdYears * 12 }))
    : 0;

  const bookCost = acquisitionPrice + acquisitionCostTotal - accumulatedDepreciation;
  const capitalGain = salePrice - bookCost - costs.total;

  const longTerm = isLongTerm(holdYears, { boundaryYears: longTermBoundaryYears });
  const taxRate = taxRateOverride ?? (longTerm ? TRANSFER_TAX_RATE.long : TRANSFER_TAX_RATE.short);
  const transferTax = capitalGain > 0 ? Math.round(capitalGain * taxRate) : 0;

  const netProceeds = salePrice - costs.total - balance - transferTax;

  return {
    salePrice,
    saleCosts: costs.total,
    loanBalance: balance,
    bookCost,
    capitalGain,
    longTerm,
    taxRate,
    transferTax,
    netProceeds
  };
}

/**
 * IRR（内部収益率）を二分法で求める。
 * cashflows[0] は初期投資（負の値）、以降は各年のキャッシュフロー。
 */
export function irr(cashflows, { tolerance = 1e-7, maxIterations = 200 } = {}) {
  const npv = rate => cashflows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + rate, t), 0);

  let low = -0.9999, high = 10;
  const npvLow = npv(low), npvHigh = npv(high);
  // 符号が変わらない場合は解が範囲内に無い（全期間プラス／全期間マイナスなど）
  if (npvLow * npvHigh > 0) return null;

  for (let i = 0; i < maxIterations; i++) {
    const mid = (low + high) / 2;
    const value = npv(mid);
    if (Math.abs(value) < tolerance) return mid;
    if (npv(low) * value < 0) high = mid; else low = mid;
  }
  return (low + high) / 2;
}

/** 累計キャッシュフローと売却手取りから、投下資金に対する総合リターンを出す */
export function investmentReturn({ equity, cashflowRows, netProceeds }) {
  const flows = [-equity];
  cashflowRows.forEach((r, i) => {
    const isLast = i === cashflowRows.length - 1;
    flows.push(r.atcf + (isLast ? netProceeds : 0));
  });
  const totalReturn = flows.reduce((a, b) => a + b, 0);
  return {
    cashflows: flows,
    irr: irr(flows),
    totalProfit: totalReturn,
    multiple: equity > 0 ? (totalReturn + equity) / equity : null
  };
}
