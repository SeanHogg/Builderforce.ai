/**
 * A transport failover of a FRESH run (nothing but the task so far): the incoming model is told it took over, and its request opens
 * with the user's turn, never the assistant's.
 */
import { describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import { runAgent, type ModelCompletion, type ModelRequest, type PlatformTools, type RunPorts } from "../../src/index.js";
import { TEST_POLICY, TEST_TASK, schemas } from "../support/policyContext.js";

describe("a failover of a fresh run", () => {
  it("tells the incoming model, in a request that opens with the user's turn", async () => {
    const narrates: ModelCompletion = { content: "Let me search for that now.", model: "p/m" };
    const answers: ModelCompletion[] = [narrates, narrates, narrates, narrates, { content: "The handler is in agent-loop.ts.", model: "p/m2" }];
    const requests: ModelRequest[] = [];
    let n = 0;
    const platform: PlatformTools = {
      closed: true,
      verbatimText: true,
      schemas: () => schemas(["read"]),
      selection: { query: "", limit: 50, required: new Set<string>() },
      execute: async () => ({ data: "ok" }),
    };
    const ports: RunPorts = {
      model: {
        complete: async (request) => {
          requests.push({ ...request, messages: [...request.messages] });
          return answers[n++]!;
        },
        pickFallback: (tried) => (tried.includes("p/m2") ? undefined : "p/m2"),
        window: () => 200_000,
      },
      capabilities: { capabilities: new Set<Capability>() },
      store: { load: () => undefined, save: () => undefined },
      events: { emit: () => undefined },
      human: { ask: async () => ({ kind: "paused" }) },
      context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
      platform,
    };

    const outcome = await runAgent({ task: TEST_TASK, policy: { ...TEST_POLICY, pinnedModel: "p/m", modelHandoff: true }, ports });

    expect(outcome.kind).toBe("finished");
    const last = requests.at(-1)!;
    expect(last.model).toBe("p/m2");
    const rows = last.messages.filter((m) => m.role !== "system");
    const firstSpoken = last.messages.find((m) => m.role !== "system");
    expect(firstSpoken?.role).toBe("user");
    expect(last.messages.some((m) => m.content.startsWith("Handed off from p/m to p/m2."))).toBe(true);
    // the stall's failover nudge is the latest directive: the note sits ahead of it, in the user's role after the assistant's reply
    const note = last.messages.findIndex((m) => m.content.startsWith("Handed off"));
    expect(note).toBe(last.messages.length - 2);
    expect(last.messages[note]!.role).toBe("user");
    expect(last.messages[note - 1]!.role).toBe("assistant");
    expect(last.messages.at(-1)!.content).toContain("described tool calls instead of making them");
    expect(rows.length).toBeGreaterThan(0);
  });
});
