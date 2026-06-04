import { describe, expect, it } from "vitest";
import { AgentOrchestrator } from "./orchestrator.js";

describe("AgentOrchestrator", () => {
  it("resolves step dependencies to task IDs", () => {
    const orchestrator = new AgentOrchestrator();
    const workflow = orchestrator.createWorkflow([
      { role: "code-creator", task: "Task A" },
      { role: "code-reviewer", task: "Task B", dependsOn: ["Task A"] },
    ]);

    const tasks = Array.from(workflow.tasks.values());
    const taskA = tasks.find((task) => task.description === "Task A");
    const taskB = tasks.find((task) => task.description === "Task B");

    expect(taskA).toBeDefined();
    expect(taskB).toBeDefined();
    expect(taskB?.dependencies).toEqual([taskA?.id]);
  });

  it("returns runnable pending tasks whose dependencies are complete", () => {
    const orchestrator = new AgentOrchestrator();
    const workflow = orchestrator.createWorkflow([
      { role: "code-creator", task: "Task A" },
      { role: "code-reviewer", task: "Task B", dependsOn: ["Task A"] },
    ]);

    const tasks = Array.from(workflow.tasks.values());
    const taskA = tasks.find((task) => task.description === "Task A");
    const taskB = tasks.find((task) => task.description === "Task B");

    const runnableBefore = orchestrator.getRunnableTasks(workflow.id);
    expect(runnableBefore.map((task) => task.description)).toEqual(["Task A"]);

    if (taskA) {
      taskA.status = "completed";
    }
    const runnableAfter = orchestrator.getRunnableTasks(workflow.id);
    expect(runnableAfter.map((task) => task.description)).toEqual(["Task B"]);

    if (taskB) {
      taskB.status = "running";
    }
    const runnableWhenRunning = orchestrator.getRunnableTasks(workflow.id);
    expect(runnableWhenRunning).toHaveLength(0);
  });
});
