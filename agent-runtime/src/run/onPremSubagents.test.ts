import { describe, expect, it, vi } from "vitest";
import type { ModelRequest, ModelTransport, RunOutcomeRow, RunPolicy } from "@builderforce/agent-run";
import type { Capability, CapabilityProvider } from "@builderforce/agent-tools";
import { childRunner } from "./onPremSubagents.js";
import type { OnPremRunSinks } from "./onPremEvents.js";

const POLICY: RunPolicy = {
  entryPoint: "on-prem",
  toolScope: "ticket",
  role: "code",
  levers: [],
  budgets: {},
  inference: "hybrid",
  verify: "declared-checks",
  signoff: { roleKey: "reviewer" },
  approvalGates: [],
  delegation: { requested: true, readsBeforeNudge: 6 },
};

const OWNER_CAPS: CapabilityProvider = {
  capabilities: new Set<Capability>(["repo.read", "human", "skill.author", "orchestrate", "memory"]),
  human: { ask: async () => ({ paused: true }) },
  orchestration: { spawn: async () => ({ ok: true }) },
};

const quiet = (): OnPremRunSinks => ({ onAssistantText: vi.fn(), onToolUse: vi.fn(), onResult: vi.fn() });

function model(answers: string[], requests: ModelRequest[]): ModelTransport {
  let call = 0;
  return {
    complete: async (request) => {
      requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest);
      return { content: answers[call++] ?? "" };
    },
  };
}

describe("childRunner", () => {
  it("runs the brief as its own run and returns the child's report", async () => {
    const requests: ModelRequest[] = [];
    const spawn = childRunner({ model: model(["found it in agent-loop.ts"], requests), capabilities: OWNER_CAPS, policy: POLICY, sinks: quiet(), parentRunId: "42" });

    const result = await spawn({ label: "find handler", task: "where is the handler?" });

    expect(result).toMatchObject({ ok: true, output: "found it in agent-loop.ts" });
    // It sees none of the owner's conversation: its brief is its whole task.
    expect(requests[0]?.messages.find((m) => m.role === "user")?.content).toBe("where is the handler?");
  });

  it("holds a clone of its owner's tools, minus delegation, asking a person and authoring skills", async () => {
    const requests: ModelRequest[] = [];
    const spawn = childRunner({ model: model(["ok"], requests), capabilities: OWNER_CAPS, policy: POLICY, sinks: quiet(), parentRunId: "42" });
    await spawn({ label: "x", task: "y" });
    const offered = (requests[0]?.tools ?? []).map((t) => t.function.name);
    expect(offered).toContain("read_file");
    expect(offered).toContain("memory_recall");
    expect(offered).not.toContain("spawn_agent");
    expect(offered).not.toContain("ask_human");
  });

  it("is observed on its own: nothing it says reaches the owner's chat", async () => {
    const owner = quiet();
    const child = quiet();
    const forChild = vi.fn(() => child);
    const spawn = childRunner({ model: model(["child answer"], []), capabilities: OWNER_CAPS, policy: POLICY, sinks: { ...owner, forChild }, parentRunId: "42" });

    await spawn({ label: "find handler", task: "go" });

    expect(forChild).toHaveBeenCalledWith("find handler");
    expect(child.onAssistantText).toHaveBeenCalledWith("child answer");
    expect(owner.onAssistantText).not.toHaveBeenCalled();
    expect(owner.onResult).not.toHaveBeenCalled();
  });

  it("writes an outcome row that names its owner, so it is not a second run of it", async () => {
    const rows: RunOutcomeRow[] = [];
    const child: OnPremRunSinks = { ...quiet(), onOutcome: (row) => void rows.push(row) };
    const spawn = childRunner({ model: model(["done"], []), capabilities: OWNER_CAPS, policy: POLICY, sinks: { ...quiet(), forChild: () => child }, parentRunId: "42" });

    await spawn({ label: "x", task: "y" });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entryPoint: "on-prem", parentRunId: "42", terminalStatus: "finished" });
  });

  it("reports a child that failed as a failed delegation", async () => {
    const failing: ModelTransport = { complete: async () => Promise.reject(new Error("gateway 503")) };
    const spawn = childRunner({ model: failing, capabilities: OWNER_CAPS, policy: POLICY, sinks: quiet(), parentRunId: "42" });
    expect(await spawn({ label: "x", task: "y" })).toMatchObject({ ok: false });
  });

  it("stops with its owner", async () => {
    const stop = new AbortController();
    stop.abort();
    const spawn = childRunner({ model: model(["never"], []), capabilities: OWNER_CAPS, policy: POLICY, sinks: quiet(), signal: stop.signal, parentRunId: "42" });
    expect(await spawn({ label: "x", task: "y" })).toMatchObject({ ok: false, error: "cancelled" });
  });
});
