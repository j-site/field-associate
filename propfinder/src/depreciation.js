/* ============================================================
 *  減価償却
 *
 *  中古資産の耐用年数は「簡便法」で求める。
 *  税率・耐用年数は制度変更があり得るため、判断は必ず税理士に確認すること。
 * ============================================================ */

/** 構造ごとの法定耐用年数（住宅用・年） */
export const LEGAL_USEFUL_LIFE = {
  RC: 47,        // 鉄筋コンクリート造
  SRC: 47,       // 鉄骨鉄筋コンクリート造
  HEAVY_STEEL: 34, // 重量鉄骨造（骨格材の肉厚4mm超）
  LIGHT_STEEL: 27, // 軽量鉄骨造（肉厚3mm超4mm以下）
  LIGHT_STEEL_THIN: 19, // 軽量鉄骨造（肉厚3mm以下）
  WOOD: 22,      // 木造・合成樹脂造
  LIGHT_WOOD: 20 // 木骨モルタル造
};

export const STRUCTURE_LABEL = {
  RC: "RC造", SRC: "SRC造", HEAVY_STEEL: "重量鉄骨造",
  LIGHT_STEEL: "軽量鉄骨造", LIGHT_STEEL_THIN: "軽量鉄骨造(薄)",
  WOOD: "木造", LIGHT_WOOD: "木骨モルタル造"
};

/**
 * 中古資産の耐用年数（簡便法）
 *   法定耐用年数をすべて経過： 法定耐用年数 × 0.2
 *   一部経過：             (法定耐用年数 - 経過年数) + 経過年数 × 0.2
 *   いずれも1年未満は切り捨て、2年未満となる場合は2年
 */
export function usedUsefulLife(structure, ageYears) {
  const legal = LEGAL_USEFUL_LIFE[structure];
  if (!legal) throw new Error(`未知の構造: ${structure}`);
  const age = Math.max(0, ageYears);
  const raw = age >= legal
    ? legal * 0.2
    : (legal - age) + age * 0.2;
  return Math.max(2, Math.floor(raw));
}

/**
 * 定額法の償却率。国税庁の償却率表に合わせ、1/耐用年数を小数第3位に切り上げる。
 * 例: 22年 → 0.046、47年 → 0.022、34年 → 0.030
 */
export function straightLineRate(usefulLife) {
  return Math.ceil(1000 / usefulLife) / 1000;
}

/**
 * 建物（＋設備）の年間減価償却費。
 * 土地は減価償却の対象外なので、必ず建物価格だけを渡すこと。
 */
export function annualDepreciation({ buildingPrice, structure, ageYears }) {
  const life = usedUsefulLife(structure, ageYears);
  const rate = straightLineRate(life);
  return {
    usefulLife: life,
    rate,
    annual: Math.round(buildingPrice * rate)
  };
}

/**
 * 保有n年目までの累計償却額と簿価。
 * 償却は耐用年数で終わり、備忘価額1円は無視できる誤差として扱わない（簿価下限0円）。
 */
export function depreciationSchedule({ buildingPrice, structure, ageYears, holdYears }) {
  const { usefulLife, rate, annual } = annualDepreciation({ buildingPrice, structure, ageYears });
  const years = [];
  let accumulated = 0;
  for (let y = 1; y <= holdYears; y++) {
    const amount = y <= usefulLife ? Math.min(annual, buildingPrice - accumulated) : 0;
    accumulated += amount;
    years.push({ year: y, amount, accumulated, bookValue: buildingPrice - accumulated });
  }
  return { usefulLife, rate, annual, years, accumulated, bookValue: buildingPrice - accumulated };
}
