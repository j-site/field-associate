/* ============================================================
 *  価格評価
 *    積算価格 … 金融機関の担保評価に近い考え方（土地＋建物の原価）
 *    収益還元価格 … 収益性から見た価格（直接還元法）
 * ============================================================ */

import { LEGAL_USEFUL_LIFE } from "./depreciation.js";

/** 構造別の再調達価格の目安（円/㎡）。金融機関ごとに差があるため設定で上書きする前提 */
export const DEFAULT_REPLACEMENT_COST = {
  RC: 200000,
  SRC: 200000,
  HEAVY_STEEL: 180000,
  LIGHT_STEEL: 150000,
  LIGHT_STEEL_THIN: 150000,
  WOOD: 150000,
  LIGHT_WOOD: 140000
};

/**
 * 積算価格
 *   土地 = 土地単価 × 土地面積
 *   建物 = 再調達価格 × 延床面積 × (法定耐用年数 - 築年数) / 法定耐用年数
 *
 * 土地単価は、相続税路線価が分かればそれを0.8で割って公示価格水準に戻す。
 * 路線価が無ければ landUnitPrice（実勢の㎡単価）をそのまま使う。
 */
export function costApproach(property, opts = {}) {
  const replacement = { ...DEFAULT_REPLACEMENT_COST, ...(opts.replacementCost || {}) };
  const {
    landArea = 0,
    buildingArea = 0,
    structure,
    ageYears = 0,
    rosenka,          // 相続税路線価（円/㎡）
    landUnitPrice     // 実勢の土地単価（円/㎡）
  } = property;

  let unitPrice, landMethod, landKnown = true;
  if (rosenka != null) {
    unitPrice = rosenka / 0.8; // 路線価は公示価格の約80%水準
    landMethod = "路線価÷0.8";
  } else if (landUnitPrice != null) {
    unitPrice = landUnitPrice;
    landMethod = "土地単価指定";
  } else {
    // 土地単価が分からないときに0円として扱うと、積算価格を著しく低く見せてしまう。
    // 「0円」ではなく「不明」として扱い、判定側でこの軸を除外させる。
    unitPrice = 0;
    landMethod = "土地単価不明";
    landKnown = false;
  }
  const landValue = Math.round(unitPrice * landArea);

  const legal = LEGAL_USEFUL_LIFE[structure] ?? 0;
  const remainRatio = legal > 0 ? Math.max(0, (legal - ageYears) / legal) : 0;
  const unitReplacement = replacement[structure] ?? 0;
  const buildingValue = Math.round(unitReplacement * buildingArea * remainRatio);

  const total = landValue + buildingValue;
  return {
    landValue,
    buildingValue,
    total,
    landMethod,
    landKnown,
    remainRatio,
    unitReplacement,
    // 売出価格に対する積算の比率。1.0以上なら「積算が出ている」状態。
    // 土地単価が不明な場合は建物だけの数字になり比較の意味を持たないため null にする。
    ratioToPrice: landKnown && property.price > 0 ? total / property.price : null
  };
}

/**
 * 収益還元価格（直接還元法）
 *   価格 = NOI ÷ 還元利回り
 * 還元利回りはエリア・構造・築年で変わるため、必ず地域の相場から与える。
 */
export function incomeApproach({ noi, capRate }) {
  if (!capRate || capRate <= 0) return { value: null, capRate };
  return { value: Math.round(noi / capRate), capRate };
}

/**
 * 積算と収益還元の両面から見た「適正価格レンジ」と、売出価格の位置づけ。
 */
export function priceOpinion({ price, costValue, incomeValue }) {
  const candidates = [costValue, incomeValue].filter(v => v != null && v > 0);
  if (!candidates.length) return null;
  const low = Math.min(...candidates);
  const high = Math.max(...candidates);
  return {
    low,
    high,
    // 負なら「レンジ下限より安い＝割安」、正なら「レンジ上限より高い＝割高」
    premiumOverHigh: price > high ? (price - high) / high : 0,
    discountUnderLow: price < low ? (low - price) / low : 0
  };
}
