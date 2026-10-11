/* 全ページ共通：設定の読み込み、Supabase接続、表示用ラベル、小道具 */
(function (global) {
  "use strict";

  var CFG = global.SATEI_CONFIG || {};

  var LABELS = {
    property_type: {
      mansion: "区分マンション", house: "一戸建て", land: "土地",
      apartment: "一棟アパート・マンション", other: "その他"
    },
    current_status: { living: "居住中", vacant: "空き家", rented: "賃貸中", other: "その他" },
    sale_timing: {
      asap: "すぐにでも", "3m": "3ヶ月以内", "6m": "半年以内",
      "1y": "1年以内", undecided: "未定（まず価格を知りたい）"
    },
    contact_method: { phone: "電話", email: "メール", either: "どちらでも" },
    lead_status: { open: "受付中", closed: "受付終了", withdrawn: "取り下げ" }
  };

  var PREFECTURES = [
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
    "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
    "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
    "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
    "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
    "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"
  ];

  var client = null;
  function db() {
    if (client) return client;
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) return null;
    client = global.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    return client;
  }

  /** RPCを呼び、エラーは日本語メッセージ付きの例外にして投げる */
  async function rpc(fn, args) {
    var c = db();
    if (!c) throw new Error("サイトの接続設定が完了していません（config.js）");
    var res = await c.rpc(fn, args || {});
    if (res.error) {
      var msg = res.error.message || "通信に失敗しました";
      if (/permission denied/i.test(msg)) msg = "この操作を行う権限がありません";
      if (/Failed to fetch|NetworkError/i.test(msg)) msg = "通信に失敗しました。時間をおいて再度お試しください";
      throw new Error(msg);
    }
    return res.data;
  }

  function label(group, key) { return (LABELS[group] && LABELS[group][key]) || key || "—"; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "/" + p(d.getMonth() + 1) + "/" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  var toastTimer = null;
  function toast(msg, isErr) {
    var el = document.getElementById("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.toggle("err", !!isErr);
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("on"); }, 3500);
  }

  /** data-site / data-op 属性に設定値を差し込む（未設定は目立つ表示にする） */
  function fillConfig() {
    document.querySelectorAll("[data-site]").forEach(function (el) { el.textContent = CFG.SITE_NAME || "不動産かんたん査定"; });
    document.querySelectorAll("[data-op]").forEach(function (el) {
      var v = (CFG.OPERATOR || {})[el.getAttribute("data-op")];
      el.textContent = v || "【未設定】";
      if (!v) el.style.color = "#c53030";
    });
    if (db()) {
      // 「最大◯社」の表示は運営設定（提供する最大社数）に合わせる
      rpc("get_public_settings").then(function (s) {
        if (s && s.max_buyers) document.querySelectorAll(".max-buyers").forEach(function (el) {
          el.textContent = el.textContent.replace(/\d+/, s.max_buyers);
        });
      }).catch(function () {});
    } else {
      var bar = document.createElement("div");
      bar.className = "notice warn";
      bar.style.cssText = "margin:0;border-radius:0;text-align:center";
      bar.textContent = "このサイトはまだデータベースに接続されていません（config.js を設定してください）。送信などの操作はできません。";
      document.body.insertBefore(bar, document.body.firstChild);
    }
  }

  function prefectureOptions(selected) {
    return PREFECTURES.map(function (p) {
      return '<option value="' + p + '"' + (p === selected ? " selected" : "") + ">" + p + "</option>";
    }).join("");
  }

  /** 物件情報を1行の説明にする（購入前プレビュー／購入後どちらにも使う） */
  function propertySummary(l) {
    var parts = [label("property_type", l.property_type)];
    var area = l.building_area ? "建物" + l.building_area + "㎡" : (l.building_area_band ? "建物" + l.building_area_band : "");
    var land = l.land_area ? "土地" + l.land_area + "㎡" : (l.land_area_band ? "土地" + l.land_area_band : "");
    if (land) parts.push(land);
    if (area) parts.push(area);
    if (l.layout) parts.push(l.layout);
    if (l.built_year) parts.push(l.built_year + "年築");
    else if (l.built_decade) parts.push(l.built_decade + "築");
    return parts.join(" / ");
  }

  document.addEventListener("DOMContentLoaded", fillConfig);

  global.Satei = {
    CFG: CFG, LABELS: LABELS, PREFECTURES: PREFECTURES,
    db: db, rpc: rpc, label: label, esc: esc, fmtDate: fmtDate, toast: toast,
    prefectureOptions: prefectureOptions, propertySummary: propertySummary
  };
})(window);
