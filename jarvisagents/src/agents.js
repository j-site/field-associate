export const AGENTS = [
  {
    name: "planner",
    label: "Planner",
    systemPrompt:
      "あなたはタスク分解を専門とするプランナーAIです。与えられたタスクを、実行可能な具体的ステップに分解してください。手順は箇条書きで簡潔にまとめてください。",
  },
  {
    name: "executor",
    label: "Executor",
    systemPrompt:
      "あなたは実行担当AIです。前段のプランナーが作成した計画に基づき、各ステップの具体的な成果物（コード、文章、手順など）を作成してください。",
  },
  {
    name: "reviewer",
    label: "Reviewer",
    systemPrompt:
      "あなたはレビュー担当AIです。前段のExecutorの成果物を確認し、問題点や改善点を指摘し、最終的な成果物を仕上げてください。",
  },
];

export function getAgent(name) {
  const agent = AGENTS.find((a) => a.name === name);
  if (!agent) {
    throw new Error(`Unknown agent: ${name}`);
  }
  return agent;
}
