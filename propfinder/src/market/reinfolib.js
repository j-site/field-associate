/* ============================================================
 *  国土交通省「不動産情報ライブラリ」API クライアント
 *
 *  https://www.reinfolib.mlit.go.jp/
 *  利用にはAPIキー（無料・申請制）が必要。環境変数 REINFOLIB_API_KEY に入れる。
 *
 *  ここで取れるのは「実際に取引された価格」であって売出価格ではない。
 *  売出価格が相場に対して高いのか安いのかを裏取りするために使う。
 * ============================================================ */

const BASE = "https://www.reinfolib.mlit.go.jp/ex-api/external";

export class ReinfolibClient {
  constructor({ apiKey = process.env.REINFOLIB_API_KEY, fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async request(path, params = {}) {
    if (!this.apiKey) throw new Error("REINFOLIB_API_KEY が設定されていません");
    const url = new URL(BASE + path);
    Object.entries(params).forEach(([k, v]) => {
      if (v != null) url.searchParams.set(k, String(v));
    });
    const res = await this.fetchImpl(url.toString(), {
      headers: { "Ocp-Apim-Subscription-Key": this.apiKey }
    });
    if (!res.ok) throw new Error(`不動産情報ライブラリAPI エラー: ${res.status}`);
    const json = await res.json();
    return json.data ?? [];
  }

  /**
   * 不動産取引価格情報を取得する。
   * year: 取引年（必須） / quarter: 四半期 / area: 都道府県コード / city: 市区町村コード
   */
  async tradePrices({ year, quarter, area, city }) {
    const rows = await this.request("/XIT001", {
      year, quarter, area, city,
      priceClassification: "01" // 01 = 不動産取引価格情報
    });
    return rows.map(normalizeTrade).filter(Boolean);
  }
}

/** APIの生データを、こちらの計算で使える形に整える */
export function normalizeTrade(row) {
  const price = toNumber(row.TradePrice);
  if (!price) return null;
  return {
    type: row.Type,                       // 宅地(土地と建物) / 中古マンション等
    region: row.Region,
    city: row.Municipality,
    district: row.DistrictName,
    station: row.NearestStation,
    stationMinutes: toNumber(row.TimeToNearestStation),
    price,
    unitPricePerSqm: toNumber(row.UnitPrice),
    landArea: toNumber(row.Area),
    buildingArea: toNumber(row.TotalFloorArea),
    structure: row.Structure,
    buildYear: row.BuildingYear,
    use: row.Use,
    period: row.Period,
    cityPlanning: row.CityPlanning
  };
}
function toNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * 取引事例から相場の㎡単価を出す。
 * 外れ値に引きずられないよう、平均ではなく中央値を使う。
 */
export function marketUnitPrice(trades, { type = null, minSamples = 5 } = {}) {
  const pool = trades
    .filter(t => (type ? t.type === type : true))
    .map(t => t.unitPricePerSqm ?? (t.landArea > 0 ? t.price / t.landArea : null))
    .filter(v => v != null && v > 0)
    .sort((a, b) => a - b);

  if (pool.length < minSamples) {
    return { median: null, samples: pool.length, reliable: false };
  }
  const mid = Math.floor(pool.length / 2);
  const median = pool.length % 2 ? pool[mid] : (pool[mid - 1] + pool[mid]) / 2;
  return {
    median: Math.round(median),
    samples: pool.length,
    reliable: true,
    p25: Math.round(pool[Math.floor(pool.length * 0.25)]),
    p75: Math.round(pool[Math.floor(pool.length * 0.75)])
  };
}

/**
 * 売出価格が相場と比べて割安か割高かを判定する。
 * 判定できるだけのサンプルが無ければ、無理に判定せず unknown を返す。
 */
export function compareToMarket({ price, landArea, market }) {
  if (!market?.reliable || !landArea) {
    return { verdict: "unknown", reason: "比較できる取引事例が不足" };
  }
  const unit = price / landArea;
  const ratio = unit / market.median;
  const verdict = ratio <= 0.85 ? "割安" : ratio >= 1.15 ? "割高" : "相場並み";
  return {
    verdict,
    ratio,
    listedUnitPrice: Math.round(unit),
    marketMedian: market.median,
    samples: market.samples
  };
}
