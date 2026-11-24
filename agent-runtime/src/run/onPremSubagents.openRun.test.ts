/**
 * regression: every on-prem run reaches the agent through `openRun` (one entry), and a child uses the shared routing defaults.
 * The spy wraps nothing: `openRun` is replaced, so no model is called.
 */
import { describe, expect, it, vi } from "vitest";
import type { ModelTransport, RunOutcome, RunPolicy } from "@builderforce/agent-run";

const seen = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));

vi.mock("@builderforce/agent-run", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@builderforce/agent-run")>();
  return {
    ...actual,
    openRun: async (input: Record<string, unknown>) => {
      seen.calls.push(input);
      return { kind: "finished", output: "child report", state: { step: 1 } } as unknown as RunOutcome;
    },
  };
});

import { childRunner } from "./onPremSubagents.js";
import { inMemoryStore, onPremPolicy } from "./onPremRunPorts.js";
import { policyOf as channelPolicyOf } from "./channelRunPorts.js";

describe("on-prem entry through openRun", () => {
  it("a child run calls openRun with lineage and its brief as the task", async () => {
    const owner = {
      model: {} as ModelTransport,
      capabilities: { capabilities: new Set() },
      policy: onPremPolicy({ toolScope: "ticket", request: "do it" }),
      human: { ask: async () => ({ kind: "paused" }) },
      sinks: { onAssistantText: () => undefined, onToolUse: () => undefined, onResult: () => undefined },
      parentRunId: "owner-1",
    } as unknown as Parameters<typeof childRunner>[0];
    await childRunner(owner)({ task: "look at X", label: "x" } as never);
    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0]?.task).toMatchObject({ prompt: "look at X", dispatch: { source: "subagent", parentRunId: "owner-1" } });
    expect(seen.calls[0]?.route).toBeUndefined();
    expect((seen.calls[0]?.policy as RunPolicy).entryPoint).toBe("on-prem");
  });

  it("the ticket and channel policies come from the ONE shared builder", () => {
    const ticket = onPremPolicy({ toolScope: "ticket", request: "plain", pinnedModel: "m" });
    expect(ticket).toMatchObject({ entryPoint: "on-prem", toolScope: "ticket", role: "code", pinnedModel: "m", inference: "hybrid", verify: "none" });
    const channel = channelPolicyOf({ model: { provider: "p", id: "m" } } as never, "go");
    expect(channel).toMatchObject({ entryPoint: "on-prem", toolScope: "chat-work", role: "code", modelHandoff: true, stallExhausted: "note" });
  });

  it("the in-memory store loads nothing, keeps nothing, and carries what the surface names", () => {
    const appended = vi.fn();
    const store = inMemoryStore({ appended });
    expect(store.load()).toBeUndefined();
    expect(store.appended).toBe(appended);
  });
});
