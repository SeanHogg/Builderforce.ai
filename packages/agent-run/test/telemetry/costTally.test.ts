/**
 * What a run cost, from what each turn reported (PRD 35 §8.2). A turn the transport did not price
 * has an UNKNOWN cost, and a run with such a turn has an unknown total — never the sum of the
 * priced turns. One rule for the run tally and the event-trace fold alike.
 */
import { describe, expect, it } from "vitest";
import { buildOutcomeRow, freshTally, tallyTurn, type RunEvent, type RunState } from "../../src/index.js";
import { emptyTally, foldEvent } from "../../src/telemetry/eventTally.js";
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

function traceCost(turns: Array<number | undefined>) {
  const tally = emptyTally();
  for (const costMc of turns) {
    foldEvent(tally, { kind: "model.completed", step: 1, model: "m", usage: usage(costMc) } as unknown as RunEvent);
  }
  return tally;
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

describe("the event-trace fold agrees", () => {
  it("latches unpriced the same way", () => {
    expect(traceCost([0, undefined])).toMatchObject({ cost: 0, costUnpriced: true });
    expect(traceCost([0, 0]).cost).toBe(0);
    expect(traceCost([0, 0]).costUnpriced).toBeUndefined();
    expect(traceCost([40, 60]).cost).toBe(100);
  });
});
