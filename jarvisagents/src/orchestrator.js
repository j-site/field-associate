import Anthropic from "@anthropic-ai/sdk";
import { AGENTS } from "./agents.js";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set. Please set it before running JarvisAgents."
    );
  }
  return new Anthropic({ apiKey });
}

async function callAgent(client, agent, userContent, model) {
  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    system: agent.systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export async function runPipeline(task, { model = "claude-sonnet-5", onStep } = {}) {
  const client = getClient();
  let context = task;
  const results = [];

  for (const agent of AGENTS) {
    const output = await callAgent(client, agent, context, model);
    results.push({ agent: agent.name, output });
    if (onStep) onStep(agent, output);
    context = `# 元のタスク\n${task}\n\n# ${agent.label}の出力\n${output}\n\n上記を踏まえて続けてください。`;
  }

  return results;
}
