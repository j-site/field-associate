/* 業種パック：packs/*.md を読む。先頭の --- で囲んだ部分が見出し情報、残りがAIへの指示 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const PACK_DIR = new URL("../packs/", import.meta.url).pathname;

export function parsePack(source) {
  const m = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("パックの先頭に --- で囲んだ見出しがありません");
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const k of ["id", "name", "author", "description"]) {
    if (!meta[k]) throw new Error(`パックの見出しに ${k} がありません`);
  }
  if (!/^[a-z0-9-]+$/.test(meta.id)) throw new Error("id は半角の英小文字・数字・ハイフンだけにしてください");
  return { ...meta, body: m[2].trim() };
}

export function loadPacks(dir = PACK_DIR) {
  const packs = readdirSync(dir).filter(f => f.endsWith(".md")).sort()
    .map(f => parsePack(readFileSync(join(dir, f), "utf8")));
  const ids = new Set();
  for (const p of packs) {
    if (ids.has(p.id)) throw new Error(`パックの id が重複しています: ${p.id}`);
    ids.add(p.id);
  }
  return packs;
}
