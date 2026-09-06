/* ============================================================
 *  JarvisRide アプリ本体
 * ============================================================ */
(function () {
"use strict";

/* ========== 定数 ========== */
var SIM_SPEED   = 8;             // デモ用の時間圧縮倍率
var DRIVE_KMH   = 34;            // 想定平均速度
var ROAD_FACTOR = 1.35;          // 直線距離 → 道路距離の補正
var TICK_MS     = 250;           // 画面上の走行更新間隔
var PUSH_MS     = 1500;          // 車両位置をサーバーへ送る間隔
var OPEN_MIN    = 15;            // ドライバーに見せるリクエストの有効時間（分）
var ACTIVE      = ["enroute", "arrived", "onboard"];
var TOKYO       = { lat: 35.681236, lng: 139.767125, label: "東京駅" };

var CLASSES = {
  robotaxi: {
    key:"robotaxi", name:"ロボタクシー", tag:"自動運転",
    desc:"完全自動運転・ドライバー不在。深夜も同一料金。",
    base:400, perKm:200, pickupFee:0, etaBonus:-1, autonomous:true
  },
  standard: {
    key:"standard", name:"スタンダード", tag:"",
    desc:"一般ドライバーが運転。4人まで乗車できます。",
    base:500, perKm:320, pickupFee:300, etaBonus:0, autonomous:false
  },
  premium: {
    key:"premium", name:"プレミアム", tag:"上位車種",
    desc:"上位車種と評価4.8以上のドライバーを優先手配。",
    base:800, perKm:480, pickupFee:400, etaBonus:2, autonomous:false
  }
};

var FLEET_NAMES = ["佐藤 健","鈴木 誠","高橋 由紀","田中 拓也","伊藤 彩","渡辺 剛","中村 恵","小林 亮"];
var FLEET_CARS  = ["トヨタ プリウス","日産 ノート","ホンダ フリード","トヨタ アルファード","テスラ Model 3","日産 セレナ"];
var ROBO_CARS   = ["Tesla Model Y (FSD)","Tesla Model 3 (FSD)","Tesla Cybercab"];

var K_DRIVER = "jr.driver", K_STATS = "jr.stats";

/* ========== 小道具 ========== */
function $(id){ return document.getElementById(id); }
function yen(n){ return "¥" + Math.round(n).toLocaleString("ja-JP"); }
function load(k, d){
  try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch(e){ return d; }
}
function save(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }

function distKm(a, b){
  var R = 6371, t = Math.PI / 180;
  var dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
  var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
function roadKm(a, b){ return distKm(a, b) * ROAD_FACTOR; }
function etaMin(a, b){ return Math.max(1, Math.round(roadKm(a, b) / DRIVE_KMH * 60)); }
function quote(cls, a, b){
  var km = roadKm(a, b);
  var base = cls.base + cls.perKm * km;
  return { km: km, base: base, pickupFee: cls.pickupFee, total: Math.round((base + cls.pickupFee) / 10) * 10 };
}
function short(s, n){
  if (!s) return "—";
  n = n || 18;
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function escapeHtml(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c];
  });
}
var toastT = null;
function toast(msg){
  var el = $("toast");
  el.textContent = msg; el.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(function(){ el.classList.remove("on"); }, 2600);
}
/** 書き込みの失敗を黙って捨てず、利用者に見える形にする */
function push(p, what){
  return Promise.resolve(p).catch(function(err){
    console.error(what || "同期に失敗しました", err);
    toast((what || "同期") + "に失敗しました。通信状況をご確認ください");
  });
}

/* ========== 地図 ========== */
var map = L.map("map", { zoomControl: false, attributionControl: true })
           .setView([TOKYO.lat, TOKYO.lng], 15);
L.control.zoom({ position: "topright" }).addTo(map);
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap &copy; CARTO'
}).addTo(map);

function icon(cls, size){
  return L.divIcon({ className: "mk", html: '<div class="' + cls + '"></div>',
                     iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}
var CAR_SVG = '<svg viewBox="0 0 24 24"><path d="M5 17h14l-1.6-4.6A2 2 0 0 0 15.5 11h-7a2 2 0 0 0-1.9 1.4z"/><circle cx="8" cy="19" r="1.6"/><circle cx="16" cy="19" r="1.6"/></svg>';
function carIcon(autonomous, active){
  var c = "mk-car" + (autonomous ? " ai" : "") + (active ? " act" : "");
  var fill = autonomous && !active ? "#ffc107" : "#16181d";
  return L.divIcon({
    className: "mk" + (active ? " mk-smooth" : ""),
    html: '<div class="' + c + '">' + CAR_SVG.replace("<svg", '<svg fill="' + fill + '"') + "</div>",
    iconSize: [30, 30], iconAnchor: [15, 15]
  });
}

var meMarker = L.marker([TOKYO.lat, TOKYO.lng], { icon: icon("mk-me", 17), zIndexOffset: 300 }).addTo(map);
var pickMarker = null, destMarker = null, rideCar = null, routeLine = null;
var fleet = [], fleetMarkers = [];

/* ========== 状態 ========== */
var Store = null;
/** タブ固有のID。同じ利用者が複数タブを開いても走行を進めるのは1つだけにする */
var TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
var LEASE_MS = 3000;

var state = {
  ready: false,
  mode: "rider",
  me: { lat: TOKYO.lat, lng: TOKYO.lng },
  pickup: null,
  dest: null,
  cls: "robotaxi",
  myRideId: null,
  view: "book",
  rating: 0,
  lastPush: 0,
  gps: false,
  gpsWatch: null
};
var driver = load(K_DRIVER, null);
var stats  = load(K_STATS, { earn: 0, trips: 0, online: false });

/* ========== 周辺車両（演出） ========== */
function seedFleet(center){
  fleetMarkers.forEach(function(m){ map.removeLayer(m); });
  fleet = []; fleetMarkers = [];
  for (var i = 0; i < 11; i++){
    var ang = Math.random() * Math.PI * 2;
    var r = 0.004 + Math.random() * 0.012;
    var v = {
      lat: center.lat + Math.sin(ang) * r,
      lng: center.lng + Math.cos(ang) * r * 1.22,
      autonomous: i < 5,
      hd: Math.random() * Math.PI * 2
    };
    fleet.push(v);
    fleetMarkers.push(L.marker([v.lat, v.lng], { icon: carIcon(v.autonomous, false), zIndexOffset: 100 }).addTo(map));
  }
}
function driftFleet(){
  for (var i = 0; i < fleet.length; i++){
    var v = fleet[i];
    v.hd += (Math.random() - 0.5) * 0.55;
    v.lat += Math.cos(v.hd) * 0.000045;
    v.lng += Math.sin(v.hd) * 0.000055;
    fleetMarkers[i].setLatLng([v.lat, v.lng]);
  }
}
function nearestFleet(pt, autonomous){
  var best = null, bd = 1e9;
  for (var i = 0; i < fleet.length; i++){
    if (fleet[i].autonomous !== autonomous) continue;
    var d = distKm(fleet[i], pt);
    if (d < bd){ bd = d; best = fleet[i]; }
  }
  return best || fleet[0] || pt;
}

/* ========== 乗車地・目的地 ========== */
function setPickup(pt, label){
  state.pickup = { lat: pt.lat, lng: pt.lng, label: label || "指定した地点" };
  $("pickup-label").textContent = state.pickup.label;
  $("pickup-label").classList.remove("ph");
  if (!pickMarker){
    pickMarker = L.marker([pt.lat, pt.lng], { icon: icon("mk-pin", 22), draggable: true, zIndexOffset: 250 }).addTo(map);
    pickMarker.on("dragend", function(){
      var p = pickMarker.getLatLng();
      state.pickup.lat = p.lat; state.pickup.lng = p.lng;
      reverseGeocode(p, function(name){ setPickup(p, name || "指定した地点"); });
      renderCars();
    });
  } else {
    pickMarker.setLatLng([pt.lat, pt.lng]);
  }
  renderCars();
}
function setDest(pt, label){
  state.dest = { lat: pt.lat, lng: pt.lng, label: label || "指定した地点" };
  $("dest-input").value = state.dest.label;
  if (!destMarker){
    destMarker = L.marker([pt.lat, pt.lng], { icon: icon("mk-pin b", 19), zIndexOffset: 250 }).addTo(map);
  } else {
    destMarker.setLatLng([pt.lat, pt.lng]);
  }
  drawRoute();
  renderCars();
  fitBoth();
}
function clearDest(){
  state.dest = null;
  if (destMarker){ map.removeLayer(destMarker); destMarker = null; }
  if (routeLine){ map.removeLayer(routeLine); routeLine = null; }
  renderCars();
}
function drawRoute(){
  if (routeLine){ map.removeLayer(routeLine); routeLine = null; }
  if (!state.pickup || !state.dest) return;
  routeLine = L.polyline([[state.pickup.lat, state.pickup.lng], [state.dest.lat, state.dest.lng]], {
    color: "#16181d", weight: 4, opacity: .32, dashArray: "7 9"
  }).addTo(map);
}
function fitBoth(){
  if (!state.pickup || !state.dest) return;
  map.fitBounds(L.latLngBounds([state.pickup.lat, state.pickup.lng], [state.dest.lat, state.dest.lng]),
                { padding: [70, 70], maxZoom: 16 });
}
function locate(){
  if (!navigator.geolocation){ useFallback(); return; }
  navigator.geolocation.getCurrentPosition(function(pos){
    var p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    state.me = p;
    meMarker.setLatLng([p.lat, p.lng]);
    map.setView([p.lat, p.lng], 16);
    seedFleet(p);
    setPickup(p, "現在地");
    reverseGeocode(p, function(name){ if (name) setPickup(p, name); });
  }, function(){
    useFallback();
    toast("位置情報が取得できないため、東京駅を基準に表示します");
  }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
}
function useFallback(){
  var p = { lat: TOKYO.lat, lng: TOKYO.lng };
  state.me = p;
  meMarker.setLatLng([p.lat, p.lng]);
  map.setView([p.lat, p.lng], 16);
  seedFleet(p);
  setPickup(p, TOKYO.label + " 周辺");
}

/* ========== ジオコーディング（Nominatim / 失敗時は静かに無視） ========== */
function reverseGeocode(pt, cb){
  fetch("https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&accept-language=ja&lat=" +
        pt.lat + "&lon=" + pt.lng)
    .then(function(r){ return r.json(); })
    .then(function(j){
      var a = j && j.address;
      if (!a) { cb(null); return; }
      cb(j.name || [a.neighbourhood, a.suburb, a.quarter, a.city_district, a.city, a.town].filter(Boolean)[0] || null);
    })
    .catch(function(){ cb(null); });
}
var searchT = null;
function searchPlaces(q){
  clearTimeout(searchT);
  if (!q || q.length < 2){ $("sugg").innerHTML = ""; return; }
  searchT = setTimeout(function(){
    var near = state.me;
    fetch("https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=jp&accept-language=ja&q=" +
          encodeURIComponent(q) + "&viewbox=" +
          (near.lng - 0.35) + "," + (near.lat + 0.25) + "," + (near.lng + 0.35) + "," + (near.lat - 0.25))
      .then(function(r){ return r.json(); })
      .then(function(list){ renderSugg(list || []); })
      .catch(function(){
        $("sugg").innerHTML = '<li data-none="1"><b>検索を利用できません</b><span>地図をタップして目的地を指定してください</span></li>';
      });
  }, 380);
}
function renderSugg(list){
  var ul = $("sugg");
  if (!list.length){
    ul.innerHTML = '<li data-none="1"><b>該当する地点がありません</b><span>地図をタップして指定できます</span></li>';
    return;
  }
  ul.innerHTML = list.map(function(p, i){
    var parts = (p.display_name || "").split(",");
    return '<li data-i="' + i + '"><b>' + escapeHtml(parts[0]) + "</b><span>" +
           escapeHtml(parts.slice(1, 4).join(",").trim()) + "</span></li>";
  }).join("");
  ul.onclick = function(e){
    var li = e.target.closest("li");
    if (!li || li.dataset.none) return;
    var p = list[+li.dataset.i];
    setDest({ lat: +p.lat, lng: +p.lon }, (p.display_name || "").split(",")[0]);
    ul.innerHTML = "";
  };
}

/* ========== 車両クラス ========== */
var CAR_ART = {
  robotaxi: '<svg viewBox="0 0 56 30"><path d="M6 22h44l-4.6-9.6A6 6 0 0 0 40 9H18a6 6 0 0 0-5.2 3L6 22z" fill="#16181d"/><rect x="14" y="12" width="28" height="6" rx="2" fill="#ffc107"/><circle cx="16" cy="24" r="4" fill="#16181d"/><circle cx="40" cy="24" r="4" fill="#16181d"/><circle cx="28" cy="6" r="2.6" fill="#0ea5e9"/></svg>',
  standard: '<svg viewBox="0 0 56 30"><path d="M6 22h44l-4.6-9.6A6 6 0 0 0 40 9H18a6 6 0 0 0-5.2 3L6 22z" fill="#4b5563"/><rect x="14" y="12" width="28" height="6" rx="2" fill="#e5e7eb"/><circle cx="16" cy="24" r="4" fill="#16181d"/><circle cx="40" cy="24" r="4" fill="#16181d"/></svg>',
  premium:  '<svg viewBox="0 0 56 30"><path d="M4 22h48l-5-11a6 6 0 0 0-5.4-3.4H14.4A6 6 0 0 0 9 11L4 22z" fill="#16181d"/><rect x="13" y="11" width="30" height="7" rx="2" fill="#ffc107"/><circle cx="15" cy="24" r="4.2" fill="#16181d"/><circle cx="41" cy="24" r="4.2" fill="#16181d"/></svg>'
};
function renderCars(){
  var wrap = $("cars"), html = "";
  var ready = !!(state.pickup && state.dest);
  Object.keys(CLASSES).forEach(function(k){
    var c = CLASSES[k];
    var q = ready ? quote(c, state.pickup, state.dest) : null;
    var eta = state.pickup
      ? Math.max(1, etaMin(nearestFleet(state.pickup, c.autonomous), state.pickup) + c.etaBonus)
      : null;
    html += '<button class="car" data-k="' + k + '" aria-pressed="' + (state.cls === k) + '">' +
      '<span class="ic">' + CAR_ART[k] + "</span>" +
      '<span class="f">' +
        '<span class="nm">' + c.name + (c.tag ? '<span class="tag' + (c.autonomous ? "" : " y") + '">' + c.tag + "</span>" : "") + "</span>" +
        '<span class="ds">' + c.desc + "</span>" +
      "</span>" +
      '<span class="pr">' +
        '<span class="yen">' + (q ? yen(q.total) : "—") + "</span><br>" +
        '<span class="eta">' + (eta ? eta + "分で到着" : "—") + "</span>" +
      "</span></button>";
  });
  wrap.innerHTML = html;
  wrap.onclick = function(e){
    var b = e.target.closest(".car");
    if (!b) return;
    state.cls = b.dataset.k;
    renderCars();
  };

  var btn = $("btn-request");
  if (!state.ready){ btn.disabled = true; btn.textContent = "接続しています…"; }
  else if (!state.pickup){ btn.disabled = true; btn.textContent = "乗車地を取得しています…"; }
  else if (!state.dest){ btn.disabled = true; btn.textContent = "目的地を指定してください"; }
  else {
    btn.disabled = false;
    btn.textContent = CLASSES[state.cls].name + "を呼ぶ・" + yen(quote(CLASSES[state.cls], state.pickup, state.dest).total);
  }
}

/* ========== 配車依頼 ========== */
function requestRide(){
  if (!state.pickup || !state.dest) return;
  var c = CLASSES[state.cls];
  var q = quote(c, state.pickup, state.dest);
  var origin = nearestFleet(state.pickup, c.autonomous);

  $("btn-request").disabled = true;
  Store.create({
    cls: c.key,
    pickup: state.pickup,
    dest: state.dest,
    km: +q.km.toFixed(2),
    base: Math.round(q.base),
    pickupFee: q.pickupFee,
    total: q.total,
    car: { lat: origin.lat, lng: origin.lng }
  }).then(function(ride){
    state.myRideId = ride.id;
    state.rating = 0;
    showRider("search");
    $("s-class").textContent = c.name;
    $("s-dest").textContent  = short(state.dest.label, 14);
    $("s-fare").textContent  = yen(q.total);

    if (c.autonomous){
      $("search-title").textContent = "自動運転車両を手配しています";
      $("search-sub").textContent   = "近くのロボタクシーに接続中…";
      setTimeout(function(){ autoMatch(ride.id, true); }, 2600);
    } else {
      $("search-title").textContent = "近くのドライバーを探しています";
      $("search-sub").textContent   = Store.mode === "supabase"
        ? "他の端末のドライバーにも通知されています"
        : "「運ぶ」タブからご自身で受諾することもできます";
      setTimeout(function(){
        var r = Store.get(ride.id);
        if (r && r.status === "searching") autoMatch(ride.id, false);
      }, 9000);
    }
  }).catch(function(err){
    console.error(err);
    toast("配車を依頼できませんでした。通信状況をご確認ください");
  }).then(function(){
    renderCars();
  });
}

/** 手配が付かないときの代替（デモ用の自動マッチ） */
function autoMatch(rideId, autonomous){
  var r = Store.get(rideId);
  if (!r || r.status !== "searching") return;
  var d = autonomous
    ? { name: "自動運転車両", car: ROBO_CARS[Math.floor(Math.random() * ROBO_CARS.length)],
        plate: "品川 500 X " + (10 + Math.floor(Math.random() * 89)), rating: "4.98",
        autonomous: true, human: false }
    : { name: FLEET_NAMES[Math.floor(Math.random() * FLEET_NAMES.length)],
        car: FLEET_CARS[Math.floor(Math.random() * FLEET_CARS.length)],
        plate: "品川 300 あ " + (10 + Math.floor(Math.random() * 89)) + "-" + (10 + Math.floor(Math.random() * 89)),
        rating: (4.5 + Math.random() * 0.5).toFixed(2), autonomous: false, human: false };

  push(Store.patch(rideId, { status: "enroute", driver: d }), "手配");
  toast(autonomous ? "自動運転車両が確定しました" : "ドライバーが見つかりました");
}

function cancelRide(){
  if (!state.myRideId) return;
  var id = state.myRideId;
  state.myRideId = null;
  clearRideCar();
  showRider("book");
  toast("配車をキャンセルしました");
  push(Store.patch(id, { status: "cancelled" }), "キャンセル");
}

/* ========== 走行の更新 ==========
 * 車両の位置は「車両を持っている側の端末」が進める。
 *   ロボタクシー … 依頼した乗客の端末
 *   一般ドライバー … 受諾したドライバーの端末（GPS送信中は実測値）
 * 画面は TICK_MS ごとに滑らかに動かし、サーバーへは PUSH_MS ごとに送る。
 */
function vehicleIOwn(){
  var list = Store.list();
  for (var i = 0; i < list.length; i++){
    var r = list[i];
    if (ACTIVE.indexOf(r.status) === -1) continue;
    if (r.driverId && r.driverId === Store.userId) return r;                 // 自分が運ぶ
    if (!r.driverId && r.riderId === Store.userId && r.driver) return r;     // 自動運転（自分が依頼）
  }
  return null;
}
/**
 * 走行を進めるタブを1つに絞る。同じ利用者が複数タブを開くと userId だけでは
 * 区別できないため、短命のリースを localStorage 上で取り合う。
 */
function ownsSim(rideId){
  var k = "jr.sim." + rideId, now = Date.now();
  var cur = load(k, null);
  if (cur && cur.tab !== TAB_ID && now - cur.t < LEASE_MS) return false;
  save(k, { tab: TAB_ID, t: now });
  var back = load(k, null);
  return !!back && back.tab === TAB_ID;
}
function stepRide(){
  var r = vehicleIOwn();
  if (!r || !r.car) return;
  if (state.gps && r.driverId === Store.userId) return;   // 実測GPSに任せる
  if (!ownsSim(r.id)) return;

  var target = (r.status === "onboard") ? r.dest : r.pickup;
  var d = distKm(r.car, target);
  var stepKm = (DRIVE_KMH * SIM_SPEED) * (TICK_MS / 3600000);
  var car, status = r.status, arrived = false;

  if (d <= stepKm){
    car = { lat: target.lat, lng: target.lng };
    if (r.status === "enroute"){ status = "arrived"; arrived = true; }
    else if (r.status === "onboard"){ status = "completed"; arrived = true; }
  } else {
    var f = stepKm / d;
    car = { lat: r.car.lat + (target.lat - r.car.lat) * f,
            lng: r.car.lng + (target.lng - r.car.lng) * f };
  }
  var eta = Math.max(1, Math.round(roadKm(car, target) / DRIVE_KMH * 60));

  if (status !== r.status){
    if (status === "completed"){
      onTripCompleted(r);
      try { localStorage.removeItem("jr.sim." + r.id); } catch (e) {}
    }
    push(Store.patch(r.id, { car: car, eta: eta, status: status }), "状態の更新");
    if (arrived && status === "arrived"){
      toast(r.driver && r.driver.autonomous ? "車両が到着しました" : "ドライバーが到着しました");
    }
    return;
  }
  Store.patchLocal(r.id, { car: car, eta: eta });
  var now = Date.now();
  if (now - state.lastPush >= PUSH_MS){
    state.lastPush = now;
    push(Store.patch(r.id, { car: car, eta: eta }), "位置の送信");
  }
}
/** ドライバー側の売上計上（自分が運んだ乗務のみ） */
function onTripCompleted(r){
  if (!driver || r.driverId !== Store.userId || !r.driver || !r.driver.human) return;
  stats.earn += Math.round(r.total * 0.9);
  stats.trips += 1;
  save(K_STATS, stats);
}

function clearRideCar(){
  if (rideCar){ map.removeLayer(rideCar); rideCar = null; }
}
function syncMapRide(){
  var r = state.myRideId ? Store.get(state.myRideId) : null;
  if (!r || ACTIVE.indexOf(r.status) === -1) r = driverRide();
  if (!r || !r.car || ACTIVE.indexOf(r.status) === -1){ clearRideCar(); return; }
  var au = !!(r.driver && r.driver.autonomous);
  if (!rideCar){
    rideCar = L.marker([r.car.lat, r.car.lng], { icon: carIcon(au, true), zIndexOffset: 500 }).addTo(map);
  } else {
    rideCar.setLatLng([r.car.lat, r.car.lng]);
  }
}

/* ========== 乗客側の描画 ========== */
function showRider(v){
  state.view = v;
  ["book", "search", "active", "done"].forEach(function(k){
    $("v-" + k).classList.toggle("on", k === v);
  });
}
function renderRider(){
  var r = state.myRideId ? Store.get(state.myRideId) : null;
  if (!r) return;

  if (r.status === "searching"){ showRider("search"); return; }

  if (ACTIVE.indexOf(r.status) !== -1){
    showRider("active");
    var d = r.driver || {};
    var au = !!d.autonomous;
    $("a-ava").className = "ava" + (au ? " ai" : "");
    $("a-ava").innerHTML = au
      ? '<svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 0 1 2 2v1h3a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h3V4a2 2 0 0 1 2-2zM9 11a1.6 1.6 0 1 0 0 3.2A1.6 1.6 0 0 0 9 11zm6 0a1.6 1.6 0 1 0 0 3.2A1.6 1.6 0 0 0 15 11z"/></svg>'
      : escapeHtml((d.name || "?").slice(0, 1));
    $("a-name").innerHTML = escapeHtml(d.name || "—") +
      (au ? '<span class="tag">自動運転</span>' : '<span class="tag y">★ ' + escapeHtml(d.rating) + "</span>");
    $("a-car").textContent   = d.car || "—";
    $("a-plate").textContent = d.plate || "—";
    $("a-from").textContent  = short(r.pickup.label, 14);
    $("a-to").textContent    = short(r.dest.label, 14);
    $("a-fare").textContent  = yen(r.total);
    $("a-eta").innerHTML     = r.eta + "<small>分</small>";

    if (r.status === "enroute"){
      $("a-phase").textContent = au ? "自動運転車両が接近中" : "配車確定";
      $("a-msg").textContent   = "お迎えに向かっています";
      $("a-bar").style.width   = "18%";
      $("btn-board").style.display = "none";
    } else if (r.status === "arrived"){
      $("a-phase").textContent = "到着";
      $("a-msg").textContent   = au ? "車両が到着しました。ご乗車ください" : "お客様をお待ちしています";
      $("a-eta").innerHTML     = "0<small>分</small>";
      $("a-bar").style.width   = "34%";
      $("btn-board").style.display = "block";
      $("btn-board").textContent = au ? "乗車する" : "乗車しました";
    } else {
      var total = roadKm(r.pickup, r.dest);
      var remain = r.car ? roadKm(r.car, r.dest) : total;
      var pct = 34 + 66 * Math.max(0, Math.min(1, 1 - remain / Math.max(total, 0.001)));
      $("a-phase").textContent = "乗車中";
      $("a-msg").textContent   = "目的地へ向かっています";
      $("a-bar").style.width   = pct.toFixed(1) + "%";
      $("btn-board").style.display = "none";
    }
    $("btn-cancel-ride").style.display = (r.status === "onboard") ? "none" : "block";
    return;
  }

  if (r.status === "completed"){
    showRider("done");
    $("d-from").textContent  = short(r.pickup.label, 16);
    $("d-to").textContent    = short(r.dest.label, 16);
    $("d-dist").textContent  = r.km.toFixed(1) + " km";
    $("d-base").textContent  = yen(r.base);
    $("d-pick").textContent  = r.pickupFee ? yen(r.pickupFee) : "無料";
    $("d-total").textContent = yen(r.total);
    clearRideCar();
    return;
  }

  if (r.status === "cancelled"){
    state.myRideId = null;
    clearRideCar();
    showRider("book");
  }
}

/* ========== ドライバー側 ========== */
function showDriver(v){
  $("d-register").classList.toggle("on", v === "register");
  $("d-online").classList.toggle("on", v === "online");
}
/** 自分が担当している乗務（保存せずデータから導く） */
function driverRide(){
  if (!Store) return null;
  var list = Store.list();
  for (var i = 0; i < list.length; i++){
    if (list[i].driverId === Store.userId && ACTIVE.indexOf(list[i].status) !== -1) return list[i];
  }
  return null;
}
function renderDriver(){
  if (!driver){ showDriver("register"); return; }
  showDriver("online");
  $("d-who").textContent   = driver.name + "・" + driver.car;
  $("d-onoff").textContent = stats.online ? "オンライン（受注中）" : "オフライン";
  $("btn-online").setAttribute("aria-pressed", stats.online ? "true" : "false");
  $("btn-gps").setAttribute("aria-pressed", state.gps ? "true" : "false");
  $("d-earn").textContent  = yen(stats.earn);
  $("d-trips").textContent = stats.trips;

  var active = driverRide();
  if (active){
    $("d-active-wrap").style.display = "block";
    $("d-req-wrap").style.display = "none";
    $("dv-from").textContent = active.pickup.label;
    $("dv-to").textContent   = active.dest.label;
    $("dv-fare").textContent = yen(active.total * 0.9);
    $("dv-eta").innerHTML    = active.eta + "<small>分</small>";
    if (active.status === "enroute"){
      $("dv-phase").textContent = "迎車中";
      $("dv-msg").textContent   = "お客様のもとへ向かっています";
      $("btn-d-action").textContent = "到着した";
    } else if (active.status === "arrived"){
      $("dv-phase").textContent = "到着済み";
      $("dv-msg").textContent   = "お客様の乗車をお待ちください";
      $("btn-d-action").textContent = "乗車開始";
    } else {
      $("dv-phase").textContent = "乗務中";
      $("dv-msg").textContent   = "目的地へ向かっています";
      $("btn-d-action").textContent = "降車・完了";
    }
    $("btn-d-cancel").style.display = active.status === "onboard" ? "none" : "block";
    return;
  }

  $("d-active-wrap").style.display = "none";
  $("d-req-wrap").style.display = "block";
  var box = $("d-reqs");
  if (!stats.online){
    box.innerHTML = '<div class="empty">オンラインにすると、近くの配車リクエストが表示されます。</div>';
    return;
  }
  var cutoff = Date.now() - OPEN_MIN * 60000;
  var reqs = Store.list().filter(function(r){
    return r.status === "searching" && !CLASSES[r.cls].autonomous && r.createdAt > cutoff;
  });
  if (!reqs.length){
    box.innerHTML = '<div class="empty">現在リクエストはありません。<br>「乗る」タブからスタンダードを依頼すると、ここに表示されます。</div>';
    return;
  }
  box.innerHTML = reqs.map(function(r){
    return '<div class="req" data-id="' + r.id + '">' +
      '<div class="req-top"><div>' +
        '<div class="yen">' + yen(r.total * 0.9) + "</div>" +
        '<div class="mt">' + r.km.toFixed(1) + "km・" + CLASSES[r.cls].name + "</div>" +
      "</div>" +
      '<div class="mt">' + etaMin(state.me, r.pickup) + "分先</div></div>" +
      '<div class="leg"><i class="d a"></i><span>' + escapeHtml(r.pickup.label) + "</span></div>" +
      '<div class="leg"><i class="d b"></i><span>' + escapeHtml(r.dest.label) + "</span></div>" +
      '<button class="cta" style="margin-top:10px;padding:10px;font-size:13.5px">このリクエストを受諾</button>' +
      "</div>";
  }).join("");
  box.onclick = function(e){
    var card = e.target.closest(".req");
    if (!card || !e.target.closest("button")) return;
    acceptRide(card.dataset.id);
  };
}
function acceptRide(id){
  var me = state.me;
  Store.claim(id, {
    name: driver.name, car: driver.car, plate: driver.plate,
    rating: driver.rating, autonomous: false, human: true
  }, { lat: me.lat, lng: me.lng })
  .then(function(r){
    toast(r ? "リクエストを受諾しました" : "このリクエストは他のドライバーが受諾しました");
    render();
  })
  .catch(function(err){
    console.error(err);
    toast("受諾できませんでした。通信状況をご確認ください");
  });
}
function driverAction(){
  var r = driverRide();
  if (!r) return;
  if (r.status === "enroute"){
    push(Store.patch(r.id, { status: "arrived", car: { lat: r.pickup.lat, lng: r.pickup.lng }, eta: 0 }), "到着の通知");
    toast("到着を通知しました");
  } else if (r.status === "arrived"){
    push(Store.patch(r.id, { status: "onboard" }), "乗務の開始");
    toast("乗務を開始しました");
  } else if (r.status === "onboard"){
    onTripCompleted(r);
    push(Store.patch(r.id, { status: "completed" }), "乗務の完了");
    toast("乗務を完了しました");
  }
  render();
}
/** 実測GPSの送信（オンにすると擬似走行を止め、端末の現在地を車両位置として送る） */
function setGps(on){
  state.gps = on;
  if (state.gpsWatch != null){ navigator.geolocation.clearWatch(state.gpsWatch); state.gpsWatch = null; }
  if (!on){ renderDriver(); return; }
  if (!navigator.geolocation){ state.gps = false; toast("この端末では位置情報を利用できません"); renderDriver(); return; }
  state.gpsWatch = navigator.geolocation.watchPosition(function(pos){
    var p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    state.me = p;
    meMarker.setLatLng([p.lat, p.lng]);
    var r = driverRide();
    if (!r) return;
    var target = (r.status === "onboard") ? r.dest : r.pickup;
    push(Store.patch(r.id, { car: p, eta: etaMin(p, target) }), "位置の送信");
  }, function(){
    state.gps = false;
    toast("位置情報を取得できませんでした");
    renderDriver();
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  renderDriver();
}

/* ========== モード ========== */
function setMode(m){
  state.mode = m;
  $("tab-rider").setAttribute("aria-selected", m === "rider" ? "true" : "false");
  $("tab-driver").setAttribute("aria-selected", m === "driver" ? "true" : "false");
  $("pane-rider").classList.toggle("on", m === "rider");
  $("pane-driver").classList.toggle("on", m === "driver");
  render();
}
function render(){ renderRider(); renderDriver(); syncMapRide(); }

/* ========== 評価 ========== */
function renderStars(){
  $("stars").innerHTML = [1,2,3,4,5].map(function(i){
    return '<button data-v="' + i + '" class="' + (i <= state.rating ? "on" : "") + '" aria-label="' + i + '">★</button>';
  }).join("");
}

/* ========== 起動 ========== */
function bindEvents(){
  $("tab-rider").onclick  = function(){ setMode("rider"); };
  $("tab-driver").onclick = function(){ setMode("driver"); };
  $("btn-locate").onclick = locate;
  $("btn-recenter").onclick = function(){ map.setView([state.me.lat, state.me.lng], 16); };
  $("btn-request").onclick = requestRide;
  $("btn-cancel-search").onclick = cancelRide;
  $("btn-cancel-ride").onclick = cancelRide;
  $("btn-board").onclick = function(){
    if (!state.myRideId) return;
    push(Store.patch(state.myRideId, { status: "onboard" }), "乗車の記録");
    render();
  };
  $("btn-finish").onclick = function(){
    state.myRideId = null;
    clearDest();
    $("dest-input").value = "";
    state.rating = 0; renderStars();
    showRider("book");
    renderCars();
  };
  $("dest-input").oninput = function(e){ searchPlaces(e.target.value.trim()); };

  map.on("click", function(e){
    if (state.mode !== "rider" || state.view !== "book") return;
    var p = { lat: e.latlng.lat, lng: e.latlng.lng };
    setDest(p, "地図で指定した地点");
    $("sugg").innerHTML = "";
    reverseGeocode(p, function(name){ if (name) setDest(p, name); });
  });

  $("btn-register").onclick = function(){
    var n = $("f-name").value.trim(), c = $("f-car").value.trim(), p = $("f-plate").value.trim();
    if (!n || !c || !p){ toast("すべての項目を入力してください"); return; }
    driver = { name: n, car: c, plate: p, rating: "4.90" };
    save(K_DRIVER, driver);
    stats.online = true; save(K_STATS, stats);
    toast("ドライバー登録が完了しました");
    renderDriver();
  };
  $("btn-online").onclick = function(){
    stats.online = !stats.online;
    save(K_STATS, stats);
    renderDriver();
  };
  $("btn-gps").onclick = function(){ setGps(!state.gps); };
  $("btn-d-action").onclick = driverAction;
  $("btn-d-cancel").onclick = function(){
    var r = driverRide();
    if (!r) return;
    push(Store.patch(r.id, { status: "searching", driver: null, driverId: null }), "乗務のキャンセル");
    toast("乗務をキャンセルしました");
    render();
  };
  $("stars").onclick = function(e){
    var b = e.target.closest("button");
    if (!b) return;
    state.rating = +b.dataset.v;
    renderStars();
    toast("評価ありがとうございました");
  };
}

/** 再読み込みしても進行中の配車に戻れるようにする */
function resumeRide(){
  var list = Store.list();
  for (var i = list.length - 1; i >= 0; i--){
    var r = list[i];
    if (r.riderId === Store.userId && ACTIVE.indexOf(r.status) !== -1){ state.myRideId = r.id; return; }
  }
}
function showMode(){
  var badge = $("mode-badge");
  if (Store.mode === "supabase"){
    badge.textContent = "オンライン";
    badge.className = "badge on";
    badge.title = "他の端末とマッチングします";
  } else {
    badge.textContent = "ローカル";
    badge.className = "badge";
    badge.title = "この端末の中だけで動作します（ride/config.js を設定するとオンラインになります）";
  }
}

bindEvents();
renderStars();
renderCars();
locate();

JRStore.create(window.JR_CONFIG, function(){
  toast("サーバーに接続できないため、ローカルモードで動作します");
}).then(function(store){
  Store = store;
  state.ready = true;
  Store.onChange(render);
  showMode();
  renderCars();
  resumeRide();
  render();
  setInterval(function(){ driftFleet(); stepRide(); }, TICK_MS);
  // 取りこぼした更新や有効期限切れのリクエストを定期的に均す
  setInterval(function(){ Store.refresh().catch(function(){}); }, 20000);
});

})();
