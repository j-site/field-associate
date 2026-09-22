/* ============================================================
 *  物件情報のテキスト抽出
 *
 *  楽待・健美家・業者からの新着メールは書式がバラバラなので、
 *  「1つのフォーマットを正確に解く」のではなく
 *  「日本語の不動産表記によくある言い回しを広く拾う」方針で実装する。
 *
 *  抽出できなかった項目は null のまま返し、欠損は呼び出し側で判断する。
 *  勝手に推測で埋めると、誤った数字で投資判断してしまうため。
 * ============================================================ */

/** 全角数字・カンマ・空白を正規化する */
export function normalize(text) {
  return String(text || "")
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[，､]/g, ",")
    .replace(/[（）]/g, m => (m === "（" ? "(" : ")"))
    .replace(/　/g, " ");
}

/** 「1億2,500万円」「3980万円」「45,000,000円」などを円に変換する */
export function parseYen(text) {
  if (text == null) return null;
  const s = normalize(text).replace(/,/g, "");

  const oku = s.match(/(\d+(?:\.\d+)?)\s*億/);
  const man = s.match(/(\d+(?:\.\d+)?)\s*万/);
  if (oku || man) {
    let total = 0;
    if (oku) total += parseFloat(oku[1]) * 100000000;
    if (man) total += parseFloat(man[1]) * 10000;
    return Math.round(total);
  }
  const yen = s.match(/(\d{4,})\s*円/);
  if (yen) return parseInt(yen[1], 10);
  return null;
}

/** 「123.45㎡」「123.45m2」「37.3坪」を㎡に変換する */
export function parseArea(text) {
  if (text == null) return null;
  const s = normalize(text).replace(/,/g, "");
  const sqm = s.match(/(\d+(?:\.\d+)?)\s*(?:㎡|m2|m²|平米|平方メートル)/i);
  if (sqm) return parseFloat(sqm[1]);
  const tsubo = s.match(/(\d+(?:\.\d+)?)\s*坪/);
  if (tsubo) return Math.round(parseFloat(tsubo[1]) * 3.30578 * 100) / 100;
  return null;
}

/** 表記ゆれを構造コードに寄せる。判定できなければ null */
export function parseStructure(text) {
  const s = normalize(text);
  if (/鉄骨鉄筋|ＳＲＣ|SRC/i.test(s)) return "SRC";
  if (/鉄筋コンクリート|ＲＣ|RC/i.test(s)) return "RC";
  if (/軽量鉄骨/.test(s)) return "LIGHT_STEEL";
  if (/重量鉄骨/.test(s)) return "HEAVY_STEEL";
  if (/鉄骨|Ｓ造|S造/.test(s)) return "HEAVY_STEEL";
  if (/木骨モルタル/.test(s)) return "LIGHT_WOOD";
  if (/木造|Ｗ造|W造/.test(s)) return "WOOD";
  return null;
}

/**
 * 築年数。「築23年」のほか「1998年5月築」「平成10年築」からも算出する。
 * asOf を渡すとその時点での築年数になる（過去メールの再解析用）。
 */
export function parseAge(text, asOf = new Date(), { assumeDate = false } = {}) {
  const s = normalize(text);
  const direct = s.match(/築\s*(\d+)\s*年/);
  if (direct) return parseInt(direct[1], 10);
  if (/新築/.test(s)) return 0;

  // 「築年月」欄の値のように、文脈上すでに建築時期だと分かっている場合は
  // 「築」の接尾辞が無い日付表記（1998年3月）も受け付ける
  const suffix = assumeDate ? "(?:\\s*(?:築|新築|建築))?" : "\\s*(?:築|新築|建築)";

  const western = s.match(new RegExp(`(\\d{4})\\s*年(?:\\s*(\\d{1,2})\\s*月)?${suffix}`));
  if (western) {
    const y = parseInt(western[1], 10);
    const m = western[2] ? parseInt(western[2], 10) : 1;
    return yearsBetween(new Date(y, m - 1, 1), asOf);
  }
  const era = s.match(new RegExp(`(昭和|平成|令和)\\s*(\\d+|元)\\s*年(?:\\s*(\\d{1,2})\\s*月)?${suffix}`));
  if (era) {
    const base = { 昭和: 1925, 平成: 1988, 令和: 2018 }[era[1]];
    const n = era[2] === "元" ? 1 : parseInt(era[2], 10);
    const m = era[3] ? parseInt(era[3], 10) : 1;
    return yearsBetween(new Date(base + n, m - 1, 1), asOf);
  }
  return null;
}
function yearsBetween(from, to) {
  let years = to.getFullYear() - from.getFullYear();
  const anniversary = new Date(to.getFullYear(), from.getMonth(), from.getDate());
  if (to < anniversary) years--;
  return Math.max(0, years);
}

/** 「利回り8.52%」「表面利回り：10.2％」 */
export function parseYieldRate(text) {
  const s = normalize(text);
  const m = s.match(/利回り[^\d%％]{0,6}(\d+(?:\.\d+)?)\s*[%％]/);
  return m ? parseFloat(m[1]) / 100 : null;
}

const FIELD_PATTERNS = [
  { key: "name", labels: ["物件名", "建物名", "マンション名"], parse: v => normalize(v).trim() || null },
  { key: "price", labels: ["価格", "販売価格", "売出価格", "物件価格"], parse: parseYen },
  { key: "annualRent", labels: ["年間賃料", "満室時年収", "想定年収", "年収", "満室想定年収", "年間収入"], parse: parseYen },
  { key: "monthlyRent", labels: ["月額賃料", "月額収入", "月収", "現況賃料"], parse: parseYen },
  { key: "landArea", labels: ["土地面積", "敷地面積", "土地"], parse: parseArea },
  { key: "buildingArea", labels: ["建物面積", "延床面積", "建物", "専有面積"], parse: parseArea },
  { key: "address", labels: ["所在地", "住所", "所在"], parse: v => normalize(v).trim() || null },
  { key: "station", labels: ["交通", "最寄駅", "アクセス"], parse: v => normalize(v).trim() || null },
  { key: "structureRaw", labels: ["構造", "建物構造"], parse: v => normalize(v).trim() || null },
  { key: "builtRaw", labels: ["築年月", "建築年月", "築年数", "竣工"], parse: v => normalize(v).trim() || null }
];

/**
 * ラベル付きテキスト（「価格：3,980万円」形式）から物件情報を抜き出す。
 * メール・スクリーンショットのOCR・手打ちメモ、いずれにも同じ関数を使う。
 */
export function parseListing(rawText, { asOf = new Date() } = {}) {
  const text = normalize(rawText);
  const out = { raw: rawText };

  for (const field of FIELD_PATTERNS) {
    for (const label of field.labels) {
      // 「価格： 3,980万円」「価格 3980万円」「【価格】3,980万円」いずれも拾う
      const re = new RegExp(`${label}\\s*[:：]?\\s*([^\\n\\r]{1,60})`);
      const m = text.match(re);
      if (!m) continue;
      const value = field.parse(m[1]);
      if (value != null && out[field.key] == null) {
        out[field.key] = value;
        break;
      }
    }
  }

  // 年間賃料が無くても月額が取れていれば12倍で補える（これは推測ではなく定義）
  if (out.annualRent == null && out.monthlyRent != null) {
    out.annualRent = out.monthlyRent * 12;
    out.annualRentDerived = true;
  }

  out.structure = parseStructure(out.structureRaw ?? text);
  out.ageYears = out.builtRaw != null
    ? parseAge(out.builtRaw, asOf, { assumeDate: true }) ?? parseAge(text, asOf)
    : parseAge(text, asOf);
  out.listedYield = parseYieldRate(text);

  // 掲載利回りから年間賃料を逆算できる場合がある（賃料表記が無いメール向け）
  if (out.annualRent == null && out.listedYield != null && out.price != null) {
    out.annualRent = Math.round(out.price * out.listedYield);
    out.annualRentDerived = true;
  }

  out.url = (rawText.match(/https?:\/\/[^\s<>"']+/) || [null])[0];
  out.missing = requiredFields().filter(k => out[k] == null);
  out.usable = out.missing.length === 0;
  return out;
}

/** 分析に最低限必要な項目 */
export function requiredFields() {
  return ["price", "annualRent", "structure", "ageYears"];
}
