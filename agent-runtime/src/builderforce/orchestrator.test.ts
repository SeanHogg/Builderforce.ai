import { describe, expect, it } from "vitest";
import type {
  AgentTransportDispatchPayload,
  AgentTransportDispatchResult,
  AgentTransportEntry,
  IAgentTransport,
} from "./ports.js";
import { AgentOrchestrator } from "./orchestrator.js";

/** Transport stub that fails the first `failTimes` dispatches, then succeeds. */
class FlakyTransport implements IAgentTransport {
  calls = 0;
  constructor(
    private readonly failTimes: number,
    private readonly output = "ok",
  ) {}
  discover(): Promise<AgentTransportEntry[]> {
    return Promise.resolve([]);
  }
  dispatch(_payload: AgentTransportDispatchPayload): Promise<AgentTransportDispatchResult> {
    this.calls++;
    if (this.calls <= this.failTimes) {
      return Promise.resolve({ status: "failed", error: `boom ${this.calls}` });
    }
    return Promise.resolve({ status: "accepted", targetId: "local", output: this.output });
  }
}

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

  it("self-heals: retries a failed task within the budget and completes the workflow", async () => {
    const orchestrator = new AgentOrchestrator();
    // Fail once, succeed on the retry (default budget = 2 retries).
    orchestrator.configure({ agentTransport: new FlakyTransport(1) });
    const workflow = orchestrator.createWorkflow([{ role: "code-creator", task: "Task A" }]);

    const results = await orchestrator.executeWorkflow(workflow.id, {});

    const task = Array.from(workflow.tasks.values())[0];
    expect(task?.status).toBe("completed");
    expect(task?.attempts).toBe(2); // first try + one retry
    expect(workflow.status).toBe("completed");
    expect(Array.from(results.values())).toEqual(["ok"]);
  }, 20_000);

  it("marks the workflow failed only after retries are exhausted", async () => {
    const orchestrator = new AgentOrchestrator();
    // Always fails — should exhaust the budget (1 initial + 2 retries = 3 attempts).
    const transport = new FlakyTransport(99);
    orchestrator.configure({ agentTransport: transport });
    const workflow = orchestrator.createWorkflow([{ role: "code-creator", task: "Task A" }]);

    await orchestrator.executeWorkflow(workflow.id, {});

    const task = Array.from(workflow.tasks.values())[0];
    expect(task?.status).toBe("failed");
    expect(task?.attempts).toBe(3);
    expect(task?.lastError).toContain("boom");
    expect(workflow.status).toBe("failed");
    expect(transport.calls).toBe(3);
  }, 20_000);
});
