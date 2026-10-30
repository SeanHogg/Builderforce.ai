/**
 * What a run cost, from what each turn reported (PRD 35 §8.2). A turn the transport did not price
 * has an UNKNOWN cost, and a run with such a turn has an unknown total — never the sum of the
 * priced turns. A tally persisted before the rule existed resumes cost-unknown, not as a figure that may be missing turns.
 */
import { describe, expect, it } from "vitest";
import { buildOutcomeRow, freshTally, resumeTally, tallyTurn, type RunState } from "../../src/index.js";
import { freshState } from "../../src/runState.js";
import { TEST_POLICY, TEST_TASK } from "../support/policyContext.js";

const usage = (costMc?: number) => ({ inputTokens: 10, outputTokens: 2, ...(costMc === undefined ? {} : { costMc }) });

function rowCost(turns: Array<number | undefined>): number | undefined {
  const s: RunState = freshState(TEST_POLICY, TEST_TASK);
  const t = freshTally();
  for (const costMc of turns) tallyTurn(t, "m", usage(costMc));
  s.telemetry = t;
  return buildOutcomeRow({ entryPoint: "web", kind: "finished", state: s }).cost;
}

describe("the run's reported cost", () => {
  it("is unknown when an on-device (0) turn is mixed with an unpriced gateway turn — never the partial sum", () => {
    expect(rowCost([0, undefined])).toBeUndefined();
    expect(rowCost([undefined, 0])).toBeUndefined();
    expect(rowCost([40, undefined, 60])).toBeUndefined();
  });

  it("is a known 0 when every turn ran on the device", () => {
    expect(rowCost([0, 0, 0])).toBe(0);
  });

  it("is the sum when every turn was priced", () => {
    expect(rowCost([40, 0, 60])).toBe(100);
  });

  it("stays unknown for a run with no priced turn, and absent for a run with no turn", () => {
    expect(rowCost([undefined, undefined])).toBeUndefined();
    expect(rowCost([])).toBeUndefined();
  });

  it("treats a turn with no usage at all as an unpriced turn", () => {
    const s: RunState = freshState(TEST_POLICY, TEST_TASK);
    const t = freshTally();
    tallyTurn(t, "m", usage(5));
    tallyTurn(t, "m", undefined);
    s.telemetry = t;

    expect(buildOutcomeRow({ entryPoint: "web", kind: "finished", state: s }).cost).toBeUndefined();
  });
});

describe("resuming a tally written before the cost latch", () => {
  const legacy = (over: Record<string, unknown>) => ({ toolCalls: 3, toolErrors: 0, tokens: 900, cacheReadTokens: 0, shellFileReads: 0, repoErrors: 0, ...over }) as never;

  it("resumes cost-unknown when the legacy tally holds a figure — it may be the sum of only the priced turns", () => {
    expect(resumeTally(legacy({ costMc: 25 })).costMc).toBeNull();
  });

  it("resumes cost-unknown when the legacy run took turns but none was priced (a later priced turn must not start a partial sum)", () => {
    const resumed = resumeTally(legacy({}));

    expect(resumed.costMc).toBeNull();
    tallyTurn(resumed, "m", usage(40));
    expect(resumed.costMc).toBeNull();
  });

  it("resumes cost-unknown when the only trace of a turn is its served model or a dispatched call (a turn that reported no usage)", () => {
    expect(resumeTally(legacy({ tokens: 0, toolCalls: 0, model: "m" })).costMc).toBeNull();
    expect(resumeTally(legacy({ tokens: 0, toolCalls: 2 })).costMc).toBeNull();
  });

  it("leaves a legacy tally that took no turn alone", () => {
    expect(resumeTally({ toolCalls: 0, toolErrors: 0, tokens: 0, cacheReadTokens: 0, shellFileReads: 0, repoErrors: 0 } as never).costMc).toBeUndefined();
  });

  it("keeps a latch-era tally exactly as it was written", () => {
    expect(resumeTally({ ...freshTally(), tokens: 900, costMc: 25 }).costMc).toBe(25);
    expect(resumeTally({ ...freshTally(), tokens: 900, costMc: null }).costMc).toBeNull();
    expect(resumeTally(undefined).costMc).toBeUndefined();
  });
});
