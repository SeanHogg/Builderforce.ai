import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock agent-events so we can control event emission
const listeners = new Set<(evt: unknown) => void>();
vi.mock("./agent-events.js", () => ({
  onAgentEvent: (fn: (evt: unknown) => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
}));

function emitEvent(evt: Record<string, unknown>) {
  for (const fn of listeners) {
    fn(evt);
  }
}

// Mock callGateway to return a controlled history
const mockHistory: { messages?: unknown[] } = { messages: [] };
vi.mock("../gateway/call.js", () => ({
  callGateway: async () => mockHistory,
}));

vi.mock("../logger.js", () => ({
  logDebug: () => undefined,
}));

// Import AFTER mocks are set up
import { awaitLocalSubagentResult } from "./local-result-broker.js";

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  listeners.clear();
  mockHistory.messages = [];
});

describe("awaitLocalSubagentResult", () => {
  it("resolves with the last assistant message when lifecycle end fires", async () => {
    mockHistory.messages = [
      { role: "user", content: "do the thing" },
      { role: "assistant", content: "Here is the analysis result." },
    ];

    const promise = awaitLocalSubagentResult("run-1", "agent:claude:subagent:abc", 5000);

    // Simulate the lifecycle end event from the agent
    emitEvent({ runId: "run-1", data: { phase: "end" } });

    const output = await promise;
    expect(output).toBe("Here is the analysis result.");
  });

  it("resolves with last assistant message on error phase", async () => {
    mockHistory.messages = [{ role: "assistant", content: "Partial output before error." }];

    const promise = awaitLocalSubagentResult("run-err", "agent:claude:subagent:xyz", 5000);
    emitEvent({ runId: "run-err", data: { phase: "error" } });

    const output = await promise;
    expect(output).toBe("Partial output before error.");
  });

  it("ignores events from other runIds", async () => {
    mockHistory.messages = [{ role: "assistant", content: "correct output" }];

    const promise = awaitLocalSubagentResult("run-target", "agent:claude:subagent:t", 5000);

    // Wrong runId — should be ignored
    emitEvent({ runId: "run-other", data: { phase: "end" } });

    // Correct runId
    emitEvent({ runId: "run-target", data: { phase: "end" } });

    const output = await promise;
    expect(output).toBe("correct output");
  });

  it("ignores non-terminal lifecycle phases", async () => {
    mockHistory.messages = [{ role: "assistant", content: "done" }];

    const promise = awaitLocalSubagentResult("run-phases", "agent:claude:subagent:p", 5000);

    emitEvent({ runId: "run-phases", data: { phase: "start" } });
    emitEvent({ runId: "run-phases", data: { phase: "tool_use" } });
    emitEvent({ runId: "run-phases", data: { phase: "end" } });

    const output = await promise;
    expect(output).toBe("done");
  });

  it("returns empty string when runId is empty", async () => {
    const output = await awaitLocalSubagentResult("", "agent:claude:subagent:x", 5000);
    expect(output).toBe("");
  });

  it("returns empty string when childSessionKey is empty", async () => {
    const output = await awaitLocalSubagentResult("run-1", "", 5000);
    expect(output).toBe("");
  });

  it("times out and returns empty string", async () => {
    const output = await awaitLocalSubagentResult("run-never", "agent:claude:subagent:n", 50);
    expect(output).toBe("");
  });

  it("does not double-resolve if lifecycle fires after timeout", async () => {
    let resolveCount = 0;
    const promise = awaitLocalSubagentResult("run-race", "agent:claude:subagent:r", 30);
    void promise.then(() => resolveCount++);

    await new Promise((r) => setTimeout(r, 60)); // let it time out
    emitEvent({ runId: "run-race", data: { phase: "end" } }); // late arrival

    await promise;
    // Small tick to allow any spurious second resolution
    await new Promise((r) => setTimeout(r, 10));
    expect(resolveCount).toBe(1);
  });

  it("handles content-block array format", async () => {
    mockHistory.messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "First block." },
          { type: "text", text: "Second block." },
        ],
      },
    ];

    const promise = awaitLocalSubagentResult("run-blocks", "agent:claude:subagent:b", 5000);
    emitEvent({ runId: "run-blocks", data: { phase: "end" } });

    const output = await promise;
    expect(output).toBe("First block.\nSecond block.");
  });

  it("returns empty string when history has no assistant messages", async () => {
    mockHistory.messages = [{ role: "user", content: "the task" }];

    const promise = awaitLocalSubagentResult("run-noasst", "agent:claude:subagent:na", 5000);
    emitEvent({ runId: "run-noasst", data: { phase: "end" } });

    const output = await promise;
    expect(output).toBe("");
  });
});
