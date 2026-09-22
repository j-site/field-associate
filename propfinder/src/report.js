/* ============================================================
 *  レポート整形（ターミナル出力 / JSON / CSV）
 * ============================================================ */

import { STRUCTURE_LABEL } from "./depreciation.js";
import { SCORE_MAX } from "./score.js";

export const yen = n => (n == null ? "—" : `${Math.round(n).toLocaleString("ja-JP")}円`);
const structureName = s => STRUCTURE_LABEL[s] ?? s ?? "構造不明";
// 借入なし（現金購入）のときDSCRは無限大になる。数字として出すと誤解を招くので明示する
const dscrText = (v, short = false) => (isFinite(v) ? v.toFixed(2) : (short ? "—" : "— (借入なし)"));
export const man = n => (n == null ? "—" : `${(Math.round(n / 10000)).toLocaleString("ja-JP")}万円`);
export const pct = (n, d = 2) => (n == null || !isFinite(n) ? "—" : `${(n * 100).toFixed(d)}%`);

function bar(score, width = 20) {
  const filled = Math.max(0, Math.min(width, Math.round((score / SCORE_MAX) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** 1物件の詳細レポート */
export function formatDetail(analysis, evaluation) {
  const p = analysis.property;
  const cf1 = analysis.cashflow.rows[0];
  const L = [];

  L.push("━".repeat(58));
  L.push(`${p.name || "(物件名なし)"}  ${p.address || ""}`);
  L.push("━".repeat(58));
  L.push(`価格 ${man(p.price)} / 満室想定年収 ${man(p.annualRent)} / ${structureName(p.structure)} 築${p.ageYears}年`);
  if (p.url) L.push(p.url);
  L.push("");

  L.push("【収益性】");
  L.push(`  表面利回り     ${pct(analysis.yields.gross)}`);
  L.push(`  実質利回り     ${pct(analysis.yields.net)}  (NOI ${man(analysis.income.noi)} ÷ 総投資額 ${man(analysis.totalInvestment)})`);
  L.push(`  NOI            ${man(analysis.income.noi)}  (実効賃料 ${man(analysis.income.effectiveRent)} − 運営費 ${man(analysis.income.opex)})`);
  L.push("");

  L.push("【融資・キャッシュフロー】");
  L.push(`  借入           ${man(analysis.loan.principal)} / 金利 ${pct(analysis.assumptions.loanRate)} / ${analysis.loan.years}年`);
  if (analysis.loan.years < analysis.assumptions.loanYears) {
    L.push(`                 ※残存耐用年数${analysis.loan.maxYearsByLife}年により期間短縮`);
  }
  L.push(`  自己資金       ${man(analysis.equity)}  (頭金＋諸費用 ${man(analysis.acquisition.total)})`);
  L.push(`  年間返済       ${man(analysis.loan.annualDebtService)} (月 ${yen(analysis.loan.monthlyPayment)})`);
  L.push(`  返済比率       ${pct(analysis.debtRatio, 1)}   DSCR ${dscrText(analysis.dscr)}`);
  L.push(`  初年度CF       税引前 ${man(cf1?.btcf)} / 税引後 ${man(cf1?.atcf)}  (月 ${yen(cf1 ? cf1.atcf / 12 : null)})`);
  L.push(`  自己資金回収   ${analysis.paybackYears ? analysis.paybackYears.toFixed(1) + "年" : "保有期間内に回収不可"}`);
  L.push("");

  L.push("【評価】");
  const cv = analysis.valuation.cost;
  if (cv.landKnown) {
    L.push(`  積算価格       ${man(cv.total)} (土地 ${man(cv.landValue)} + 建物 ${man(cv.buildingValue)})  対売出 ${pct(cv.ratioToPrice, 0)}`);
  } else {
    L.push(`  積算価格       判定不可（土地単価不明）  建物のみ ${man(cv.buildingValue)}`);
  }
  L.push(`  収益還元価格   ${man(analysis.valuation.income.value)} (還元利回り ${pct(analysis.assumptions.marketCapRate, 1)})`);
  L.push("");

  L.push(`【出口：${analysis.assumptions.holdYears}年後に売却】`);
  L.push(`  想定売却価格   ${man(analysis.exit.salePrice)} (${analysis.exit.method})`);
  L.push(`  残債           ${man(analysis.exit.loanBalance)}`);
  L.push(`  譲渡税         ${man(analysis.exit.transferTax)} (${analysis.exit.longTerm ? "長期" : "短期"} ${pct(analysis.exit.taxRate, 3)})`);
  L.push(`  売却手取り     ${man(analysis.exit.netProceeds)}`);
  L.push(`  累計税引後CF   ${man(analysis.cashflow.totalAtcf)}`);
  L.push(`  総利益         ${man(analysis.returns.totalProfit)}   IRR ${pct(analysis.returns.irr)}`);
  L.push("");

  if (evaluation) {
    L.push("【判定】");
    for (const key of ["rental", "resale"]) {
      const e = evaluation[key];
      const label = key === "rental" ? "賃貸保有" : "販売用　";
      const mark = e.passed ? "○" : "×";
      L.push(`  ${mark} ${label}  ${bar(e.score)} ${e.score.toFixed(1)}点`);
      e.reasons.forEach(r => L.push(`       └ ${r}`));
      (e.warnings || []).forEach(w => L.push(`       ⚠ ${w}`));
    }
    L.push(`  → ${evaluation.recommended
      ? (evaluation.recommended === "rental" ? "賃貸保有向き" : "販売用向き")
      : "いずれの基準も満たさない"}`);
  }
  L.push("━".repeat(58));
  return L.join("\n");
}

/** 一覧（スクリーニング結果）を1行1件で */
export function formatTable(results) {
  const rows = results.map(r => ({
    名称: (r.analysis.property.name || "—").slice(0, 16),
    価格: man(r.analysis.property.price),
    表面: pct(r.analysis.yields.gross, 1),
    実質: pct(r.analysis.yields.net, 1),
    月CF: yen(Math.round((r.analysis.cashflow.rows[0]?.atcf ?? 0) / 12)),
    DSCR: dscrText(r.analysis.dscr, true),
    積算比: r.analysis.valuation.cost.landKnown ? pct(r.analysis.valuation.cost.ratioToPrice, 0) : "不明",
    IRR: pct(r.analysis.returns.irr, 1),
    賃貸: r.evaluation.rental.passed ? `○${r.evaluation.rental.score.toFixed(0)}` : "×",
    販売: r.evaluation.resale.passed ? `○${r.evaluation.resale.score.toFixed(0)}` : "×"
  }));
  if (!rows.length) return "(該当なし)";

  const headers = Object.keys(rows[0]);
  const width = {};
  headers.forEach(h => {
    width[h] = Math.max(displayWidth(h), ...rows.map(r => displayWidth(String(r[h]))));
  });
  const line = cells => headers.map((h, i) => padTo(String(cells[i]), width[h])).join("  ");
  const out = [line(headers), headers.map(h => "─".repeat(width[h])).join("  ")];
  rows.forEach(r => out.push(line(headers.map(h => r[h]))));
  return out.join("\n");
}

/** 全角を2幅として数える（表のずれを防ぐ） */
function displayWidth(s) {
  let w = 0;
  for (const ch of s) w += /[　-鿿＀-｠。、％]/.test(ch) ? 2 : 1;
  return w;
}
function padTo(s, target) {
  return s + " ".repeat(Math.max(0, target - displayWidth(s)));
}

/** CSV出力（表計算で再検討したいとき用） */
export function toCsv(results) {
  const header = [
    "名称", "所在地", "価格", "年収", "構造", "築年数",
    "表面利回り", "実質利回り", "NOI", "月次CF", "DSCR", "返済比率",
    "積算価格", "積算比率", "IRR", "賃貸スコア", "賃貸可否", "販売スコア", "販売可否", "URL"
  ];
  const lines = [header.join(",")];
  for (const { analysis: a, evaluation: e } of results) {
    lines.push([
      csvCell(a.property.name), csvCell(a.property.address),
      a.property.price, a.property.annualRent, structureName(a.property.structure), a.property.ageYears,
      round(a.yields.gross, 4), round(a.yields.net, 4), a.income.noi,
      Math.round((a.cashflow.rows[0]?.atcf ?? 0) / 12),
      isFinite(a.dscr) ? round(a.dscr, 2) : "", round(a.debtRatio, 3),
      a.valuation.cost.landKnown ? a.valuation.cost.total : "", round(a.valuation.cost.ratioToPrice, 3),
      round(a.returns.irr, 4),
      e.rental.score, e.rental.passed ? "可" : "否",
      e.resale.score, e.resale.passed ? "可" : "否",
      csvCell(a.property.url)
    ].join(","));
  }
  return lines.join("\n");
}
function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function round(v, d) {
  return v == null || !isFinite(v) ? "" : Number(v.toFixed(d));
}
