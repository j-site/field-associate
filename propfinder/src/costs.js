/* ============================================================
 *  購入諸費用・運営費用
 *
 *  税率や軽減措置は改正されるため、すべて設定で上書きできるようにしてある。
 *  既定値はあくまで概算用の目安。実際の判断は税理士・金融機関に確認すること。
 * ============================================================ */

export const DEFAULT_RATES = {
  // --- 購入時 ---
  brokerageIncluded: true,      // 仲介手数料を見込むか（売主物件ならfalse）
  brokerageTaxRate: 0.10,       // 消費税
  registrationLandRate: 0.020,  // 登録免許税（土地・所有権移転）
  registrationBuildingRate: 0.020, // 登録免許税（建物・所有権移転）
  acquisitionTaxLandRate: 0.03, // 不動産取得税（土地）
  acquisitionTaxBuildingRate: 0.04, // 不動産取得税（家屋・住宅以外）
  acquisitionTaxLandHalved: true,   // 宅地の課税標準1/2特例
  judicialScrivenerFee: 150000, // 司法書士報酬
  loanFeeRate: 0.022,           // 融資事務手数料（借入額に対して）
  loanStampFee: 20000,          // 金銭消費貸借契約の印紙
  fireInsuranceRate: 0.003,     // 火災保険料（建物価格に対する概算・保険期間分）
  miscBuffer: 0.005,            // その他予備費（物件価格に対して）

  // --- 評価額の仮定（実額が分かれば property 側で上書きする） ---
  landAssessmentRatio: 0.70,    // 固定資産税評価額 ÷ 実勢価格（土地）
  buildingAssessmentRatio: 0.60,// 固定資産税評価額 ÷ 実勢価格（建物）

  // --- 保有時 ---
  propertyTaxRate: 0.014,       // 固定資産税
  cityPlanningTaxRate: 0.003,   // 都市計画税
  managementFeeRate: 0.05,      // 管理委託料（実効賃料に対して）
  repairReserveRate: 0.05,      // 修繕費積立（実効賃料に対して）
  vacancyRate: 0.10,            // 空室・滞納損失率
  otherOpexRate: 0.02,          // 原状回復・募集費・共用光熱費など

  // --- 売却時 ---
  saleBrokerageRate: 0.03,      // 仲介手数料（+6万円）
  saleMiscRate: 0.005           // 測量・印紙などその他
};

/** 宅建業法の上限（売買価格400万円超）: 価格×3% + 6万円、これに消費税 */
export function brokerageFee(price, taxRate = 0.10) {
  let base;
  if (price <= 2000000) base = price * 0.05;
  else if (price <= 4000000) base = price * 0.04 + 20000;
  else base = price * 0.03 + 60000;
  return Math.round(base * (1 + taxRate));
}

/** 不動産売買契約書の印紙税（軽減税率・令和9年3月31日まで想定） */
export function stampDuty(price) {
  if (price <= 500000) return 200;
  if (price <= 1000000) return 500;
  if (price <= 5000000) return 1000;
  if (price <= 10000000) return 5000;
  if (price <= 50000000) return 10000;
  if (price <= 100000000) return 30000;
  if (price <= 500000000) return 60000;
  return 160000;
}

/**
 * 購入諸費用の内訳。
 * landPrice / buildingPrice は売買価格の内訳（未指定なら按分で推定する）。
 */
export function acquisitionCosts(property, rates = {}) {
  const R = { ...DEFAULT_RATES, ...rates };
  const { price, landPrice, buildingPrice, loanAmount = 0 } = property;

  const landAssessed = property.landAssessedValue ?? landPrice * R.landAssessmentRatio;
  const buildingAssessed = property.buildingAssessedValue ?? buildingPrice * R.buildingAssessmentRatio;

  const brokerage = R.brokerageIncluded ? brokerageFee(price, R.brokerageTaxRate) : 0;
  const stamp = stampDuty(price);
  const registrationLand = Math.round(landAssessed * R.registrationLandRate);
  const registrationBuilding = Math.round(buildingAssessed * R.registrationBuildingRate);
  const acquisitionTaxLand = Math.round(
    landAssessed * (R.acquisitionTaxLandHalved ? 0.5 : 1) * R.acquisitionTaxLandRate
  );
  const acquisitionTaxBuilding = Math.round(buildingAssessed * R.acquisitionTaxBuildingRate);
  const loanFee = Math.round(loanAmount * R.loanFeeRate) + (loanAmount > 0 ? R.loanStampFee : 0);
  const fireInsurance = Math.round(buildingPrice * R.fireInsuranceRate);
  const misc = Math.round(price * R.miscBuffer);

  const breakdown = {
    仲介手数料: brokerage,
    印紙税: stamp,
    登録免許税_土地: registrationLand,
    登録免許税_建物: registrationBuilding,
    司法書士報酬: R.judicialScrivenerFee,
    不動産取得税_土地: acquisitionTaxLand,
    不動産取得税_建物: acquisitionTaxBuilding,
    融資事務手数料等: loanFee,
    火災保険料: fireInsurance,
    予備費: misc
  };
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { breakdown, total, ratio: total / price };
}

/** 固定資産税・都市計画税（年額の概算） */
export function annualPropertyTax(property, rates = {}) {
  const R = { ...DEFAULT_RATES, ...rates };
  const landAssessed = property.landAssessedValue ?? property.landPrice * R.landAssessmentRatio;
  const buildingAssessed = property.buildingAssessedValue ?? property.buildingPrice * R.buildingAssessmentRatio;
  const assessed = landAssessed + buildingAssessed;
  return Math.round(assessed * (R.propertyTaxRate + R.cityPlanningTaxRate));
}

/**
 * 年間運営費用（Opex）。
 * NOIの定義上、ローン返済と減価償却はここに含めない。
 */
export function annualOperatingExpenses(property, rates = {}) {
  const R = { ...DEFAULT_RATES, ...rates };
  const grossRent = property.annualRent;
  const effectiveRent = grossRent * (1 - (property.vacancyRate ?? R.vacancyRate));

  const management = property.managementFee ?? Math.round(effectiveRent * R.managementFeeRate);
  const repair = property.repairReserve ?? Math.round(effectiveRent * R.repairReserveRate);
  const other = property.otherOpex ?? Math.round(effectiveRent * R.otherOpexRate);
  const tax = annualPropertyTax(property, rates);

  const breakdown = {
    管理委託料: management,
    修繕費: repair,
    固定資産税都市計画税: tax,
    その他運営費: other
  };
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { grossRent, effectiveRent: Math.round(effectiveRent), breakdown, total };
}

/** 売却諸費用 */
export function saleCosts(salePrice, rates = {}) {
  const R = { ...DEFAULT_RATES, ...rates };
  const brokerage = brokerageFee(salePrice, R.brokerageTaxRate);
  const misc = Math.round(salePrice * R.saleMiscRate) + stampDuty(salePrice);
  return { brokerage, misc, total: brokerage + misc };
}

/**
 * 売買価格の土地・建物按分。
 * 実務では契約書の記載や固定資産税評価額比で按分する。
 * 指定がなければ固定資産税評価額の比率で按分し、それも無ければ構造別の概算比率を使う。
 */
export function splitLandBuilding(property, rates = {}) {
  const R = { ...DEFAULT_RATES, ...rates };
  if (property.landPrice != null && property.buildingPrice != null) {
    return { landPrice: property.landPrice, buildingPrice: property.buildingPrice, method: "指定値" };
  }
  if (property.landAssessedValue != null && property.buildingAssessedValue != null) {
    const sum = property.landAssessedValue + property.buildingAssessedValue;
    const bRatio = sum > 0 ? property.buildingAssessedValue / sum : 0.5;
    return {
      landPrice: Math.round(property.price * (1 - bRatio)),
      buildingPrice: Math.round(property.price * bRatio),
      method: "固定資産税評価額比で按分"
    };
  }
  // 最後の手段：建物比率の概算（築古ほど建物価値は小さい）
  const ratio = property.buildingRatio ?? 0.4;
  return {
    landPrice: Math.round(property.price * (1 - ratio)),
    buildingPrice: Math.round(property.price * ratio),
    method: `建物比率${Math.round(ratio * 100)}%と仮定`
  };
}
