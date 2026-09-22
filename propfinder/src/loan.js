/* ============================================================
 *  融資（元利均等返済）
 * ============================================================ */

/**
 * 元利均等返済の毎月返済額
 *   M = P × r(1+r)^n / ((1+r)^n - 1)
 * 金利0%のときは単純に元金を回数で割る。
 */
export function monthlyPayment({ principal, annualRate, years }) {
  const n = Math.round(years * 12);
  if (n <= 0) return 0;
  const r = annualRate / 12;
  if (r === 0) return principal / n;
  const pow = Math.pow(1 + r, n);
  return principal * r * pow / (pow - 1);
}

/**
 * m ヶ月経過後の残債
 *   残高 = P(1+r)^m - M × ((1+r)^m - 1) / r
 */
export function remainingBalance({ principal, annualRate, years, monthsElapsed }) {
  const n = Math.round(years * 12);
  const m = Math.min(Math.round(monthsElapsed), n);
  if (m <= 0) return principal;
  const r = annualRate / 12;
  const M = monthlyPayment({ principal, annualRate, years });
  if (r === 0) return Math.max(0, principal - M * m);
  const pow = Math.pow(1 + r, m);
  return Math.max(0, principal * pow - M * (pow - 1) / r);
}

/**
 * 年ごとの返済内訳（元金・利息）。
 * 課税所得の計算で「利息だけが経費になる」ため、元金と利息を分けて持つ必要がある。
 */
export function amortizationByYear({ principal, annualRate, years, holdYears }) {
  const n = Math.round(years * 12);
  const r = annualRate / 12;
  const M = monthlyPayment({ principal, annualRate, years });
  let balance = principal;
  const rows = [];

  for (let y = 1; y <= holdYears; y++) {
    let interestSum = 0;
    let principalSum = 0;
    for (let mo = 1; mo <= 12; mo++) {
      const monthIndex = (y - 1) * 12 + mo;
      if (monthIndex > n || balance <= 0) break;
      const interest = balance * r;
      let principalPart = M - interest;
      if (principalPart > balance) principalPart = balance; // 最終回の端数調整
      interestSum += interest;
      principalSum += principalPart;
      balance -= principalPart;
    }
    rows.push({
      year: y,
      interest: Math.round(interestSum),
      principal: Math.round(principalSum),
      payment: Math.round(interestSum + principalSum),
      endingBalance: Math.max(0, Math.round(balance))
    });
  }
  return { monthlyPayment: Math.round(M), annualPayment: Math.round(M * 12), rows };
}
