import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { usedUsefulLife, straightLineRate, depreciationSchedule, LEGAL_USEFUL_LIFE } from "../src/depreciation.js";
import { monthlyPayment, remainingBalance, amortizationByYear } from "../src/loan.js";
import { brokerageFee, stampDuty, acquisitionCosts, annualOperatingExpenses } from "../src/costs.js";
import { grossYield, noi, netYield, debtRatio, dscr, cashflowByYear, paybackYears } from "../src/metrics.js";
import { costApproach, incomeApproach } from "../src/valuation.js";
import { irr, saleProceeds, isLongTerm, TRANSFER_TAX_RATE } from "../src/exit.js";
import { analyze, maxLoanYears } from "../src/analyze.js";

describe("減価償却", () => {
  test("中古資産の耐用年数（簡便法）", () => {
    // 木造22年・築10年 → (22-10) + 10*0.2 = 14年
    assert.equal(usedUsefulLife("WOOD", 10), 14);
    // 木造・築25年（法定超過）→ 22*0.2 = 4.4 → 切捨て4年
    assert.equal(usedUsefulLife("WOOD", 25), 4);
    // RC47年・築20年 → (47-20) + 20*0.2 = 31年
    assert.equal(usedUsefulLife("RC", 20), 31);
    // RC・築50年（法定超過）→ 47*0.2 = 9.4 → 9年
    assert.equal(usedUsefulLife("RC", 50), 9);
    // 2年未満は2年に切り上げ
    assert.equal(usedUsefulLife("LIGHT_STEEL_THIN", 100), 3); // 19*0.2=3.8→3
    assert.ok(usedUsefulLife("WOOD", 999) >= 2);
  });

  test("定額法償却率は国税庁の償却率表と一致する", () => {
    assert.equal(straightLineRate(22), 0.046);
    assert.equal(straightLineRate(47), 0.022);
    assert.equal(straightLineRate(34), 0.030);
    assert.equal(straightLineRate(4), 0.250);
    assert.equal(straightLineRate(14), 0.072); // 1/14=0.0714→0.072
  });

  test("償却は耐用年数で止まり、簿価は0未満にならない", () => {
    const s = depreciationSchedule({
      buildingPrice: 10000000, structure: "WOOD", ageYears: 25, holdYears: 10
    });
    assert.equal(s.usefulLife, 4);
    // 5年目以降は償却なし
    assert.equal(s.years[4].amount, 0);
    assert.ok(s.bookValue >= 0);
    assert.ok(s.accumulated <= 10000000);
  });
});

describe("融資", () => {
  test("元利均等返済額（既知の値と照合）", () => {
    // 1000万円・年2.0%・20年 → 約50,588円/月
    const m = monthlyPayment({ principal: 10000000, annualRate: 0.02, years: 20 });
    assert.ok(Math.abs(m - 50588) < 5, `got ${m}`);
  });

  test("金利0%なら単純割り", () => {
    const m = monthlyPayment({ principal: 12000000, annualRate: 0, years: 10 });
    assert.equal(Math.round(m), 100000);
  });

  test("完済時点の残債は0になる", () => {
    const loan = { principal: 30000000, annualRate: 0.025, years: 25 };
    const bal = remainingBalance({ ...loan, monthsElapsed: 25 * 12 });
    assert.ok(bal < 1, `残債 ${bal}`);
  });

  test("元金と利息の合計が返済総額に一致し、残債と整合する", () => {
    const loan = { principal: 30000000, annualRate: 0.025, years: 25 };
    const a = amortizationByYear({ ...loan, holdYears: 10 });
    const paidPrincipal = a.rows.reduce((s, r) => s + r.principal, 0);
    const expectedBalance = remainingBalance({ ...loan, monthsElapsed: 120 });
    // 端数処理の差は許容
    assert.ok(Math.abs((loan.principal - paidPrincipal) - expectedBalance) < 100);
    assert.equal(a.rows[9].endingBalance, Math.round(expectedBalance));
    // 初期ほど利息が多い
    assert.ok(a.rows[0].interest > a.rows[9].interest);
  });
});

describe("諸費用", () => {
  test("仲介手数料は宅建業法の上限式に従う", () => {
    // 5000万円 → (5000万*3% + 6万) * 1.1 = (150万+6万)*1.1 = 171.6万
    assert.equal(brokerageFee(50000000), 1716000);
    // 300万円 → (300万*4% + 2万)*1.1 = (12万+2万)*1.1 = 15.4万
    assert.equal(brokerageFee(3000000), 154000);
    // 150万円 → 150万*5%*1.1 = 8.25万
    assert.equal(brokerageFee(1500000), 82500);
  });

  test("印紙税は価格帯で決まる", () => {
    assert.equal(stampDuty(30000000), 10000);
    assert.equal(stampDuty(60000000), 30000);
    assert.equal(stampDuty(200000000), 60000);
  });

  test("購入諸費用は物件価格の概ね6〜12%に収まる", () => {
    const acq = acquisitionCosts({
      price: 50000000, landPrice: 30000000, buildingPrice: 20000000, loanAmount: 45000000
    });
    assert.ok(acq.ratio > 0.06 && acq.ratio < 0.12, `ratio=${acq.ratio}`);
    assert.equal(acq.total, Object.values(acq.breakdown).reduce((a, b) => a + b, 0));
  });

  test("運営費用に借入返済と減価償却は含まれない", () => {
    const opex = annualOperatingExpenses({
      price: 50000000, landPrice: 30000000, buildingPrice: 20000000,
      annualRent: 5000000, vacancyRate: 0.1
    });
    assert.equal(opex.effectiveRent, 4500000);
    const keys = Object.keys(opex.breakdown);
    assert.ok(!keys.some(k => k.includes("返済") || k.includes("償却")));
    assert.ok(opex.total > 0 && opex.total < opex.effectiveRent);
  });
});

describe("収益指標", () => {
  const property = {
    price: 50000000, landPrice: 30000000, buildingPrice: 20000000,
    annualRent: 5000000, vacancyRate: 0.1, structure: "RC", ageYears: 20
  };

  test("表面利回り", () => {
    assert.equal(grossYield(property), 0.1);
  });

  test("実質利回りは表面利回りより必ず低い", () => {
    const inc = noi(property);
    const acq = acquisitionCosts({ ...property, loanAmount: 0 });
    const net = netYield({ noiValue: inc.noi, totalInvestment: property.price + acq.total });
    assert.ok(net < grossYield(property), `net=${net}`);
    assert.ok(net > 0);
  });

  test("DSCRが1未満なら返済がNOIを食い潰す", () => {
    const inc = noi(property);
    const heavy = dscr({ noiValue: inc.noi, annualDebtService: inc.noi * 2 });
    assert.ok(heavy < 1);
    assert.equal(debtRatio({ annualDebtService: 2500000, grossRent: 5000000 }), 0.5);
  });

  test("課税所得＝NOI-利息-減価償却（元金返済は経費にならない）", () => {
    const loan = { principal: 45000000, annualRate: 0.02, years: 25 };
    const dep = depreciationSchedule({
      buildingPrice: 20000000, structure: "RC", ageYears: 20, holdYears: 5
    });
    const cf = cashflowByYear({
      noiValue: 3500000, loan, depreciationRows: dep.years,
      holdYears: 5, taxRate: 0.33, rentDeclineRate: 0
    });
    const r = cf.rows[0];
    assert.equal(r.taxableIncome, r.noi - r.interest - r.depreciation);
    assert.equal(r.btcf, r.noi - r.debtService);
    assert.equal(r.atcf, r.btcf - r.tax);
    // 元金返済分は課税所得から引かれていない
    assert.ok(r.taxableIncome > r.btcf - r.depreciation - 1);
  });

  test("赤字年は損益通算で税がマイナス（節税）になる", () => {
    const dep = depreciationSchedule({
      buildingPrice: 30000000, structure: "WOOD", ageYears: 25, holdYears: 3
    });
    const cf = cashflowByYear({
      noiValue: 1000000, loan: { principal: 0, annualRate: 0, years: 0 },
      depreciationRows: dep.years, holdYears: 3, taxRate: 0.33, rentDeclineRate: 0
    });
    assert.ok(cf.rows[0].taxableIncome < 0);
    assert.ok(cf.rows[0].tax < 0);
    assert.ok(cf.rows[0].atcf > cf.rows[0].btcf);
  });

  test("自己資金回収期間", () => {
    const rows = [
      { year: 1, atcf: 1000000 }, { year: 2, atcf: 1000000 },
      { year: 3, atcf: 1000000 }, { year: 4, atcf: 1000000 }
    ];
    assert.equal(paybackYears({ equity: 2000000, cashflowRows: rows }), 2);
    assert.equal(paybackYears({ equity: 2500000, cashflowRows: rows }), 2.5);
    assert.equal(paybackYears({ equity: 99999999, cashflowRows: rows }), null);
  });
});

describe("価格評価", () => {
  test("積算価格：築年数が進むと建物評価がゼロに近づく", () => {
    const base = {
      price: 50000000, landArea: 200, buildingArea: 300,
      structure: "RC", rosenka: 100000
    };
    const young = costApproach({ ...base, ageYears: 0 });
    const old = costApproach({ ...base, ageYears: 47 });
    // 土地: 10万/0.8 * 200㎡ = 2500万
    assert.equal(young.landValue, 25000000);
    assert.equal(young.buildingValue, 200000 * 300); // 残存100%
    assert.equal(old.buildingValue, 0);              // 耐用年数経過
    assert.ok(young.ratioToPrice > old.ratioToPrice);
  });

  test("収益還元価格 = NOI ÷ 還元利回り", () => {
    assert.equal(incomeApproach({ noi: 4000000, capRate: 0.08 }).value, 50000000);
    assert.equal(incomeApproach({ noi: 4000000, capRate: 0 }).value, null);
  });
});

describe("出口・IRR", () => {
  test("IRRは既知の値と一致する", () => {
    // -1000 → 各年300を5年 の IRR は約15.24%
    const r = irr([-1000, 300, 300, 300, 300, 300]);
    assert.ok(Math.abs(r - 0.1524) < 0.001, `irr=${r}`);
  });

  test("IRRは解が存在しない場合nullを返す", () => {
    assert.equal(irr([-1000, -100, -100]), null);
  });

  test("短期譲渡は税率が約2倍になる", () => {
    assert.equal(isLongTerm(5), false);
    assert.equal(isLongTerm(6), true);
    assert.ok(TRANSFER_TAX_RATE.short > TRANSFER_TAX_RATE.long * 1.9);
  });

  test("減価償却が進むと取得費が下がり譲渡益（＝税）が増える", () => {
    const common = {
      salePrice: 50000000, acquisitionPrice: 50000000, acquisitionCostTotal: 4000000,
      loan: { principal: 0, annualRate: 0, years: 0 }, holdYears: 10
    };
    const noDep = saleProceeds({ ...common, accumulatedDepreciation: 0 });
    const withDep = saleProceeds({ ...common, accumulatedDepreciation: 10000000 });
    assert.ok(withDep.capitalGain > noDep.capitalGain);
    assert.ok(withDep.transferTax > noDep.transferTax);
    assert.ok(withDep.netProceeds < noDep.netProceeds);
  });

  test("譲渡損なら譲渡税は0", () => {
    const p = saleProceeds({
      salePrice: 30000000, acquisitionPrice: 50000000, acquisitionCostTotal: 4000000,
      accumulatedDepreciation: 0, loan: { principal: 0, annualRate: 0, years: 0 }, holdYears: 10
    });
    assert.ok(p.capitalGain < 0);
    assert.equal(p.transferTax, 0);
  });

  test("残債が売却価格を上回ると手取りがマイナスになる", () => {
    const p = saleProceeds({
      salePrice: 30000000, acquisitionPrice: 50000000, acquisitionCostTotal: 4000000,
      accumulatedDepreciation: 0,
      loan: { principal: 45000000, annualRate: 0.02, years: 30 }, holdYears: 3
    });
    assert.ok(p.netProceeds < 0, `netProceeds=${p.netProceeds}`);
  });
});

describe("統合分析", () => {
  test("融資期間は残存耐用年数で頭打ちになる", () => {
    assert.equal(maxLoanYears("WOOD", 15), 7);
    assert.equal(maxLoanYears("RC", 20), 27);
    assert.equal(maxLoanYears("WOOD", 30), 0);

    const old = analyze(
      { price: 30000000, annualRent: 4200000, structure: "WOOD", ageYears: 15,
        landArea: 150, buildingArea: 200, rosenka: 60000 },
      { loanYears: 25 }
    );
    assert.equal(old.loan.years, 7); // 25年希望でも7年が上限
  });

  test("指標同士の整合（総投資額・自己資金・CF）", () => {
    const a = analyze({
      price: 50000000, annualRent: 5000000, structure: "RC", ageYears: 20,
      landArea: 200, buildingArea: 300, rosenka: 100000
    });
    assert.equal(a.totalInvestment, a.property.price + a.acquisition.total);
    assert.equal(a.equity, a.totalInvestment - a.loan.principal);
    assert.equal(a.yields.gross, 0.1);
    assert.ok(a.yields.net < a.yields.gross);
    assert.equal(a.cashflow.rows[0].btcf, a.cashflow.rows[0].noi - a.cashflow.rows[0].debtService);
    assert.equal(a.returns.cashflows.length, a.assumptions.holdYears + 1);
    assert.equal(a.returns.cashflows[0], -a.equity);
  });

  test("同じ物件なら賃料が高いほど全指標が良くなる", () => {
    const base = {
      price: 50000000, structure: "RC", ageYears: 20,
      landArea: 200, buildingArea: 300, rosenka: 100000
    };
    const low = analyze({ ...base, annualRent: 3500000 });
    const high = analyze({ ...base, annualRent: 6000000 });
    assert.ok(high.yields.net > low.yields.net);
    assert.ok(high.dscr > low.dscr);
    assert.ok(high.cashflow.totalAtcf > low.cashflow.totalAtcf);
    assert.ok(high.returns.irr > low.returns.irr);
  });

  test("金利が上がるとDSCRとCFが悪化する", () => {
    const p = {
      price: 50000000, annualRent: 5000000, structure: "RC", ageYears: 20,
      landArea: 200, buildingArea: 300, rosenka: 100000
    };
    const cheap = analyze(p, { loanRate: 0.01 });
    const pricey = analyze(p, { loanRate: 0.045 });
    assert.ok(cheap.dscr > pricey.dscr);
    assert.ok(cheap.cashflow.totalBtcf > pricey.cashflow.totalBtcf);
  });

  test("フルローンに近いほど自己資金は減るがDSCRは悪化する", () => {
    const p = {
      price: 50000000, annualRent: 5000000, structure: "RC", ageYears: 20,
      landArea: 200, buildingArea: 300, rosenka: 100000
    };
    const low = analyze(p, { ltv: 0.6 });
    const full = analyze(p, { ltv: 1.0 });
    assert.ok(full.equity < low.equity);
    assert.ok(full.dscr < low.dscr);
  });
});
