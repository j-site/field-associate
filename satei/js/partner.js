/* 不動産会社さま専用ページ */
(function () {
  "use strict";
  var S = window.Satei;
  var me = null;
  var purchased = [];
  var authMode = "login";

  function view(name) {
    ["auth", "register", "pending", "dashboard"].forEach(function (v) {
      document.getElementById("view-" + v).hidden = v !== name;
    });
  }

  /* ---------------- ログイン ---------------- */
  document.querySelectorAll("[data-auth-tab]").forEach(function (b) {
    b.addEventListener("click", function () {
      authMode = b.getAttribute("data-auth-tab");
      document.querySelectorAll("[data-auth-tab]").forEach(function (x) {
        x.setAttribute("aria-selected", x === b ? "true" : "false");
      });
      document.getElementById("auth-submit").textContent = authMode === "login" ? "ログイン" : "登録する";
      document.getElementById("pw-hint").hidden = authMode === "login";
      document.getElementById("auth-password").autocomplete = authMode === "login" ? "current-password" : "new-password";
    });
  });

  document.getElementById("auth-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var email = document.getElementById("auth-email").value.trim();
    var password = document.getElementById("auth-password").value;
    var errBox = document.getElementById("auth-error");
    errBox.hidden = true;
    if (!email || password.length < 8) {
      errBox.textContent = "メールアドレスと8文字以上のパスワードを入力してください";
      errBox.hidden = false;
      return;
    }
    var c = S.db();
    if (!c) { errBox.textContent = "サイトの接続設定が完了していません"; errBox.hidden = false; return; }
    var res = authMode === "login"
      ? await c.auth.signInWithPassword({ email: email, password: password })
      : await c.auth.signUp({ email: email, password: password });
    if (res.error) {
      errBox.textContent = /Invalid login/i.test(res.error.message)
        ? "メールアドレスかパスワードが違います" : res.error.message;
      errBox.hidden = false;
      return;
    }
    if (authMode === "signup" && !res.data.session) {
      errBox.className = "notice ok";
      errBox.textContent = "確認メールを送信しました。メール内のリンクを開いてから、ログインしてください。";
      errBox.hidden = false;
      return;
    }
    await load();
  });

  document.getElementById("logout").addEventListener("click", async function () {
    await S.db().auth.signOut();
    me = null;
    document.getElementById("who").textContent = "";
    document.getElementById("logout").hidden = true;
    view("auth");
  });

  /* ---------------- 会社登録 ---------------- */
  document.getElementById("r-areas").innerHTML = S.PREFECTURES.map(function (p) {
    return '<label class="choice"><input type="checkbox" value="' + p + '"><span>' + p + "</span></label>";
  }).join("");

  function fillRegister(p) {
    document.getElementById("r-company").value = (p && p.company_name) || "";
    document.getElementById("r-license").value = (p && p.license_no) || "";
    document.getElementById("r-rep").value = (p && p.representative) || "";
    document.getElementById("r-phone").value = (p && p.phone) || "";
    var areas = (p && p.areas) || [];
    document.querySelectorAll("#r-areas input").forEach(function (i) { i.checked = areas.indexOf(i.value) >= 0; });
  }

  document.getElementById("register-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var errBox = document.getElementById("register-error");
    errBox.hidden = true;
    var payload = {
      company_name: document.getElementById("r-company").value.trim(),
      license_no: document.getElementById("r-license").value.trim(),
      representative: document.getElementById("r-rep").value.trim(),
      phone: document.getElementById("r-phone").value.trim(),
      areas: Array.prototype.map.call(document.querySelectorAll("#r-areas input:checked"), function (i) { return i.value; })
    };
    if (!payload.company_name || !payload.license_no || !payload.representative || !payload.phone) {
      errBox.textContent = "必須項目をすべて入力してください";
      errBox.hidden = false;
      return;
    }
    try {
      me = await S.rpc("register_partner", { p: payload });
      S.toast("会社情報を登録しました");
      route();
    } catch (err) {
      errBox.textContent = /check constraint/.test(err.message) ? "入力内容の形式を確認してください（電話番号など）" : err.message;
      errBox.hidden = false;
    }
  });

  document.getElementById("edit-profile").addEventListener("click", function () {
    fillRegister(me);
    view("register");
  });

  /* ---------------- ダッシュボード ---------------- */
  document.querySelectorAll("[data-tab]").forEach(function (b) {
    b.addEventListener("click", function () {
      var t = b.getAttribute("data-tab");
      document.querySelectorAll("[data-tab]").forEach(function (x) { x.setAttribute("aria-selected", x === b ? "true" : "false"); });
      document.getElementById("tab-open").hidden = t !== "open";
      document.getElementById("tab-mine").hidden = t !== "mine";
      if (t === "mine") loadMine(); else loadOpen();
    });
  });

  function renderStats() {
    document.getElementById("credits").textContent = me.credits.toLocaleString("ja-JP");
    document.getElementById("price").textContent = me.lead_price.toLocaleString("ja-JP") + " クレジット";
    document.getElementById("areas").textContent = me.areas && me.areas.length ? me.areas.join("・") : "全国";
  }

  async function loadOpen() {
    var box = document.getElementById("open-list");
    box.innerHTML = '<div class="empty">読み込んでいます…</div>';
    try {
      var leads = await S.rpc("list_open_leads");
      if (!leads.length) { box.innerHTML = '<div class="empty">現在、受付中の査定依頼はありません。</div>'; return; }
      document.getElementById("max-buyers").textContent = leads[0].max_buyers;
      box.innerHTML = leads.map(function (l) {
        return '<div class="lead-card">' +
          "<h4>" + S.esc(l.prefecture + " " + l.city) + "</h4>" +
          '<div class="meta">' + S.esc(S.propertySummary(l)) + "</div>" +
          '<div class="meta">売却時期：' + S.esc(S.label("sale_timing", l.sale_timing)) +
          (l.current_status ? "　現況：" + S.esc(S.label("current_status", l.current_status)) : "") + "</div>" +
          '<div class="meta">受付：' + S.fmtDate(l.created_at) + "　購入済み " + l.buyer_count + " / " + l.max_buyers + " 社</div>" +
          '<div style="margin-top:10px"><button class="btn accent small" data-buy="' + l.id + '">' +
          l.price.toLocaleString("ja-JP") + " クレジットで購入</button></div>" +
          "</div>";
      }).join("");
    } catch (err) {
      box.innerHTML = '<div class="notice err">' + S.esc(err.message) + "</div>";
    }
  }

  document.getElementById("open-list").addEventListener("click", async function (e) {
    var id = e.target.getAttribute("data-buy");
    if (!id) return;
    if (me.credits < me.lead_price) { S.toast("クレジットが不足しています。運営までお問い合わせください", true); return; }
    if (!window.confirm(me.lead_price + " クレジットを使って、この査定依頼の連絡先を表示しますか？\n購入後の取り消しはできません。")) return;
    e.target.disabled = true;
    try {
      await S.rpc("purchase_lead", { p_lead_id: id });
      me = await S.rpc("my_partner");
      renderStats();
      S.toast("購入しました。「購入済み」タブで連絡先を確認できます");
      loadOpen();
    } catch (err) {
      S.toast(err.message, true);
      e.target.disabled = false;
      loadOpen();
    }
  });

  function contactBlock(c) {
    if (!c) return '<div class="contact">連絡先は削除されています（お申込みの取り下げ）</div>';
    return '<div class="contact">' +
      "<b>" + S.esc(c.name) + " 様</b><br>" +
      (c.phone ? "電話：" + S.esc(c.phone) + "<br>" : "") +
      (c.email ? "メール：" + S.esc(c.email) + "<br>" : "") +
      "希望の連絡方法：" + S.esc(S.label("contact_method", c.contact_method)) +
      (c.contact_time ? "（" + S.esc(c.contact_time) + "）" : "") +
      (c.note ? "<br>ご要望：" + S.esc(c.note) : "") +
      "</div>";
  }

  async function loadMine() {
    var box = document.getElementById("mine-list");
    box.innerHTML = '<div class="empty">読み込んでいます…</div>';
    try {
      purchased = await S.rpc("my_purchases");
      if (!purchased.length) { box.innerHTML = '<div class="empty">まだ購入した査定依頼はありません。</div>'; return; }
      box.innerHTML = purchased.map(function (l) {
        var addr = [l.prefecture, l.city, l.town, l.contact && l.contact.address_detail].filter(Boolean).join(" ");
        return '<div class="lead-card">' +
          "<h4>" + S.esc(addr) + "</h4>" +
          '<div class="meta">' + S.esc(S.propertySummary(l)) + "</div>" +
          '<div class="meta">売却時期：' + S.esc(S.label("sale_timing", l.sale_timing)) +
          (l.current_status ? "　現況：" + S.esc(S.label("current_status", l.current_status)) : "") +
          (l.reason ? "　理由：" + S.esc(l.reason) : "") + "</div>" +
          '<div class="meta">購入：' + S.fmtDate(l.purchased_at) + "</div>" +
          contactBlock(l.contact) +
          "</div>";
      }).join("");
    } catch (err) {
      box.innerHTML = '<div class="notice err">' + S.esc(err.message) + "</div>";
    }
  }

  document.getElementById("csv").addEventListener("click", function () {
    if (!purchased.length) { S.toast("書き出す査定依頼がありません", true); return; }
    var header = ["購入日時", "物件種別", "都道府県", "市区町村", "町名", "番地・建物", "土地面積", "建物面積", "築年", "間取り",
                  "現況", "売却時期", "お名前", "電話", "メール", "連絡方法", "連絡時間帯", "ご要望"];
    var rows = purchased.map(function (l) {
      var c = l.contact || {};
      return [S.fmtDate(l.purchased_at), S.label("property_type", l.property_type), l.prefecture, l.city, l.town,
              c.address_detail, l.land_area, l.building_area, l.built_year, l.layout,
              l.current_status && S.label("current_status", l.current_status), S.label("sale_timing", l.sale_timing),
              c.name, c.phone, c.email, c.contact_method && S.label("contact_method", c.contact_method), c.contact_time, c.note];
    });
    var csv = [header].concat(rows).map(function (r) {
      return r.map(function (v) {
        var s = v == null ? "" : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",");
    }).join("\r\n");
    // Excelで文字化けしないようBOMを付ける
    var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "査定依頼_" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });

  /* ---------------- 起動 ---------------- */
  function route() {
    if (!me) { fillRegister(null); view("register"); return; }
    if (!me.approved) { view("pending"); return; }
    renderStats();
    view("dashboard");
    loadOpen();
  }

  async function load() {
    var c = S.db();
    if (!c) { view("auth"); return; }
    var sess = await c.auth.getSession();
    var user = sess.data.session && sess.data.session.user;
    if (!user) { view("auth"); return; }
    document.getElementById("who").textContent = user.email;
    document.getElementById("logout").hidden = false;
    try {
      me = await S.rpc("my_partner");
      route();
    } catch (err) {
      S.toast(err.message, true);
      view("auth");
    }
  }

  load();
})();
