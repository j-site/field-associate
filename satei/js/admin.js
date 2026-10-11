/* 運営管理画面 */
(function () {
  "use strict";
  var S = window.Satei;

  function view(name) {
    ["login", "denied", "admin"].forEach(function (v) { document.getElementById("view-" + v).hidden = v !== name; });
  }

  document.getElementById("login-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var c = S.db();
    var errBox = document.getElementById("login-error");
    if (!c) { errBox.textContent = "サイトの接続設定が完了していません"; errBox.hidden = false; return; }
    var res = await c.auth.signInWithPassword({
      email: document.getElementById("email").value.trim(),
      password: document.getElementById("password").value
    });
    if (res.error) { errBox.textContent = "ログインできませんでした"; errBox.hidden = false; return; }
    load();
  });

  document.getElementById("logout").addEventListener("click", async function () {
    await S.db().auth.signOut();
    location.reload();
  });

  document.querySelectorAll("[data-tab]").forEach(function (b) {
    b.addEventListener("click", function () {
      var t = b.getAttribute("data-tab");
      document.querySelectorAll("[data-tab]").forEach(function (x) { x.setAttribute("aria-selected", x === b ? "true" : "false"); });
      ["partners", "leads", "settings"].forEach(function (n) { document.getElementById("tab-" + n).hidden = n !== t; });
      ({ partners: loadPartners, leads: loadLeads, settings: loadSettings })[t]();
    });
  });

  /* ---------------- 不動産会社 ---------------- */
  async function loadPartners() {
    var body = document.getElementById("partners-body");
    try {
      var list = await S.rpc("admin_list_partners");
      if (!list.length) { body.innerHTML = '<tr><td colspan="7" class="empty">登録はまだありません</td></tr>'; return; }
      body.innerHTML = list.map(function (p) {
        return "<tr>" +
          "<td>" + (p.approved ? '<span class="pill ok">承認済み</span>' : '<span class="pill warn">審査待ち</span>') + "</td>" +
          "<td><b>" + S.esc(p.company_name) + "</b><br>" + S.esc(p.license_no) + "</td>" +
          "<td>" + S.esc(p.representative) + "<br>" + S.esc(p.phone) + "<br>" + S.esc(p.email || "") + "</td>" +
          "<td>" + S.esc(p.areas && p.areas.length ? p.areas.join("・") : "全国") + "</td>" +
          "<td>" + p.credits + "</td>" +
          "<td>" + p.purchase_count + "</td>" +
          '<td><div class="inline-form" style="margin-bottom:6px">' +
            (p.approved
              ? '<button class="btn ghost small" data-approve="' + p.id + '" data-to="false">承認を取り消す</button>'
              : '<button class="btn small" data-approve="' + p.id + '" data-to="true">承認する</button>') +
          '</div><div class="inline-form">' +
            '<input type="number" placeholder="±数" data-amount="' + p.id + '">' +
            '<input type="text" class="wide" placeholder="理由（入金など）" data-reason="' + p.id + '">' +
            '<button class="btn ghost small" data-credit="' + p.id + '">反映</button>' +
          "</div></td></tr>";
      }).join("");
    } catch (err) {
      body.innerHTML = '<tr><td colspan="7"><div class="notice err">' + S.esc(err.message) + "</div></td></tr>";
    }
  }

  document.getElementById("partners-body").addEventListener("click", async function (e) {
    var id;
    try {
      if ((id = e.target.getAttribute("data-approve"))) {
        var to = e.target.getAttribute("data-to") === "true";
        if (to && !window.confirm("免許番号を確認しましたか？承認すると査定依頼を購入できるようになります。")) return;
        await S.rpc("admin_set_partner_approval", { p_partner_id: id, p_approved: to });
        S.toast(to ? "承認しました" : "承認を取り消しました");
        loadPartners();
      }
      if ((id = e.target.getAttribute("data-credit"))) {
        var amount = parseInt(document.querySelector('[data-amount="' + id + '"]').value, 10);
        var reason = document.querySelector('[data-reason="' + id + '"]').value;
        if (!amount) { S.toast("増減する数を入力してください", true); return; }
        var r = await S.rpc("admin_add_credits", { p_partner_id: id, p_amount: amount, p_reason: reason });
        S.toast("反映しました（残高 " + r.credits + "）");
        loadPartners();
      }
    } catch (err) { S.toast(err.message, true); }
  });

  /* ---------------- 査定依頼 ---------------- */
  async function loadLeads() {
    var body = document.getElementById("leads-body");
    try {
      var list = await S.rpc("admin_list_leads");
      if (!list.length) { body.innerHTML = '<tr><td colspan="6" class="empty">査定依頼はまだありません</td></tr>'; return; }
      body.innerHTML = list.map(function (l) {
        var c = l.contact;
        var statusClass = { open: "ok", closed: "mute", withdrawn: "err" }[l.status];
        return "<tr>" +
          "<td>" + S.fmtDate(l.created_at) + "</td>" +
          '<td><span class="pill ' + statusClass + '">' + S.label("lead_status", l.status) + "</span><br>" + l.buyer_count + " / " + l.max_buyers + " 社</td>" +
          "<td>" + S.esc([l.prefecture, l.city, l.town].filter(Boolean).join(" ")) + "<br>" + S.esc(S.propertySummary(l)) + "</td>" +
          "<td>" + (c ? S.esc(c.name) + "<br>" + S.esc(c.phone || "") + "<br>" + S.esc(c.email || "") : '<span class="pill err">削除済み</span>') + "</td>" +
          "<td>" + (l.buyers.length ? l.buyers.map(function (b) {
            return S.esc(b.company_name) + '<br><span style="color:var(--ink-3);font-size:12px">' + S.fmtDate(b.purchased_at) + "</span>";
          }).join("<br>") : "—") + "</td>" +
          "<td>" + (l.status !== "withdrawn"
            ? '<button class="btn ghost small" data-withdraw="' + l.id + '">取り下げ</button>' : "") + "</td>" +
          "</tr>";
      }).join("");
    } catch (err) {
      body.innerHTML = '<tr><td colspan="6"><div class="notice err">' + S.esc(err.message) + "</div></td></tr>";
    }
  }

  document.getElementById("leads-body").addEventListener("click", async function (e) {
    var id = e.target.getAttribute("data-withdraw");
    if (!id) return;
    if (!window.confirm("依頼者からの申し出による取り下げとして処理します。\n連絡先は削除され、購入済みの会社からも見えなくなります（提供記録は残ります）。よろしいですか？")) return;
    try {
      await S.rpc("admin_withdraw_lead", { p_lead_id: id });
      S.toast("取り下げました");
      loadLeads();
    } catch (err) { S.toast(err.message, true); }
  });

  /* ---------------- 設定 ---------------- */
  async function loadSettings() {
    try {
      var s = await S.rpc("admin_get_settings");
      document.getElementById("s-price").value = s.lead_price;
      document.getElementById("s-max").value = s.max_buyers;
      document.getElementById("s-ttl").value = s.lead_ttl_days;
      document.getElementById("s-consent").value = s.consent_version;
    } catch (err) { S.toast(err.message, true); }
  }
  document.getElementById("settings-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    try {
      await S.rpc("admin_update_settings", { p: {
        lead_price: document.getElementById("s-price").value,
        max_buyers: document.getElementById("s-max").value,
        lead_ttl_days: document.getElementById("s-ttl").value,
        consent_version: document.getElementById("s-consent").value
      } });
      S.toast("保存しました");
    } catch (err) { S.toast(err.message, true); }
  });

  /* ---------------- 起動 ---------------- */
  async function load() {
    var c = S.db();
    if (!c) { view("login"); return; }
    var sess = await c.auth.getSession();
    var user = sess.data.session && sess.data.session.user;
    if (!user) { view("login"); return; }
    document.getElementById("who").textContent = user.email;
    document.getElementById("logout").hidden = false;
    try {
      if (!(await S.rpc("is_admin"))) { view("denied"); return; }
      view("admin");
      loadPartners();
    } catch (err) { S.toast(err.message, true); view("login"); }
  }
  load();
})();
