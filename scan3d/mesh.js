/* ============================================================
 *  ScanFix メッシュ処理ユーティリティ
 *
 *  three.js に依存しない、素朴な形式で実装する。
 *    positions … Float32Array、頂点ごとに [x,y,z] のフラット配列
 *    index     … Uint32Array、三角形ごとに3頂点インデックスのフラット配列
 *
 *  スキャンデータ特有の問題（重複頂点・向きの乱れた法線・穴・浮遊ノイズ）
 *  に絞って、単純だが検証しやすいアルゴリズムで対処する。
 * ============================================================ */

/* ---------------- 基本統計 ---------------- */

export function computeBounds(positions) {
  var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (var i = 0; i < positions.length; i += 3) {
    for (var a = 0; a < 3; a++) {
      var v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min: min, max: max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** 符号付き体積の総和。水密でなくても計算できるが、意味を持つのは水密な場合のみ */
export function computeSignedVolume(positions, index) {
  var vol = 0;
  for (var i = 0; i < index.length; i += 3) {
    var a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    var ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    var bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    var cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    vol += (
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx)
    ) / 6;
  }
  return vol;
}

/* ---------------- エッジ・隣接情報 ---------------- */

function edgeKey(a, b) { return a < b ? a * 4294967296 + b : b * 4294967296 + a; }

/**
 * 各エッジ（無向）が何枚の面から使われているかを数える。
 * 加えて、各有向エッジ→それを持つ面index の対応も作る（法線伝播や穴検出に使う）。
 */
function buildEdgeMap(index) {
  var undirected = new Map();   // key -> count
  var directed = new Map();     // "a,b" -> faceIndex（1つの有向エッジは通常1面にしか現れない）
  var faceCount = index.length / 3;
  for (var f = 0; f < faceCount; f++) {
    var a = index[f * 3], b = index[f * 3 + 1], c = index[f * 3 + 2];
    var pairs = [[a, b], [b, c], [c, a]];
    for (var p = 0; p < 3; p++) {
      var u = pairs[p][0], v = pairs[p][1];
      var k = edgeKey(u, v);
      undirected.set(k, (undirected.get(k) || 0) + 1);
      directed.set(u + "," + v, f);
    }
  }
  return { undirected: undirected, directed: directed, faceCount: faceCount };
}

/** 境界エッジ（1面にしか属さない有向エッジ）と、非多様体エッジ（3面以上）を検出 */
export function analyzeEdges(index) {
  var em = buildEdgeMap(index);
  var boundary = [];      // [a,b] の配列（有向、面の巻き順のまま）
  var nonManifold = 0;
  em.undirected.forEach(function (count, key) {
    if (count === 1) {
      // count===1 の無向エッジに対応する有向エッジを directed から拾う
    } else if (count > 2) {
      nonManifold++;
    }
  });
  // 有向エッジ側から境界を拾う（相方の逆向きが存在しないもの）
  em.directed.forEach(function (face, key) {
    var parts = key.split(",");
    var a = +parts[0], b = +parts[1];
    if (!em.directed.has(b + "," + a)) boundary.push([a, b]);
  });
  return { boundaryEdges: boundary, nonManifoldEdgeCount: nonManifold, faceCount: em.faceCount };
}

/* ---------------- 重複頂点の結合（ウェルディング） ---------------- */

/**
 * 空間ハッシュで近接頂点をまとめ、インデックスを張り替える。
 * 未参照になった頂点は詰め直す。
 */
export function weldVertices(positions, index, tolerance) {
  var vCount = positions.length / 3;
  var cell = Math.max(tolerance, 1e-9);
  var buckets = new Map();
  var remap = new Int32Array(vCount).fill(-1);
  var newPositions = [];

  function keyFor(x, y, z) {
    return Math.round(x / cell) + "_" + Math.round(y / cell) + "_" + Math.round(z / cell);
  }

  for (var i = 0; i < vCount; i++) {
    var x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    var found = -1;
    // 3x3x3 近傍セルを走査して閾値内の既存点を探す
    var cx = Math.round(x / cell), cy = Math.round(y / cell), cz = Math.round(z / cell);
    outer:
    for (var dx = -1; dx <= 1 && found < 0; dx++) {
      for (var dy = -1; dy <= 1 && found < 0; dy++) {
        for (var dz = -1; dz <= 1; dz++) {
          var k = (cx + dx) + "_" + (cy + dy) + "_" + (cz + dz);
          var bucket = buckets.get(k);
          if (!bucket) continue;
          for (var b = 0; b < bucket.length; b++) {
            var j = bucket[b];
            var px = newPositions[j * 3], py = newPositions[j * 3 + 1], pz = newPositions[j * 3 + 2];
            var dd = (px - x) * (px - x) + (py - y) * (py - y) + (pz - z) * (pz - z);
            if (dd <= tolerance * tolerance) { found = j; break outer; }
          }
        }
      }
    }
    if (found >= 0) {
      remap[i] = found;
    } else {
      var ni = newPositions.length / 3;
      newPositions.push(x, y, z);
      var k0 = keyFor(x, y, z);
      if (!buckets.has(k0)) buckets.set(k0, []);
      buckets.get(k0).push(ni);
      remap[i] = ni;
    }
  }

  var newIndex = new Uint32Array(index.length);
  var validFaces = 0;
  for (var f = 0; f < index.length; f += 3) {
    var a = remap[index[f]], b = remap[index[f + 1]], c = remap[index[f + 2]];
    if (a === b || b === c || a === c) continue; // 縮退した面は捨てる
    newIndex[validFaces * 3] = a; newIndex[validFaces * 3 + 1] = b; newIndex[validFaces * 3 + 2] = c;
    validFaces++;
  }

  return {
    positions: new Float32Array(newPositions),
    index: newIndex.slice(0, validFaces * 3),
    removedVertices: vCount - newPositions.length / 3,
    removedFaces: index.length / 3 - validFaces
  };
}

/** 重複頂点がどれくらいあるかを見るだけの軽い検査（実際の結合はしない） */
export function countDuplicateVertices(positions, tolerance) {
  var res = weldVertices(positions, new Uint32Array(0), tolerance);
  return res.removedVertices;
}

/* ---------------- 連結成分（孤立した破片の検出） ---------------- */

function buildAdjacency(index, vCount) {
  var adj = new Array(vCount);
  for (var i = 0; i < vCount; i++) adj[i] = [];
  var faceCount = index.length / 3;
  var vertToFaces = new Array(vCount);
  for (i = 0; i < vCount; i++) vertToFaces[i] = [];
  for (var f = 0; f < faceCount; f++) {
    var a = index[f * 3], b = index[f * 3 + 1], c = index[f * 3 + 2];
    vertToFaces[a].push(f); vertToFaces[b].push(f); vertToFaces[c].push(f);
  }
  return vertToFaces;
}

/** 面の連結成分ごとに、所属する面indexの配列を返す（頂点共有でつながっているとみなす） */
export function findComponents(positions, index) {
  var vCount = positions.length / 3;
  var faceCount = index.length / 3;
  var vertToFaces = buildAdjacency(index, vCount);
  var faceVisited = new Uint8Array(faceCount);
  var components = [];

  for (var start = 0; start < faceCount; start++) {
    if (faceVisited[start]) continue;
    var stack = [start];
    faceVisited[start] = 1;
    var faces = [];
    while (stack.length) {
      var f = stack.pop();
      faces.push(f);
      for (var k = 0; k < 3; k++) {
        var v = index[f * 3 + k];
        var list = vertToFaces[v];
        for (var m = 0; m < list.length; m++) {
          var nf = list[m];
          if (!faceVisited[nf]) { faceVisited[nf] = 1; stack.push(nf); }
        }
      }
    }
    components.push(faces);
  }
  return components;
}

/** 面数が全体の閾値未満の小さな連結成分を取り除く（浮遊ノイズの除去） */
export function removeSmallIslands(positions, index, minFaceRatio) {
  var components = findComponents(positions, index);
  if (components.length <= 1) return { positions: positions, index: index, removedComponents: 0, removedFaces: 0 };

  var totalFaces = index.length / 3;
  var threshold = Math.max(4, totalFaces * minFaceRatio);
  var keepFaces = [];
  var removedComponents = 0, removedFaces = 0;
  components.sort(function (a, b) { return b.length - a.length; });
  components.forEach(function (faces, i) {
    // 最大の成分は必ず残す。以降は閾値未満なら間引く
    if (i === 0 || faces.length >= threshold) {
      for (var j = 0; j < faces.length; j++) keepFaces.push(faces[j]);
    } else {
      removedComponents++;
      removedFaces += faces.length;
    }
  });

  var newIndex = new Uint32Array(keepFaces.length * 3);
  for (var i = 0; i < keepFaces.length; i++) {
    var f = keepFaces[i];
    newIndex[i * 3] = index[f * 3];
    newIndex[i * 3 + 1] = index[f * 3 + 1];
    newIndex[i * 3 + 2] = index[f * 3 + 2];
  }
  return compact(positions, newIndex, removedComponents, removedFaces);
}

/** 未参照頂点を詰め直す */
function compact(positions, index, removedComponents, removedFaces) {
  var vCount = positions.length / 3;
  var used = new Uint8Array(vCount);
  for (var i = 0; i < index.length; i++) used[index[i]] = 1;
  var remap = new Int32Array(vCount).fill(-1);
  var newPositions = [];
  var n = 0;
  for (i = 0; i < vCount; i++) {
    if (used[i]) {
      remap[i] = n++;
      newPositions.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    }
  }
  var newIndex = new Uint32Array(index.length);
  for (i = 0; i < index.length; i++) newIndex[i] = remap[index[i]];
  return {
    positions: new Float32Array(newPositions),
    index: newIndex,
    removedComponents: removedComponents || 0,
    removedFaces: removedFaces || 0
  };
}

/* ---------------- 法線の統一 ---------------- */

/**
 * 面の連結成分ごとに、隣接面と巻き順が整合するようBFSで揃える。
 * 最後に成分全体の符号付き体積を見て、内向きになっていれば反転する。
 */
export function unifyNormals(positions, index) {
  var faceCount = index.length / 3;
  var components = findComponents(positions, index);
  var flip = new Uint8Array(faceCount); // 1 = 元の巻き順を反転する
  var visited = new Uint8Array(faceCount);

  // 無向エッジ -> それを持つ面のリスト（各面の「元の」有向方向を記録しておく）
  var edgeFaces = new Map();
  for (var f = 0; f < faceCount; f++) {
    var a = index[f * 3], b = index[f * 3 + 1], c = index[f * 3 + 2];
    var es = [[a, b], [b, c], [c, a]];
    for (var p = 0; p < 3; p++) {
      var k = edgeKey(es[p][0], es[p][1]);
      if (!edgeFaces.has(k)) edgeFaces.set(k, []);
      edgeFaces.get(k).push({ face: f, u: es[p][0], v: es[p][1] });
    }
  }

  components.forEach(function (faces) {
    if (!faces.length) return;
    var stack = [faces[0]];
    visited[faces[0]] = 1;
    while (stack.length) {
      var f = stack.pop();
      var a = index[f * 3], b = index[f * 3 + 1], c = index[f * 3 + 2];
      // 反転している面は、元の3辺すべての向きが逆になる
      var eff = flip[f] ? [[b, a], [c, b], [a, c]] : [[a, b], [b, c], [c, a]];
      for (var p = 0; p < 3; p++) {
        var u = eff[p][0], v = eff[p][1];
        var bucket = edgeFaces.get(edgeKey(u, v)) || [];
        for (var i = 0; i < bucket.length; i++) {
          var nf = bucket[i].face;
          if (nf === f || visited[nf]) continue;
          // 整合するには、隣接面の実効エッジが (v, u)（fの実効エッジの逆）である必要がある。
          // 隣接面の元の方向が (v, u) と同じならそのまま、(u, v) と同じなら反転が要る。
          if (bucket[i].u === u && bucket[i].v === v) flip[nf] = 1;
          else flip[nf] = 0;
          visited[nf] = 1;
          stack.push(nf);
        }
      }
    }
  });

  var flippedCount = 0;

  var newIndex = index.slice();
  for (f = 0; f < faceCount; f++) {
    if (flip[f]) {
      var tmp = newIndex[f * 3 + 1];
      newIndex[f * 3 + 1] = newIndex[f * 3 + 2];
      newIndex[f * 3 + 2] = tmp;
      flippedCount++;
    }
  }

  // 成分ごとに符号付き体積を見て、全体が内向きなら反転する
  var perComponentIndex = components.map(function (faces) {
    var arr = new Uint32Array(faces.length * 3);
    for (var i = 0; i < faces.length; i++) {
      arr[i * 3] = newIndex[faces[i] * 3];
      arr[i * 3 + 1] = newIndex[faces[i] * 3 + 1];
      arr[i * 3 + 2] = newIndex[faces[i] * 3 + 2];
    }
    return { faces: faces, arr: arr };
  });
  perComponentIndex.forEach(function (comp) {
    var vol = computeSignedVolume(positions, comp.arr);
    if (vol < 0) {
      comp.faces.forEach(function (f) {
        var tmp = newIndex[f * 3 + 1];
        newIndex[f * 3 + 1] = newIndex[f * 3 + 2];
        newIndex[f * 3 + 2] = tmp;
      });
      flippedCount += comp.faces.length;
    }
  });

  return { index: newIndex, flippedFaces: flippedCount };
}

/* ---------------- 穴埋め ---------------- */

/** 境界の有向エッジをつないで、閉じたループ（頂点indexの並び）に分解する */
function chainBoundaryLoops(boundaryEdges) {
  var next = new Map(); // a -> b
  boundaryEdges.forEach(function (e) { next.set(e[0], e[1]); });
  var used = new Set();
  var loops = [];
  boundaryEdges.forEach(function (e) {
    if (used.has(e[0])) return;
    var loop = [e[0]];
    used.add(e[0]);
    var cur = e[1];
    var guard = 0;
    while (cur !== e[0] && guard++ < boundaryEdges.length + 1) {
      loop.push(cur);
      used.add(cur);
      var nx = next.get(cur);
      if (nx === undefined) { loop = null; break; } // 開いたまま閉じない異常ケース
      cur = nx;
    }
    if (loop && loop.length >= 3) loops.push(loop);
  });
  return loops;
}

/** ループ頂点を平面近似し、法線を得る（Newellの方法） */
function loopNormal(loop, positions) {
  var nx = 0, ny = 0, nz = 0;
  for (var i = 0; i < loop.length; i++) {
    var a = loop[i] * 3, b = loop[(i + 1) % loop.length] * 3;
    var ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    var bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  var len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** 単純多角形のイヤークリッピング（2D）。凸・凹どちらも扱える簡易実装 */
function earClipPolygon2D(pts) {
  var idx = pts.map(function (_, i) { return i; });
  var tris = [];
  function area2(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }
  function pointInTri(p, a, b, c) {
    var d1 = area2(p, a, b), d2 = area2(p, b, c), d3 = area2(p, c, a);
    var hasNeg = d1 < 0 || d2 < 0 || d3 < 0, hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  }
  var guard = 0;
  while (idx.length > 3 && guard++ < pts.length * pts.length) {
    var earFound = false;
    for (var i = 0; i < idx.length; i++) {
      var i0 = idx[(i - 1 + idx.length) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      var a = pts[i0], b = pts[i1], c = pts[i2];
      if (area2(a, b, c) <= 1e-12) continue; // 凹または縮退
      var ok = true;
      for (var j = 0; j < idx.length; j++) {
        var pj = idx[j];
        if (pj === i0 || pj === i1 || pj === i2) continue;
        if (pointInTri(pts[pj], a, b, c)) { ok = false; break; }
      }
      if (!ok) continue;
      tris.push([i0, i1, i2]);
      idx.splice(i, 1);
      earFound = true;
      break;
    }
    if (!earFound) break; // 数値誤差で行き詰まった場合は打ち切る（部分的な穴埋めになる）
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

/**
 * 境界ループをすべて検出し、各ループを平面近似→イヤークリッピングで三角形分割して埋める。
 * 大穴（頂点数が多すぎる = ループというより開口部全体の輪郭）は誤爆を避けるため対象外にできる。
 */
export function fillHoles(positions, index, maxLoopVerts) {
  var analysis = analyzeEdges(index);
  var loops = chainBoundaryLoops(analysis.boundaryEdges);
  var addedTris = [];
  var filledLoops = 0, skippedLoops = 0;

  loops.forEach(function (loop) {
    if (maxLoopVerts && loop.length > maxLoopVerts) { skippedLoops++; return; }

    var normal = loopNormal(loop, positions);
    // 法線に直交する2軸を作り、ループ頂点を2Dへ投影する
    var up = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    var ex = normalize(cross(up, normal));
    var ey = cross(normal, ex);
    var pts2d = loop.map(function (vi) {
      var p = [positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]];
      return [dot(p, ex), dot(p, ey)];
    });

    var tris = earClipPolygon2D(pts2d);
    if (!tris.length) { skippedLoops++; return; }

    // ループは既存メッシュの巻き順（a→b→c→…）で走査したものなので、
    // 埋める三角形はその逆順にすると外向き法線が既存メッシュと整合する
    tris.forEach(function (t) {
      addedTris.push(loop[t[0]], loop[t[2]], loop[t[1]]);
    });
    filledLoops++;
  });

  if (!addedTris.length) return { positions: positions, index: index, filledLoops: 0, skippedLoops: skippedLoops, addedFaces: 0 };

  var newIndex = new Uint32Array(index.length + addedTris.length);
  newIndex.set(index);
  newIndex.set(addedTris, index.length);
  return { positions: positions, index: newIndex, filledLoops: filledLoops, skippedLoops: skippedLoops, addedFaces: addedTris.length / 3 };
}

function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function normalize(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

/* ---------------- スケール・配置 ---------------- */

export function scalePositions(positions, factor) {
  var out = new Float32Array(positions.length);
  for (var i = 0; i < positions.length; i++) out[i] = positions[i] * factor;
  return out;
}

/** 中心をXY原点に、最下点をZ=0に揃える */
export function groundAndCenter(positions) {
  var b = computeBounds(positions);
  var cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = b.min[2];
  var out = new Float32Array(positions.length);
  for (var i = 0; i < positions.length; i += 3) {
    out[i] = positions[i] - cx;
    out[i + 1] = positions[i + 1] - cy;
    out[i + 2] = positions[i + 2] - cz;
  }
  return out;
}
