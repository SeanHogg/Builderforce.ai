/**
 * Example: Basic task submission and monitoring
 */

import type { SpawnSubagentContext } from "../../src/agents/subagent-spawn.js";
import { BuilderForceAgentsRuntime, LocalTransportAdapter } from "../../src/transport/index.js";

async function main() {
  // Create a mock context for the example
  const mockContext: SpawnSubagentContext = {
    sessionKey: "example-session",
    config: {} as unknown,
    deps: {} as unknown,
    agentId: "general-purpose",
  } as SpawnSubagentContext;

  // Create runtime with local adapter
  const adapter = new LocalTransportAdapter(mockContext);
  const runtime = new BuilderForceAgentsRuntime(adapter, "local-only");

  console.log("=== builderForceAgents Phase 2 Example ===\n");

  // Get runtime status
  const status = await runtime.getStatus();
  console.log("Runtime Status:");
  console.log(`  Mode: ${status.mode}`);
  console.log(`  Version: ${status.version}`);
  console.log(`  Active Tasks: ${status.activeTasks}`);
  console.log(`  Total Tasks: ${status.totalTasks}\n`);

  // List available agents
  console.log("Available Agents:");
  const agents = await runtime.listAgents();
  agents.forEach((agent) => {
    console.log(`  - ${agent.name} (${agent.id})`);
    console.log(`    ${agent.description}`);
  });
  console.log();

  // List available skills
  console.log("Available Skills:");
  const skills = await runtime.listSkills();
  skills.forEach((skill) => {
    console.log(`  - ${skill.name} (${skill.id})`);
    console.log(`    Version: ${skill.version}, Enabled: ${skill.enabled}`);
  });
  console.log();

  // Submit a task
  console.log("Submitting task...");
  const task = await runtime.submitTask({
    description: "Example task",
    input: "This is an example task to demonstrate Phase 2 capabilities",
    agentId: "general-purpose",
    metadata: {
      priority: "normal",
      source: "example",
    },
  });

  console.log(`Task created: ${task.id}`);
  console.log(`Status: ${task.status}\n`);

  // Monitor task progress
  console.log("Monitoring task progress:");
  try {
    for await (const update of runtime.streamTaskUpdates(task.id)) {
      console.log(
        `  [${update.timestamp.toISOString()}] Status: ${update.status}${
          update.progress ? ` (${update.progress}%)` : ""
        }`,
      );

      if (update.status === "completed" || update.status === "failed") {
        break;
      }
    }
  } catch {
    console.log("  Task monitoring complete");
  }

  // Get final task state
  const finalTask = await runtime.getTaskState(task.id);
  console.log("\nFinal Task State:");
  console.log(`  Status: ${finalTask?.status}`);
  console.log(`  Created: ${finalTask?.createdAt.toISOString()}`);
  if (finalTask?.completedAt) {
    console.log(`  Completed: ${finalTask.completedAt.toISOString()}`);
  }
  if (finalTask?.output) {
    console.log(`  Output: ${finalTask.output}`);
  }
  if (finalTask?.error) {
    console.log(`  Error: ${finalTask.error}`);
  }

  // Close runtime
  await runtime.close();
  console.log("\nExample complete!");
}

main().catch(console.error);
