/* 環境変数から部品を組み立てる（Vercel でも常駐サーバーでも共通） */
import Anthropic from "@anthropic-ai/sdk";
import { createLine } from "./line.js";
import { createAI, DEFAULT_MODEL } from "./ai.js";
import { createLedger } from "./ledger.js";
import { loadPacks } from "./packs.js";

export function createDeps(env = process.env) {
  for (const k of ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN", "ANTHROPIC_API_KEY"]) {
    if (!env[k]) throw new Error(`環境変数 ${k} が設定されていません`);
  }
  return {
    channelSecret: env.LINE_CHANNEL_SECRET,
    line: createLine({ token: env.LINE_CHANNEL_ACCESS_TOKEN }),
    ai: createAI({
      client: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 280_000 }),
      model: env.CLAUDE_MODEL || DEFAULT_MODEL,
      effort: env.CLAUDE_EFFORT || "medium"
    }),
    ledger: createLedger({ supabaseUrl: env.SUPABASE_URL, supabaseKey: env.SUPABASE_SERVICE_KEY, salt: env.LINE_CHANNEL_SECRET }),
    packs: loadPacks()
  };
}
