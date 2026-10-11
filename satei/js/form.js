/* 一般の方の査定申込フォーム */
(function () {
  "use strict";
  var S = window.Satei;
  var form = document.getElementById("lead-form");
  var step = 1;
  var THIS_YEAR = new Date().getFullYear();

  function choices(containerId, name, group, defaultValue) {
    var box = document.getElementById(containerId);
    box.innerHTML = Object.keys(S.LABELS[group]).map(function (k) {
      return '<label class="choice"><input type="radio" name="' + name + '" value="' + k + '"' +
        (k === defaultValue ? " checked" : "") + "><span>" + S.label(group, k) + "</span></label>";
    }).join("");
  }
  choices("type-choices", "property_type", "property_type");
  choices("status-choices", "current_status", "current_status");
  choices("timing-choices", "sale_timing", "sale_timing");
  choices("method-choices", "contact_method", "contact_method", "either");
  document.getElementById("prefecture").insertAdjacentHTML("beforeend", S.prefectureOptions());

  function value(name) {
    var el = form.elements[name];
    if (!el) return "";
    return (el.value || "").trim();
  }

  /* 物件の種類に応じて、関係のない入力欄を隠す（例：土地に築年は不要） */
  function applyType() {
    var type = value("property_type");
    form.querySelectorAll("[data-types]").forEach(function (el) {
      var show = !type || el.getAttribute("data-types").split(",").indexOf(type) >= 0;
      el.hidden = !show;
      if (!show) el.querySelectorAll("input").forEach(function (i) { i.value = ""; });
    });
    form.querySelector(".area-label").textContent = type === "mansion" ? "専有面積" : "建物面積";
  }
  form.addEventListener("change", function (e) {
    if (e.target.name === "property_type") applyType();
    if (e.target.id === "consent" && e.target.checked) document.getElementById("consent-err").style.display = "none";
    var f = e.target.closest(".field");
    if (f) f.classList.remove("error");
  });

  function setError(name, on) {
    var f = form.querySelector('[data-name="' + name + '"]');
    if (f) f.classList.toggle("error", on);
    return !on;
  }

  function validateStep(n) {
    var ok = true;
    if (n === 1) {
      ok = setError("property_type", !value("property_type")) && ok;
      ok = setError("prefecture", !value("prefecture")) && ok;
      ok = setError("city", !value("city")) && ok;
      ok = setError("sale_timing", !value("sale_timing")) && ok;
      ["land_area", "building_area"].forEach(function (k) {
        var v = value(k);
        ok = setError(k, v !== "" && !(Number(v) > 0 && Number(v) < 1000000)) && ok;
      });
      var y = value("built_year");
      ok = setError("built_year", y !== "" && !(Number(y) >= 1900 && Number(y) <= THIS_YEAR)) && ok;
    }
    if (n === 2) {
      ok = setError("name", !value("name")) && ok;
      var phone = value("phone"), email = value("email");
      ok = setError("phone", phone !== "" && !/^[0-9+\-() ]{10,20}$/.test(phone)) && ok;
      ok = setError("email", email !== "" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) && ok;
      var none = !phone && !email;
      document.getElementById("contact-required").hidden = !none;
      ok = !none && ok;
    }
    if (!ok) {
      var first = form.querySelector(".field.error, #contact-required:not([hidden])");
      if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return ok;
  }

  function show(n) {
    step = n;
    form.querySelectorAll(".step").forEach(function (el) {
      el.hidden = Number(el.getAttribute("data-step")) !== n;
    });
    document.querySelectorAll(".progress i").forEach(function (el, i) { el.classList.toggle("on", i < n); });
    if (n === 3) renderSummary();
    document.getElementById("form").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderSummary() {
    var rows = [
      ["物件の種類", S.label("property_type", value("property_type"))],
      ["所在地", [value("prefecture"), value("city"), value("town"), value("address_detail")].filter(Boolean).join(" ")],
      ["土地面積", value("land_area") && value("land_area") + "㎡"],
      [value("property_type") === "mansion" ? "専有面積" : "建物面積", value("building_area") && value("building_area") + "㎡"],
      ["築年", value("built_year") && value("built_year") + "年"],
      ["間取り", value("layout")],
      ["現在の状況", value("current_status") && S.label("current_status", value("current_status"))],
      ["売却の希望時期", S.label("sale_timing", value("sale_timing"))],
      ["お名前", value("name")],
      ["電話番号", value("phone")],
      ["メール", value("email")],
      ["連絡方法", S.label("contact_method", value("contact_method"))],
      ["連絡の時間帯", value("contact_time")],
      ["ご要望", value("note")]
    ].filter(function (r) { return r[1]; });
    document.getElementById("summary").innerHTML = "<dl>" + rows.map(function (r) {
      return "<dt>" + S.esc(r[0]) + "</dt><dd>" + S.esc(r[1]) + "</dd>";
    }).join("") + "</dl>";
  }

  form.addEventListener("click", function (e) {
    if (e.target.matches("[data-next]")) { if (validateStep(step)) show(step + 1); }
    if (e.target.matches("[data-prev]")) show(step - 1);
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var consent = document.getElementById("consent").checked;
    document.getElementById("consent-err").style.display = consent ? "none" : "block";
    if (!consent) return;

    var btn = document.getElementById("submit-btn");
    var errBox = document.getElementById("submit-error");
    btn.disabled = true;
    btn.textContent = "送信しています…";
    errBox.hidden = true;

    var payload = {};
    ["property_type", "prefecture", "city", "town", "address_detail", "land_area", "building_area",
     "built_year", "layout", "current_status", "sale_timing", "name", "phone", "email",
     "contact_method", "contact_time", "note", "website"].forEach(function (k) { payload[k] = value(k); });
    payload.consent = true;

    try {
      await S.rpc("submit_lead", { p: payload });
      form.hidden = true;
      document.querySelector(".progress").hidden = true;
      document.getElementById("done").hidden = false;
      document.getElementById("form").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
      btn.disabled = false;
      btn.textContent = "同意して申し込む";
    }
  });

  applyType();
})();
