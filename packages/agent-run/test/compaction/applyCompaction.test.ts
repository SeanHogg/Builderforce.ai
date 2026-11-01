/**
 * What the run counts as a compaction (`RunState.compaction.compactions`, the §8.2 row's `compactions`): a fold the context shrank by.
 * A model hand-off that only added its note is not one, and neither is a fold an earlier turn already made that a surface hands back
 * again (the Brain rebuilds its working set from a memo every turn). Without that, a long Brain run reported one compaction per turn.
 */
import { describe, expect, it } from "vitest";
import { applyCompaction } from "../../src/runContext.js";
import { freshState } from "../../src/runState.js";
import { TEST_POLICY, TEST_TASK } from "../support/policyContext.js";

function applied(results: Array<{ dropped: number; noteOnly?: true; reused?: true }>) {
  const state = freshState(TEST_POLICY, TEST_TASK);
  const view = { messages: [{ role: "user" as const, content: "task" }], tools: [] };
  results.forEach((result, i) => applyCompaction(state, view, { messages: [{ role: "user", content: "task" }], ...result }, i + 1));
  return state.compaction;
}

describe("applyCompaction counts folds", () => {
  it("counts each real fold", () => {
    expect(applied([{ dropped: 4 }, { dropped: 2 }]).compactions).toBe(2);
  });

  it("does not count a hand-off note, or a fold handed back again", () => {
    expect(applied([{ dropped: 0, noteOnly: true }]).compactions).toBe(0);
    expect(applied([{ dropped: 4 }, { dropped: 4, reused: true }, { dropped: 4, reused: true }]).compactions).toBe(1);
  });
});
