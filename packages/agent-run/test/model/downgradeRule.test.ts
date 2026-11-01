/**
 * The ONE decision behind `llm.model_downgrade` (`policy/model/downgradeRule.ts`), on its own: failover, BYO once per model, plan-tier
 * once per model. Both homes (the agent's `modelDowngrade`, the Brain's `modelDowngradeEvent`) supply their own inputs and wording.
 */
import { describe, expect, it } from "vitest";
import { priceBookFromPrices } from "@builderforce/model-catalog";
import { downgradeDecision, type DowngradeInput } from "../../src/policy/model/downgradeRule.js";

const BOOK = priceBookFromPrices([
  ["acme/flash", { input: 1e-7, output: 4e-7 }],
  ["acme/sonnet", { input: 3e-6, output: 1.5e-5 }],
]);

const turn = (over: Partial<DowngradeInput>): DowngradeInput => ({ asked: undefined, served: "acme/flash", byo: "", planPhase: false, seen: false, book: BOOK, ...over });

describe("downgradeDecision", () => {
  it("says nothing without an answering model, or when the gateway answers `default`", () => {
    expect(downgradeDecision(turn({ served: undefined, asked: "a" }))).toBeNull();
    expect(downgradeDecision(turn({ served: "default", asked: "a" }))).toBeNull();
  });

  it("a model that was ASKED for and is not the one that answered is a failover, every time (seen does not matter)", () => {
    expect(downgradeDecision(turn({ asked: "acme/sonnet" }))).toEqual({ kind: "failover" });
    expect(downgradeDecision(turn({ asked: "acme/sonnet", seen: true }))).toEqual({ kind: "failover" });
    expect(downgradeDecision(turn({ asked: "acme/flash" }))).toBeNull();
  });

  it("an auto-routed turn with a BYO signal is a BYO downgrade, once per model", () => {
    expect(downgradeDecision(turn({ byo: "anthropic:expired" }))).toEqual({ kind: "byo" });
    expect(downgradeDecision(turn({ byo: "  " }))).toBeNull();
    expect(downgradeDecision(turn({ byo: "anthropic:expired", seen: true }))).toBeNull();
  });

  it("an auto-routed PLAN turn on a Flash-class model with no BYO signal is a plan-tier downgrade, once per model", () => {
    const flash = downgradeDecision(turn({ planPhase: true }));
    expect(flash).toMatchObject({ kind: "plan_tier" });
    expect(downgradeDecision(turn({ planPhase: true, seen: true }))).toBeNull();
    // Not planning any more, or a model that is not Flash-class, or unpriced: nothing to say.
    expect(downgradeDecision(turn({ planPhase: false }))).toBeNull();
    expect(downgradeDecision(turn({ planPhase: true, served: "acme/sonnet" }))).toBeNull();
    expect(downgradeDecision(turn({ planPhase: true, served: "local/qwen-7b" }))).toBeNull();
  });

  it("a BYO signal takes the turn over the plan tier", () => {
    expect(downgradeDecision(turn({ planPhase: true, byo: "anthropic:revoked" }))).toEqual({ kind: "byo" });
  });
});
