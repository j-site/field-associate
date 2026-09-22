import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/analyze.js";
import { evaluate, scoreRental, scoreResale, DEFAULT_CRITERIA } from "../src/score.js";
import { costApproach } from "../src/valuation.js";

const GOOD = {
  name: "地方重量鉄骨", price: 88000000, annualRent: 11400000,
  structure: "HEAVY_STEEL", ageYears: 18,
  landArea: 640, buildingArea: 720, rosenka: 65000
};
const WEAK = {
  name: "都心区分", price: 48000000, annualRent: 2160000,
  structure: "RC", ageYears: 12,
  landArea: 15, buildingArea: 45, rosenka: 900000
};

describe("積算評価が出せない場合の扱い", () => {
  test("土地単価不明なら積算比率はnullになる（0として扱わない）", () => {
    const known = costApproach({ ...GOOD, price: GOOD.price });
    const unknown = costApproach({ ...GOOD, rosenka: undefined, price: GOOD.price });
    assert.equal(known.landKnown, true);
    assert.ok(known.ratioToPrice > 0);
    assert.equal(unknown.landKnown, false);
    assert.equal(unknown.ratioToPrice, null);
  });

  test("積算不明でも足切りされず、警告として報告される", () => {
    const a = analyze({ ...GOOD, rosenka: undefined });
    const s = scoreRental(a);
    assert.ok(!s.reasons.some(r => r.includes("積算比率")), "積算を理由に落としてはいけない");
    assert.ok(s.warnings.some(w => w.includes("土地単価")));
    assert.equal(s.parts.costRatio, null);
  });

  test("積算不明でもスコアは残りの軸で正しく再配分される", () => {
    const withLand = scoreRental(analyze(GOOD));
    const withoutLand = scoreRental(analyze({ ...GOOD, rosenka: undefined }));
    // 情報が欠けただけで極端に低いスコアにならないこと
    assert.ok(withoutLand.score > withLand.score * 0.7,
      `情報欠落でスコアが不当に下がっている: ${withLand.score} → ${withoutLand.score}`);
    // 再配分後の重みの合計は1.0なので、満点が120を超えることはない
    assert.ok(withoutLand.score <= 150);
  });
});

describe("賃貸保有としての判定", () => {
  test("優良物件は基準を通過する", () => {
    const s = scoreRental(analyze(GOOD));
    assert.equal(s.passed, true, s.reasons.join(" / "));
    assert.ok(s.score > 60);
  });

  test("低利回り物件は理由付きで落ちる", () => {
    const s = scoreRental(analyze(WEAK));
    assert.equal(s.passed, false);
    assert.ok(s.reasons.length > 0);
    assert.ok(s.reasons.some(r => r.includes("表面利回り")));
  });

  test("DSCR不足は明示的に落とす", () => {
    const a = analyze({ ...GOOD, annualRent: 7000000 }, { ltv: 1.0, loanRate: 0.04 });
    const s = scoreRental(a);
    assert.equal(s.passed, false);
    assert.ok(s.reasons.some(r => r.includes("DSCR") || r.includes("返済比率")));
  });

  test("基準は呼び出し側で差し替えられる", () => {
    const strict = {
      ...DEFAULT_CRITERIA.rental,
      knockout: { ...DEFAULT_CRITERIA.rental.knockout, minGrossYield: 0.20 }
    };
    assert.equal(scoreRental(analyze(GOOD), strict).passed, false);
  });
});

describe("販売用としての判定", () => {
  test("積算より十分安く買える物件は転売候補になる", () => {
    // 積算1.4倍相当まで割安な物件を作る
    const cheap = { ...GOOD, price: 55000000 };
    const s = scoreResale(analyze(cheap));
    assert.ok(s.highlights.想定売値 > 0);
    assert.ok(s.highlights.想定利益 > 0);
  });

  test("改修費を入れると利益が減る", () => {
    const a = analyze({ ...GOOD, price: 55000000 });
    const noReno = scoreResale(a, DEFAULT_CRITERIA.resale, { renovationCost: 0 });
    const withReno = scoreResale(a, DEFAULT_CRITERIA.resale, { renovationCost: 8000000 });
    assert.ok(withReno.highlights.想定利益 < noReno.highlights.想定利益);
    assert.ok(withReno.highlights.利益率 < noReno.highlights.利益率);
    // 上位物件どうしでも序列が保たれること（上限で頭打ちにしない）
    assert.ok(withReno.score < noReno.score,
      `改修費を積んだのにスコアが変わらない: ${noReno.score} → ${withReno.score}`);
  });

  test("売値が仕入値を下回る物件は落ちる", () => {
    const s = scoreResale(analyze(WEAK));
    assert.equal(s.passed, false);
  });
});

describe("総合判定", () => {
  test("両方の目的で評価し、向いている方を返す", () => {
    const e = evaluate(analyze(GOOD));
    assert.ok(["rental", "resale", null].includes(e.recommended));
    assert.ok(e.rental && e.resale);
  });

  test("どちらの基準も満たさなければrecommendedはnull", () => {
    const e = evaluate(analyze(WEAK));
    assert.equal(e.recommended, null);
  });
});
