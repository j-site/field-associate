import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseYen, parseArea, parseStructure, parseAge, parseYieldRate, parseListing
} from "../src/parse/listing.js";

const ASOF = new Date(2026, 8, 22); // 2026-09-22 固定で判定する

describe("金額の解析", () => {
  test("万・億・円のいずれの表記も円に揃う", () => {
    assert.equal(parseYen("3,980万円"), 39800000);
    assert.equal(parseYen("3980万円"), 39800000);
    assert.equal(parseYen("1億2,500万円"), 125000000);
    assert.equal(parseYen("2億円"), 200000000);
    assert.equal(parseYen("45,000,000円"), 45000000);
    assert.equal(parseYen("１億５０００万円"), 150000000); // 全角
    assert.equal(parseYen("1.2億円"), 120000000);
  });
  test("金額でない文字列はnull（0や誤値を返さない）", () => {
    assert.equal(parseYen("応談"), null);
    assert.equal(parseYen(""), null);
    assert.equal(parseYen(null), null);
  });
});

describe("面積の解析", () => {
  test("㎡・坪の両方に対応する", () => {
    assert.equal(parseArea("123.45㎡"), 123.45);
    assert.equal(parseArea("123.45m2"), 123.45);
    assert.equal(parseArea("1,234.5平米"), 1234.5);
    assert.equal(parseArea("30坪"), 99.17);
  });
  test("面積でなければnull", () => {
    assert.equal(parseArea("不明"), null);
  });
});

describe("構造の判定", () => {
  test("表記ゆれを吸収する", () => {
    assert.equal(parseStructure("鉄筋コンクリート造"), "RC");
    assert.equal(parseStructure("RC造5階建"), "RC");
    assert.equal(parseStructure("鉄骨鉄筋コンクリート造"), "SRC");
    assert.equal(parseStructure("木造2階建"), "WOOD");
    assert.equal(parseStructure("軽量鉄骨造"), "LIGHT_STEEL");
    assert.equal(parseStructure("重量鉄骨造"), "HEAVY_STEEL");
  });
  test("SRCをRCと誤判定しない（順序依存のバグ防止）", () => {
    assert.equal(parseStructure("ＳＲＣ造"), "SRC");
    assert.notEqual(parseStructure("鉄骨鉄筋コンクリート"), "RC");
  });
  test("判定できなければnull", () => {
    assert.equal(parseStructure("その他"), null);
  });
});

describe("築年数の解析", () => {
  test("「築N年」をそのまま読む", () => {
    assert.equal(parseAge("築23年", ASOF), 23);
    assert.equal(parseAge("新築", ASOF), 0);
  });
  test("西暦の築年月から算出する", () => {
    assert.equal(parseAge("2000年5月築", ASOF), 26);
    assert.equal(parseAge("2026年10月築", ASOF), 0); // 未来日付でも負にしない
  });
  test("和暦から算出する", () => {
    assert.equal(parseAge("平成10年3月築", ASOF), 28); // 1998年3月 → 28年
    assert.equal(parseAge("昭和56年6月築", ASOF), 45); // 1981年6月（旧耐震の境目）
    assert.equal(parseAge("令和元年4月築", ASOF), 7);  // 2019年4月
  });
  test("読めなければnull", () => {
    assert.equal(parseAge("築年不詳", ASOF), null);
  });
});

describe("利回り表記", () => {
  test("全角％・ラベル違いを拾う", () => {
    assert.equal(parseYieldRate("表面利回り：10.2％"), 0.102);
    assert.equal(parseYieldRate("利回り 8.52%"), 0.0852);
    assert.equal(parseYieldRate("想定利回り8%"), 0.08);
  });
});

describe("物件メールの解析", () => {
  test("典型的な収益物件メールから一式を抽出できる", () => {
    const mail = `
【新着物件のお知らせ】

物件名：サンプルマンション
所在地：千葉県船橋市本町1-2-3
交通：JR総武線「船橋」駅 徒歩8分
価格：5,980万円
満室時年収：648万円
表面利回り：10.83%
土地面積：210.55㎡
建物面積：380.20㎡
構造：鉄筋コンクリート造
築年月：1998年3月
https://example.com/bukken/12345
`;
    const p = parseListing(mail, { asOf: ASOF });
    assert.equal(p.price, 59800000);
    assert.equal(p.annualRent, 6480000);
    assert.equal(p.landArea, 210.55);
    assert.equal(p.buildingArea, 380.20);
    assert.equal(p.structure, "RC");
    assert.equal(p.ageYears, 28);
    assert.ok(Math.abs(p.listedYield - 0.1083) < 1e-9);
    assert.equal(p.address, "千葉県船橋市本町1-2-3");
    assert.equal(p.url, "https://example.com/bukken/12345");
    assert.equal(p.usable, true);
    assert.deepEqual(p.missing, []);
  });

  test("月額賃料しかない場合は12倍して年額にする", () => {
    const mail = `価格：2,480万円\n月額賃料：18万円\n構造：木造\n築15年`;
    const p = parseListing(mail, { asOf: ASOF });
    assert.equal(p.annualRent, 2160000);
    assert.equal(p.annualRentDerived, true);
    assert.equal(p.usable, true);
  });

  test("賃料表記が無くても掲載利回りから逆算する", () => {
    const mail = `価格：1億2,000万円\n利回り：9.5%\n構造：RC造\n築20年`;
    const p = parseListing(mail, { asOf: ASOF });
    assert.equal(p.price, 120000000);
    assert.equal(p.annualRent, 11400000);
    assert.equal(p.annualRentDerived, true);
  });

  test("欠損は推測で埋めず、missingとして報告する", () => {
    const mail = `価格：3,000万円\n所在地：東京都八王子市`;
    const p = parseListing(mail, { asOf: ASOF });
    assert.equal(p.usable, false);
    assert.ok(p.missing.includes("annualRent"));
    assert.ok(p.missing.includes("structure"));
    assert.ok(p.missing.includes("ageYears"));
    assert.equal(p.annualRent, undefined);
  });

  test("関係のない文面から価格を誤検出しない", () => {
    const mail = `いつもお世話になっております。\n来週の内見の件、よろしくお願いいたします。`;
    const p = parseListing(mail, { asOf: ASOF });
    assert.equal(p.usable, false);
    assert.equal(p.price, undefined);
  });
});
