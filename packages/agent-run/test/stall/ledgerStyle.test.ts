/**
 * The stall style a delivery ledger declares as data (`DeliveryLedger.stall`, `DeliveryLedger.judged`): a surface that counts the
 * re-prompt budget across the whole run, and one that has the stall judged on the model's own words. Every other surface keeps the
 * defaults, which the first case in each pair holds.
 */

import { describe, expect, it } from "vitest";
import { initialRunPolicy } from "@builderforce/run-policy";
import { stallHook } from "../../src/policy/stall/index.js";
import type { PolicyContext } from "../../src/policy/hooks.js";
import type { DeliveryLedger } from "../../src/surface.js";

const STALL = "I'll search the codebase for the handler.";

function ctxWith(over: { delivery?: Partial<DeliveryLedger>; content?: string; judged?: string; spent?: number; spentOn?: string; heldModel?: string }): PolicyContext {
  const model = { ...initialRunPolicy(), ...(over.heldModel ? { model: over.heldModel } : {}) };
  const delivery: DeliveryLedger = { rungs: () => [], ...over.delivery };
  return {
    task: { prompt: "Fix the handler", dispatch: { source: "chat" } },
    policy: {
      entryPoint: "web", toolScope: "chat-work", role: "general", levers: [], budgets: {},
      inference: "hybrid", verify: "none", approvalGates: [], delegation: { requested: false, readsBeforeNudge: 6 },
    },
    state: { model, ...(over.spent ? { stall: { recoveriesUsed: over.spent, ...(over.spentOn ? { model: over.spentOn } : {}) } } : {}) } as unknown as PolicyContext["state"],
    ports: { delivery } as unknown as PolicyContext["ports"],
    step: 1,
    turn: 1,
    messages: [],
    tools: ["read_file", "write_file"].map((name) => ({ type: "function" as const, function: { name, description: "", parameters: { type: "object" as const } } })),
    content: over.content ?? STALL,
    ...(over.judged !== undefined ? { judged: over.judged } : {}),
  };
}

describe("the re-prompt budget", () => {
  it("is keyed by the model it was spent against, so another model starts it full", () => {
    const decision = stallHook.recover(ctxWith({ spent: 2, spentOn: "old-model", heldModel: "new-model" }));
    expect(decision).toMatchObject({ action: "steer", detail: { attempt: 1 } });
  });

  it("counts across the run for a ledger that says so", () => {
    const decision = stallHook.recover(ctxWith({ spent: 2, spentOn: "old-model", heldModel: "new-model", delivery: { stall: { runWideBudget: true } } }));
    expect(decision).toMatchObject({ action: "steer", detail: { attempt: 3 } });
  });
});

describe("the text the stall is judged on", () => {
  it("is the replayed content when the surface gives none", () => {
    expect(stallHook.recover(ctxWith({ content: STALL }))).toMatchObject({ action: "steer" });
  });

  it("is the judged text when the surface gives one, over the replayed content", () => {
    expect(stallHook.recover(ctxWith({ content: "Here you go.", judged: STALL }))).toMatchObject({ action: "steer" });
  });

  it("and a turn whose judged text announces nothing is not a stall, whatever the replay says", () => {
    expect(stallHook.recover(ctxWith({ content: STALL, judged: "Here you go." }))).toBeUndefined();
  });
});
