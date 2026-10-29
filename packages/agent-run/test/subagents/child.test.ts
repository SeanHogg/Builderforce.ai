/**
 * What a child run is, derived from its owner's: its policy, the capabilities it holds and
 * how its outcome reads to the owner (PRD 35 §6). The capability rule is the cloud's
 * (`childCapabilities`, tested where it lives); here it is the derivation that is held.
 */

import { describe, expect, it } from "vitest";
import type { Capability, CapabilityProvider } from "@builderforce/agent-tools";
import { childPolicy, childProvider, childResult, runAgent, type ModelCompletion, type ModelRequest, type RunOutcome, type RunPolicy, type RunState } from "../../src/index.js";
import { TEST_POLICY } from "../support/policyContext.js";

const OWNER: RunPolicy = {
  ...TEST_POLICY,
  toolScope: "ticket",
  role: "code",
  verify: "declared-checks",
  signoff: { roleKey: "reviewer" },
  delegation: { requested: true, readsBeforeNudge: 4 },
};

describe("childPolicy", () => {
  it("narrows the owner's policy to a child: its own scope, no delegation request, no verify, no sign-off", () => {
    const child = childPolicy(OWNER, {});
    expect(child).toMatchObject({ toolScope: "subagent", role: "code", verify: "none", delegation: { requested: false, readsBeforeNudge: 4 } });
    expect("signoff" in child).toBe(false);
  });

  it("takes the role the delegation asked for, and keeps the owner's gates, budgets and model", () => {
    const owner: RunPolicy = { ...OWNER, pinnedModel: "m", budgets: { steps: 30 }, approvalGates: [{ id: "g", effect: "block", tool: "x" }] };
    const child = childPolicy(owner, { role: "explore" });
    expect(child).toMatchObject({ role: "explore", pinnedModel: "m", budgets: { steps: 30 }, approvalGates: [{ id: "g" }] });
  });
});

describe("childProvider", () => {
  const owner: CapabilityProvider = {
    capabilities: new Set<Capability>(["repo.read", "repo.write", "shell", "human", "skill.author", "orchestrate", "orchestrate.live", "memory"]),
    human: { ask: async () => ({ paused: true }) },
    orchestration: { spawn: async () => ({ ok: true }) },
    memory: { remember: async () => ({ ok: true }), recall: async () => ({ ok: true, entries: [] }) },
  };

  it("holds a clone of its owner: same tools, minus delegation, asking a person and authoring skills", () => {
    const child = childProvider(owner);
    expect([...child.capabilities].sort()).toEqual(["memory", "repo.read", "repo.write", "shell"]);
    expect(child.memory).toBe(owner.memory);
    expect(child.human).toBeUndefined();
    expect(child.orchestration).toBeUndefined();
  });
});

describe("childResult", () => {
  const state = { step: 3 } as RunState;

  it("reads a finished child as its report, clipped, with the steps it spent and its ticket", () => {
    const long = "x".repeat(20_000);
    const result = childResult({ kind: "finished", output: long, state }, { ticket: "T-1" });
    expect(result).toMatchObject({ ok: true, steps: 3, ticket: "T-1" });
    expect((result.output ?? "").length).toBeLessThan(long.length);
    expect(childResult({ kind: "finished", output: long, state }, { outputChars: 10 }).output).toBe("x".repeat(10));
  });

  it("reads the other outcomes as what they are", () => {
    const outcome = (o: RunOutcome) => childResult(o, {});
    expect(outcome({ kind: "failed", reason: "gateway 503", state })).toEqual({ ok: false, error: "gateway 503" });
    expect(outcome({ kind: "paused", question: "which one?", approvalId: "a1", state })).toMatchObject({ ok: false });
    expect(outcome({ kind: "yielded", state })).toEqual({ ok: true, output: "", truncated: true, steps: 3 });
  });
});

describe("a parent can delegate through the agent's own catalog", () => {
  it("offers spawn_agent when the surface grants orchestrate, and dispatches it to the surface's spawn", async () => {
    const spawned: Array<{ label: string; task: string }> = [];
    const requests: ModelRequest[] = [];
    const script: ModelCompletion[] = [
      { content: "", toolCalls: [{ id: "s1", name: "spawn_agent", arguments: JSON.stringify({ label: "find it", task: "where is the handler?" }) }] },
      { content: "done" },
    ];
    let call = 0;
    const outcome = await runAgent({
      task: { prompt: "delegate the search", dispatch: { source: "manual" } },
      policy: TEST_POLICY,
      ports: {
        model: {
          complete: async (request) => {
            requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest);
            return script[call++] ?? { content: "" };
          },
        },
        capabilities: {
          capabilities: new Set<Capability>(["orchestrate"]),
          orchestration: {
            spawn: async (req) => {
              spawned.push({ label: req.label, task: req.task });
              return { ok: true, output: "in agent-loop.ts" };
            },
          },
        },
        store: { load: () => undefined, save: () => undefined },
        events: { emit: () => undefined },
        human: { ask: async () => ({ kind: "paused" }) },
        context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
      },
    });
    expect((requests[0]?.tools ?? []).map((t) => t.function.name)).toContain("spawn_agent");
    expect(spawned).toEqual([{ label: "find it", task: "where is the handler?" }]);
    expect(outcome.kind).toBe("finished");
  });
});
