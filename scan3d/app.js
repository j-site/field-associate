/* ============================================================
 *  ScanFix アプリ本体
 * ============================================================ */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { SimplifyModifier } from "three/addons/modifiers/SimplifyModifier.js";
import * as Mesh from "./mesh.js";

/* ========== 小道具 ========== */
function $(id) { return document.getElementById(id); }
var toastT = null;
function toast(msg, isErr) {
  var el = $("toast");
  el.textContent = msg;
  el.classList.toggle("err", !!isErr);
  el.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(function () { el.classList.remove("on"); }, 3200);
}
function fmtNum(n) { return Math.round(n).toLocaleString("ja-JP"); }
function nextPaint() {
  return new Promise(function (res) {
    requestAnimationFrame(function () { requestAnimationFrame(res); });
  });
}

/* ========== シーン ========== */
var wrap = $("canvas-wrap");
var scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5f6f8);

var camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
camera.up.set(0, 0, 1); // プリント慣習に合わせ Z を上として扱う

var renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
wrap.appendChild(renderer.domElement);

var controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.AmbientLight(0xffffff, 0.65));
var key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(1, -1, 2);
scene.add(key);
var fill = new THREE.DirectionalLight(0xffffff, 0.35);
fill.position.set(-1, 1, 1);
scene.add(fill);

// 印刷プレートを表す XY 平面のグリッド（GridHelperは既定でXZ平面なのでXへ90度回す）
var grid = new THREE.GridHelper(400, 40, 0xd8dadf, 0xeef0f3);
grid.rotation.x = Math.PI / 2;
grid.position.z = 0;
scene.add(grid);

var material = new THREE.MeshStandardMaterial({
  color: 0xd8dbe0, metalness: 0.05, roughness: 0.75, side: THREE.DoubleSide, flatShading: false
});
var wireMaterial = new THREE.MeshBasicMaterial({ color: 0x16181d, wireframe: true, transparent: true, opacity: 0.35 });
var currentMesh = null;      // THREE.Mesh（表示用）
var wireMesh = null;
var state = null;            // { positions:Float32Array, index:Uint32Array }

function resize() {
  var w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(wrap);
resize();

(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();

/* ========== メッシュ状態 ⇄ 表示 ========== */
function setState(positions, index, opts) {
  state = { positions: positions, index: index };
  rebuildDisplay();
  runChecks();
  updateStatsPanel();
  if (!opts || !opts.keepView) fitView();
}
function rebuildDisplay() {
  if (currentMesh) { scene.remove(currentMesh); currentMesh.geometry.dispose(); }
  if (wireMesh) { scene.remove(wireMesh); wireMesh.geometry.dispose(); }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(state.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(state.index, 1));
  geo.computeVertexNormals();
  currentMesh = new THREE.Mesh(geo, material);
  scene.add(currentMesh);
  wireMesh = new THREE.Mesh(geo, wireMaterial);
  wireMesh.visible = wireOn;
  scene.add(wireMesh);
}
function fitView() {
  var b = Mesh.computeBounds(state.positions);
  var cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  var radius = Math.max(0.001, Math.hypot(b.size[0], b.size[1], b.size[2]) / 2);
  controls.target.set(cx, cy, cz);
  camera.position.set(cx + radius * 1.6, cy - radius * 1.6, cz + radius * 1.1);
  camera.near = radius / 100;
  camera.far = radius * 100;
  camera.updateProjectionMatrix();
  controls.update();
  grid.scale.setScalar(Math.max(1, radius / 100));
}

/* ========== 読み込み ========== */
function toIndexedArrays(geometry) {
  var posAttr = geometry.getAttribute("position");
  var positions = new Float32Array(posAttr.array); // コピーして独立させる
  var index;
  if (geometry.index) {
    index = new Uint32Array(geometry.index.array);
  } else {
    index = new Uint32Array(posAttr.count);
    for (var i = 0; i < posAttr.count; i++) index[i] = i;
  }
  return { positions: positions, index: index };
}

function loadFile(file) {
  var ext = (file.name.split(".").pop() || "").toLowerCase();
  if (["obj", "stl", "ply"].indexOf(ext) === -1) {
    toast("対応形式は OBJ / STL / PLY です", true);
    return;
  }
  var reader = new FileReader();
  reader.onerror = function () { toast("ファイルを読み込めませんでした", true); };
  reader.onload = function () {
    try {
      var raw;
      if (ext === "obj") {
        var text = new TextDecoder().decode(reader.result);
        var group = new OBJLoader().parse(text);
        var geo = firstGeometry(group);
        raw = toIndexedArrays(geo);
      } else if (ext === "stl") {
        var geo2 = new STLLoader().parse(reader.result);
        raw = toIndexedArrays(geo2); // STLは元々非indexed（頂点共有なし）
      } else {
        var geo3 = new PLYLoader().parse(reader.result);
        raw = toIndexedArrays(geo3);
      }
      onMeshLoaded(raw, file.name);
    } catch (err) {
      console.error(err);
      toast("ファイルの解析に失敗しました：" + (err && err.message ? err.message : "不明なエラー"), true);
    }
  };
  if (ext === "obj") reader.readAsArrayBuffer(file); else reader.readAsArrayBuffer(file);
}
function firstGeometry(group) {
  var found = null;
  group.traverse(function (o) { if (!found && o.isMesh) found = o.geometry; });
  if (!found) throw new Error("メッシュが見つかりませんでした");
  return found;
}

async function onMeshLoaded(raw, filename) {
  showProgress("読み込み中…");
  await nextPaint();
  try {
    // STL/OBJ/PLY は頂点が共有されていないことが多く、そのままでは位相情報が無い。
    // まずバウンディングボックスに応じた極小の許容誤差でウェルディングし、連結性を復元する。
    var bounds = Mesh.computeBounds(raw.positions);
    var diag = Math.hypot(bounds.size[0], bounds.size[1], bounds.size[2]) || 1;
    var tol = diag * 1e-5;
    var welded = Mesh.weldVertices(raw.positions, raw.index, tol);
    setState(welded.positions, welded.index);
    $("filename").textContent = filename;
    $("panel-empty").style.display = "none";
    $("panel-loaded").style.display = "block";
    $("drop").classList.add("hide");
    $("hud").style.display = "flex";
    $("view-tools").style.display = "flex";
    $("btn-reset").style.display = "inline-flex";
    setHud("ok", "読み込み完了");
    toast("読み込みました：" + filename);
  } finally {
    hideProgress();
  }
}

function resetApp() {
  if (currentMesh) { scene.remove(currentMesh); currentMesh.geometry.dispose(); currentMesh = null; }
  if (wireMesh) { scene.remove(wireMesh); wireMesh.geometry.dispose(); wireMesh = null; }
  state = null;
  $("filename").textContent = "";
  $("panel-empty").style.display = "block";
  $("panel-loaded").style.display = "none";
  $("drop").classList.remove("hide");
  $("hud").style.display = "none";
  $("view-tools").style.display = "none";
  $("btn-reset").style.display = "none";
  resetOpUI();
}

/* ========== 進捗表示 ========== */
function showProgress(label) {
  $("progress").classList.add("on");
  $("progress-label").textContent = label;
  $("progress-pct").textContent = "";
  $("progress-bar").style.width = "12%";
  requestAnimationFrame(function () { $("progress-bar").style.width = "78%"; });
}
function hideProgress() {
  $("progress-bar").style.width = "100%";
  setTimeout(function () { $("progress").classList.remove("on"); $("progress-bar").style.width = "0%"; }, 220);
}
function setHud(kind, text) {
  $("hud-dot").className = "d " + kind;
  $("hud-text").textContent = text;
}

/* ========== 統計・チェック ========== */
function updateStatsPanel() {
  var b = Mesh.computeBounds(state.positions);
  $("st-verts").textContent = fmtNum(state.positions.length / 3);
  $("st-faces").textContent = fmtNum(state.index.length / 3);
  $("st-size").innerHTML = b.size.map(function (v) { return v.toFixed(1); }).join(" × ") + "<small> mm相当</small>";
  var vol = Mesh.computeSignedVolume(state.positions, state.index);
  var cc3 = Math.abs(vol) / 1000;
  $("st-vol").innerHTML = (cc3 >= 0.05 ? cc3.toFixed(2) : "< 0.01") + "<small> cm³</small>";
}
function setPill(id, kind, text) {
  var el = $(id);
  el.className = "pill " + kind;
  el.textContent = text;
}
function runChecks() {
  var edges = Mesh.analyzeEdges(state.index);
  var openLoops = countLoopsApprox(edges.boundaryEdges);
  if (edges.boundaryEdges.length === 0) setPill("chk-watertight", "ok", "水密");
  else setPill("chk-watertight", "bad", openLoops + "箇所の穴");

  var vol = Mesh.computeSignedVolume(state.positions, state.index);
  if (edges.boundaryEdges.length > 0) setPill("chk-normals", "idle", "穴を塞ぐと検査可");
  else if (vol > 0) setPill("chk-normals", "ok", "外向きで統一");
  else setPill("chk-normals", "warn", "裏返りの疑い");

  var components = Mesh.findComponents(state.positions, state.index);
  if (components.length <= 1) setPill("chk-islands", "ok", "1つの塊");
  else {
    var sorted = components.map(function (f) { return f.length; }).sort(function (a, b) { return b - a; });
    var smallCount = sorted.length - 1;
    setPill("chk-islands", smallCount > 0 ? "warn" : "ok", components.length + "個の破片");
  }

  var dup = Mesh.countDuplicateVertices(state.positions, Math.max(1e-6, boundsDiag() * 1e-6));
  setPill("chk-dup", dup > 0 ? "warn" : "ok", dup > 0 ? dup + "点" : "なし");

  var okCount = [edges.boundaryEdges.length === 0, vol > 0 || edges.boundaryEdges.length > 0, components.length <= 1, dup === 0].filter(Boolean).length;
  $("check-summary").textContent = okCount + " / 4 クリア";
}
function boundsDiag() {
  var b = Mesh.computeBounds(state.positions);
  return Math.hypot(b.size[0], b.size[1], b.size[2]) || 1;
}
/** 境界エッジ数からおおよそのループ数を見積もる（正確な数はfillHoles実行時に判明する） */
function countLoopsApprox(boundaryEdges) {
  if (!boundaryEdges.length) return 0;
  var next = new Map();
  boundaryEdges.forEach(function (e) { next.set(e[0], e[1]); });
  var used = new Set(), loops = 0;
  boundaryEdges.forEach(function (e) {
    if (used.has(e[0])) return;
    var cur = e[0], guard = 0;
    do { used.add(cur); cur = next.get(cur); guard++; } while (cur !== undefined && cur !== e[0] && guard < boundaryEdges.length + 1);
    loops++;
  });
  return loops;
}

/* ========== 修復オペレーション ========== */
function markDone(opId) { $(opId).classList.add("done"); }
function resetOpUI() {
  ["op-weld", "op-islands", "op-normals", "op-holes", "op-simplify"].forEach(function (id) {
    $(id).classList.remove("done");
  });
  $("val-islands").textContent = "—";
  $("val-holes").textContent = "—";
}

var WELD_MM = { "1": 0.05, "2": 0.2, "3": 0.5, "4": 1.0 };
$("rng-weld").oninput = function (e) { $("val-weld").textContent = WELD_MM[e.target.value] + "mm"; };
$("btn-weld").onclick = async function () {
  var mm = WELD_MM[$("rng-weld").value];
  showProgress("近接頂点を結合中…"); await nextPaint();
  try {
    var res = Mesh.weldVertices(state.positions, state.index, mm);
    setState(res.positions, res.index, { keepView: true });
    markDone("op-weld");
    toast(res.removedVertices > 0 ? res.removedVertices + "個の頂点を結合しました" : "結合できる頂点はありませんでした");
  } finally { hideProgress(); }
};

$("btn-islands").onclick = async function () {
  showProgress("孤立した破片を検索中…"); await nextPaint();
  try {
    var componentsBefore = Mesh.findComponents(state.positions, state.index).length;
    var res = Mesh.removeSmallIslands(state.positions, state.index, 0.03);
    setState(res.positions, res.index, { keepView: true });
    markDone("op-islands");
    var totalComponents = componentsBefore;
    $("val-islands").textContent = res.removedComponents + "個除去";
    if (res.removedComponents > 0) {
      toast(res.removedComponents + "個の破片（" + res.removedFaces + "面）を除去しました");
    } else if (totalComponents > 1) {
      toast("本体に対して大きい破片のため自動削除を見送りました（本体の一部を誤って消さないための安全策です）");
    } else {
      toast("孤立した破片は見つかりませんでした");
    }
  } finally { hideProgress(); }
};

$("btn-normals").onclick = async function () {
  showProgress("法線の向きを解析中…"); await nextPaint();
  try {
    var res = Mesh.unifyNormals(state.positions, state.index);
    setState(state.positions, res.index, { keepView: true });
    markDone("op-normals");
    toast(res.flippedFaces > 0 ? res.flippedFaces + "面の向きを修正しました" : "法線はすでに揃っていました");
  } finally { hideProgress(); }
};

$("btn-holes").onclick = async function () {
  showProgress("境界ループを検出して穴を塞いでいます…"); await nextPaint();
  try {
    var res = Mesh.fillHoles(state.positions, state.index, 300);
    setState(res.positions, res.index, { keepView: true });
    markDone("op-holes");
    $("val-holes").textContent = res.filledLoops + "箇所埋めた";
    if (res.filledLoops === 0 && res.skippedLoops === 0) toast("塞ぐべき穴は見つかりませんでした");
    else toast(res.filledLoops + "箇所の穴を塞ぎました" + (res.skippedLoops ? "（" + res.skippedLoops + "箇所は複雑すぎるためスキップ）" : ""));
  } finally { hideProgress(); }
};

$("rng-simplify").oninput = function (e) { $("val-simplify").textContent = e.target.value + "%削減"; };
$("btn-simplify").onclick = async function () {
  var faceCount = state.index.length / 3;
  if (faceCount > 200000) {
    toast("面数が多すぎるため軽量化をスキップしました（20万面以下で実行できます）", true);
    return;
  }
  var reduceRatio = +$("rng-simplify").value / 100;
  showProgress("面数を削減中…（メッシュが大きいと時間がかかります）"); await nextPaint();
  try {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(state.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(state.index, 1));
    var vertCount = geo.getAttribute("position").count;
    var targetRemove = Math.max(1, Math.floor(vertCount * reduceRatio));
    var modifier = new SimplifyModifier();
    var simplified = modifier.modify(geo, targetRemove);
    var raw = toIndexedArrays(simplified);
    setState(raw.positions, raw.index, { keepView: true });
    markDone("op-simplify");
    toast("面数を削減しました（" + fmtNum(state.index.length / 3) + " 面）");
  } catch (err) {
    console.error(err);
    toast("軽量化に失敗しました。先に近接頂点の結合をお試しください", true);
  } finally { hideProgress(); }
};

$("btn-scale").onclick = function () {
  var target = +$("in-scale-mm").value;
  if (!(target > 0)) { toast("正しい数値を入力してください", true); return; }
  var b = Mesh.computeBounds(state.positions);
  var maxDim = Math.max(b.size[0], b.size[1], b.size[2]) || 1;
  var factor = target / maxDim;
  setState(Mesh.scalePositions(state.positions, factor), state.index, { keepView: true });
  toast("最大辺を " + target + "mm に合わせました");
};
$("btn-ground").onclick = function () {
  setState(Mesh.groundAndCenter(state.positions), state.index, { keepView: true });
  toast("底面をプレートに接地しました");
};

/* ========== 書き出し ========== */
function download(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}
$("btn-export-stl").onclick = function () {
  if (!state) return;
  var bin = new STLExporter().parse(currentMesh, { binary: true });
  download(new Blob([bin], { type: "application/sla" }), baseName() + "_repaired.stl");
  toast("STLを書き出しました");
};
$("btn-export-obj").onclick = function () {
  if (!state) return;
  var text = new OBJExporter().parse(currentMesh);
  download(new Blob([text], { type: "text/plain" }), baseName() + "_repaired.obj");
  toast("OBJを書き出しました");
};
function baseName() {
  var n = $("filename").textContent || "scan";
  return n.replace(/\.[^.]+$/, "");
}

/* ========== 表示ツール ========== */
var wireOn = false;
$("vt-wire").onclick = function () {
  wireOn = !wireOn;
  $("vt-wire").setAttribute("aria-pressed", wireOn ? "true" : "false");
  if (wireMesh) wireMesh.visible = wireOn;
};
$("vt-fit").onclick = function () { if (state) fitView(); };

/* ========== ファイル入出力UI ========== */
var fileInput = $("file-input");
function pickFile() { fileInput.click(); }
$("btn-open").onclick = pickFile;
$("btn-open-2").onclick = pickFile;
$("btn-reset").onclick = resetApp;
fileInput.onchange = function (e) { if (e.target.files[0]) loadFile(e.target.files[0]); fileInput.value = ""; };

var drop = $("drop");
["dragenter", "dragover"].forEach(function (ev) {
  drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("drag"); });
});
["dragleave", "drop"].forEach(function (ev) {
  drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("drag"); });
});
drop.addEventListener("drop", function (e) {
  var f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});
// ビューア内どこにドロップしても読み込めるようにする（ロード後は drop 要素が隠れるため）
wrap.addEventListener("dragover", function (e) { e.preventDefault(); });
wrap.addEventListener("drop", function (e) {
  e.preventDefault();
  var f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});

resize();
