#!/usr/bin/env node
import { Command } from "commander";
import { AGENTS } from "../src/agents.js";
import { runPipeline } from "../src/orchestrator.js";

const program = new Command();

program
  .name("jarvis")
  .description("JarvisAgents 2.0 - CLI multi-agent orchestration tool powered by Claude")
  .version("2.0.0");

program
  .command("list")
  .description("List available agents in the pipeline")
  .action(() => {
    for (const agent of AGENTS) {
      console.log(`- ${agent.name}: ${agent.label}`);
    }
  });

program
  .command("run <task>")
  .description("Run the full agent pipeline (planner -> executor -> reviewer) on a task")
  .option("-m, --model <model>", "Claude model to use", "claude-sonnet-5")
  .action(async (task, options) => {
    try {
      await runPipeline(task, {
        model: options.model,
        onStep: (agent, output) => {
          console.log(`\n=== ${agent.label} ===`);
          console.log(output);
        },
      });
    } catch (err) {
      console.error(`エラー: ${err.message}`);
      process.exitCode = 1;
    }
  });

program.parse();
