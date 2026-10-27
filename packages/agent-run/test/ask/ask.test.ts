import { describe, it, expect } from "vitest";
import { askHook } from "../../src/policy/ask/index.js";
import type { PolicyContext } from "../../src/policy/hooks.js";

/**
 * The ask policy, ported from the kernel `ask_human` / `ASK_USER_TOOL` contract and the
 * on-prem `askHumanTool`. The hook never reaches a person itself — it asks through the
 * `HumanChannel` port and parks the run until the answer arrives.
 */

function ctx(human: PolicyContext["ports"]["human"]): PolicyContext {
  return {
    task: { prompt: "ask a human", dispatch: { source: "chat" } },
    policy: {
      entryPoint: "on-prem", toolScope: "chat-work", role: "general", levers: [], budgets: {},
      inference: "hybrid", verify: "none", approvalGates: [],
      delegation: { requested: false, readsBeforeNudge: 6 },
    },
    state: {} as unknown as PolicyContext["state"],
    // The ask hook only reads `ports.human`; the remaining RunPorts fields are
    // transport/surface concerns this test does not exercise. Cast, as the other
    // policy tests (e.g. stall.test.ts) do, rather than stub the whole port set.
    ports: { human } as PolicyContext["ports"],
    step: 0,
    turn: 0,
    messages: [],
    tools: [],
  };
}

describe("askHook — the port the kernel ask_human and every cloud ask funnel through", () => {
  it("hands the question and options to the human port and returns its answer", async () => {
    const asked: Array<{ question: string; options?: readonly string[] }> = [];
    const answer = await askHook.answer(
      ctx({
        ask: async (question, options) => {
          asked.push({ question, options });
          return { kind: "answered", answer: "Postgres" };
        },
      }),
      "Which database?",
      ["Postgres", "SQLite"],
    );
    expect(answer).toEqual({ kind: "answered", answer: "Postgres" });
    expect(asked).toEqual([{ question: "Which database?", options: ["Postgres", "SQLite"] }]);
  });

  it("parks the run when the human port pauses it", async () => {
    const answer = await askHook.answer(
      ctx({ ask: async () => ({ kind: "paused" }) }),
      "Which database?",
    );
    expect(answer).toEqual({ kind: "paused" });
  });

  it("parks when the surface has no human port at all", async () => {
    const answer = await askHook.answer(ctx(undefined as unknown as PolicyContext["ports"]["human"]), "Which database?");
    expect(answer).toEqual({ kind: "paused" });
  });
});
