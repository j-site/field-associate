/* ============================================================
 *  収益指標
 *    表面利回り / NOI / 実質利回り / 返済比率 / DSCR / CF
 * ============================================================ */

import { annualOperatingExpenses } from "./costs.js";
import { amortizationByYear } from "./loan.js";

/** 表面利回り = 満室想定年間賃料 ÷ 物件価格 */
export function grossYield({ annualRent, price }) {
  return price > 0 ? annualRent / price : 0;
}

/**
 * NOI（営業純収益）= 実効賃料収入 - 運営費用
 * 借入返済・減価償却は含めない。
 */
export function noi(property, rates) {
  const opex = annualOperatingExpenses(property, rates);
  return {
    grossRent: opex.grossRent,
    effectiveRent: opex.effectiveRent,
    opex: opex.total,
    opexBreakdown: opex.breakdown,
    noi: opex.effectiveRent - opex.total
  };
}

/**
 * 実質利回り（NOI利回り）= NOI ÷ 総投資額
 * 総投資額 = 物件価格 + 購入諸費用（諸費用を除くと利回りが過大に出る）
 */
export function netYield({ noiValue, totalInvestment }) {
  return totalInvestment > 0 ? noiValue / totalInvestment : 0;
}

/** 返済比率 = 年間返済額 ÷ 満室想定年間賃料。50%以下が安全圏とされる */
export function debtRatio({ annualDebtService, grossRent }) {
  return grossRent > 0 ? annualDebtService / grossRent : 0;
}

/** DSCR = NOI ÷ 年間元利返済額。1.3以上が目安、1.0未満は返済不能 */
export function dscr({ noiValue, annualDebtService }) {
  return annualDebtService > 0 ? noiValue / annualDebtService : Infinity;
}

/**
 * 年次キャッシュフロー。
 *   税引前CF(BTCF) = NOI - 元利返済額
 *   課税所得       = NOI - 支払利息 - 減価償却費   ※元金返済は経費にならない
 *   税引後CF(ATCF) = BTCF - 税額
 *
 * 課税所得が赤字の年は、他の所得と損益通算できる前提で税額をマイナス（節税効果）とする。
 * 法人か個人か、他の所得の有無で実際の効果は変わるため taxRate は必ず実態に合わせること。
 */
export function cashflowByYear({
  noiValue,
  loan,              // { principal, annualRate, years }
  depreciationRows,  // depreciationSchedule().years
  holdYears,
  taxRate,
  rentDeclineRate = 0,  // 年あたりの賃料下落率（0.01 = 毎年1%下落）
  offsetLossAgainstOtherIncome = true
}) {
  const amort = loan && loan.principal > 0
    ? amortizationByYear({ ...loan, holdYears })
    : { monthlyPayment: 0, annualPayment: 0, rows: [] };

  const rows = [];
  for (let y = 1; y <= holdYears; y++) {
    const decline = Math.pow(1 - rentDeclineRate, y - 1);
    const noiY = Math.round(noiValue * decline);
    const a = amort.rows[y - 1] || { interest: 0, principal: 0, payment: 0, endingBalance: 0 };
    const dep = depreciationRows[y - 1]?.amount ?? 0;

    const btcf = noiY - a.payment;
    const taxableIncome = noiY - a.interest - dep;
    let tax;
    if (taxableIncome >= 0) tax = Math.round(taxableIncome * taxRate);
    else tax = offsetLossAgainstOtherIncome ? Math.round(taxableIncome * taxRate) : 0;
    const atcf = btcf - tax;

    rows.push({
      year: y,
      noi: noiY,
      interest: a.interest,
      principalRepaid: a.principal,
      debtService: a.payment,
      depreciation: dep,
      btcf,
      taxableIncome,
      tax,
      atcf,
      loanBalance: a.endingBalance
    });
  }

  return {
    monthlyPayment: amort.monthlyPayment,
    annualDebtService: amort.annualPayment,
    rows,
    totalBtcf: rows.reduce((s, r) => s + r.btcf, 0),
    totalAtcf: rows.reduce((s, r) => s + r.atcf, 0)
  };
}

/** 自己資金回収期間（年）。ATCFの累計が自己資金に達するまで */
export function paybackYears({ equity, cashflowRows }) {
  let acc = 0;
  for (const r of cashflowRows) {
    acc += r.atcf;
    if (acc >= equity) {
      const prev = acc - r.atcf;
      const need = equity - prev;
      return r.year - 1 + (r.atcf > 0 ? need / r.atcf : 0);
    }
  }
  return null; // 保有期間内に回収できない
}
