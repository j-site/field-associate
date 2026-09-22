#!/usr/bin/env node
/* ============================================================
 *  propfinder CLI
 *
 *    propfinder analyze <file.json>     物件1件を詳細分析
 *    propfinder screen <file.json|.csv> 複数件をスクリーニング
 *    propfinder parse <file.txt>        メール等のテキストから物件情報を抽出
 *    propfinder inbox <file.txt>        テキストを解析してそのまま判定まで通す
 *
 *  オプション:
 *    --config <path>   投資基準・前提条件のJSON
 *    --csv <path>      結果をCSVに書き出す
 *    --json            JSONで出力
 *    --all             足切りで落ちた物件も表示する
 * ============================================================ */

import { readFileSync, writeFileSync } from "node:fs";
import { analyze } from "./src/analyze.js";
import { evaluate, DEFAULT_CRITERIA } from "./src/score.js";
import { parseListing } from "./src/parse/listing.js";
import { formatDetail, formatTable, toCsv } from "./src/report.js";

const args = process.argv.slice(2);
const command = args[0];
const positional = args.slice(1).filter(a => !a.startsWith("--"));
const flag = name => args.includes(`--${name}`);
const option = name => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

function loadConfig() {
  const path = option("config");
  const base = { assumptions: {}, rates: {}, criteria: DEFAULT_CRITERIA };
  if (!path) return base;
  const user = JSON.parse(readFileSync(path, "utf8"));
  return {
    assumptions: { ...base.assumptions, ...(user.assumptions || {}) },
    rates: { ...base.rates, ...(user.rates || {}) },
    criteria: {
      rental: { ...DEFAULT_CRITERIA.rental, ...(user.criteria?.rental || {}) },
      resale: { ...DEFAULT_CRITERIA.resale, ...(user.criteria?.resale || {}) }
    }
  };
}

/** JSON配列 / 単一JSON / CSV のいずれでも物件リストとして読み込む */
function loadProperties(path) {
  const text = readFileSync(path, "utf8");
  if (path.endsWith(".csv")) return parseCsv(text);
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : [data];
}

function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map(h => h.trim());
  const numeric = new Set(["price", "annualRent", "landArea", "buildingArea", "ageYears",
    "rosenka", "landUnitPrice", "renovationCost", "vacancyRate"]);
  return lines.filter(l => l.trim()).map(line => {
    const cells = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      const raw = (cells[i] ?? "").trim();
      if (raw === "") return;
      obj[h] = numeric.has(h) ? Number(raw) : raw;
    });
    return obj;
  });
}
function splitCsvLine(line) {
  const out = [];
  let cur = "", inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuote = false;
      else cur += c;
    } else if (c === '"') inQuote = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function run(properties, config) {
  const results = [];
  const skipped = [];
  for (const p of properties) {
    const missing = ["price", "annualRent", "structure", "ageYears"].filter(k => p[k] == null);
    if (missing.length) {
      skipped.push({ property: p, missing });
      continue;
    }
    const analysis = analyze(p, config.assumptions, config.rates);
    const evaluation = evaluate(analysis, config.criteria, { renovationCost: p.renovationCost });
    results.push({ analysis, evaluation });
  }
  return { results, skipped };
}

function main() {
  const config = loadConfig();

  if (!command || flag("help")) {
    console.log(readFileSync(new URL("./cli.js", import.meta.url), "utf8")
      .split("\n").slice(2, 18).map(l => l.replace(/^ \* ?/, "")).join("\n"));
    return;
  }

  if (command === "parse" || command === "inbox") {
    const text = readFileSync(positional[0], "utf8");
    // 空行2つ以上を物件の区切りとみなす（1通に複数件入っているメール対策）
    const blocks = text.split(/\n\s*\n\s*\n+/).filter(b => b.trim());
    const parsed = blocks.map(b => parseListing(b));

    if (command === "parse") {
      console.log(JSON.stringify(parsed, null, 2));
      return;
    }
    const usable = parsed.filter(p => p.usable);
    const unusable = parsed.filter(p => !p.usable);
    unusable.forEach(p => {
      console.error(`⚠ 情報不足のためスキップ（不足: ${p.missing.join(", ")}）: ${(p.raw || "").trim().split("\n")[0].slice(0, 40)}`);
    });
    outputResults(run(usable, config), config);
    return;
  }

  if (command === "analyze") {
    const properties = loadProperties(positional[0]);
    const { results, skipped } = run(properties, config);
    skipped.forEach(s => console.error(`⚠ 情報不足: ${s.missing.join(", ")}`));
    if (flag("json")) { console.log(JSON.stringify(results, null, 2)); return; }
    results.forEach(r => console.log(formatDetail(r.analysis, r.evaluation) + "\n"));
    return;
  }

  if (command === "screen") {
    const properties = loadProperties(positional[0]);
    outputResults(run(properties, config), config);
    return;
  }

  console.error(`不明なコマンド: ${command}（--help で使い方を表示）`);
  process.exitCode = 1;
}

function outputResults({ results, skipped }, config) {
  skipped.forEach(s => console.error(`⚠ 情報不足のためスキップ: ${s.missing.join(", ")}`));

  const passed = results.filter(r => r.evaluation.recommended !== null);
  const shown = flag("all") ? results : passed;
  shown.sort((a, b) => {
    const sa = Math.max(a.evaluation.rental.score, a.evaluation.resale.score);
    const sb = Math.max(b.evaluation.rental.score, b.evaluation.resale.score);
    return sb - sa;
  });

  if (flag("json")) { console.log(JSON.stringify(shown, null, 2)); return; }

  console.log(`\n検討対象 ${results.length}件 → 基準クリア ${passed.length}件\n`);
  console.log(formatTable(shown));

  const csvPath = option("csv");
  if (csvPath) {
    writeFileSync(csvPath, toCsv(shown), "utf8");
    console.log(`\nCSVを書き出しました: ${csvPath}`);
  }
  if (passed.length) {
    console.log(`\n上位3件の詳細:\n`);
    shown.slice(0, 3).forEach(r => console.log(formatDetail(r.analysis, r.evaluation) + "\n"));
  }
}

main();
