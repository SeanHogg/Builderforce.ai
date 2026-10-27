/**
 * Test — the finish gates: review sign-off, no-code deliverable, CI pending, honesty,
 * and the anti-stub placeholder scan.
 *
 * Ported from `api/src/application/runtime/cloudAgent/finishGates.test.ts`, retargeted
 * to `packages/agent-run/src/policy/finish`. Assertions are the source's, unchanged.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateFinishGates,
  initialFinishGateState,
  missingReviewVerdictMessage,
  type FinishGateArgs,
  type FinishGatePorts,
} from "../../src/policy/finish/gates.js";
import { hasNoCodeDeliverable, isDocumentationPath } from "../../src/policy/finish/finishTools.js";
import { ciFinishDecision } from "../../src/policy/finish/ciGate.js";

function finishInput(patch: Partial<FinishGateArgs> = {}, ports: FinishGatePorts = {}): FinishGateArgs {
  return {
    writtenPaths: [],
    requiredSignoff: undefined,
    delegated: false,
    summary: "done",
    output: "",
    gates: initialFinishGateState(undefined, false),
    enterVerify: () => {},
    ports,
    ...patch,
  };
}

const A_TS = "src/a.ts";

describe("documentation-path classification", () => {
  it("classifies docs, specs and text extensions as documentation", () => {
    expect(isDocumentationPath("docs/specs/35-prd.md")).toBe(true);
    expect(isDocumentationPath("PRD.md")).toBe(true);
    expect(isDocumentationPath("notes.txt")).toBe(true);
    expect(isDocumentationPath("src/a.ts")).toBe(false);
    expect(isDocumentationPath("package.json")).toBe(false);
  });
});

describe("no-deliverable detection", () => {
  it("marks no-deliverable when only docs (or nothing) were written", () => {
    expect(hasNoCodeDeliverable(["docs/x.md"])).toBe(true);
    expect(hasNoCodeDeliverable(["docs/x.md", "PRD.md"])).toBe(true);
    expect(hasNoCodeDeliverable([])).toBe(true);
    expect(hasNoCodeDeliverable([A_TS])).toBe(false);
    expect(hasNoCodeDeliverable(["docs/x.md", A_TS])).toBe(false);
  });
});

describe("finish gating", () => {
  it("finishes with a code file and no other gates", async () => {
    const verdict = await evaluateFinishGates(finishInput({ writtenPaths: [A_TS], summary: "ok" }));
    expect(verdict.block).toBeNull();
    expect(verdict.reason).toBeUndefined();
  });

  it("blocks a completion claim with no code deliverable, once", async () => {
    const gates = initialFinishGateState(undefined, false);
    const verdict = await evaluateFinishGates(finishInput({ writtenPaths: ["docs/x.md"], summary: "done", gates }));
    expect(verdict.block).toBeTruthy();
    expect(verdict.reason).toBe("no_deliverable");
    // The retry is allowed to finish — a legitimate no-op run finishes on the retry.
    expect(gates.noDeliverableBlocked).toBe(true);
    const retry = await evaluateFinishGates(finishInput({ writtenPaths: ["docs/x.md"], summary: "done", gates }));
    expect(retry.block).toBeNull();
  });

  it("requires a human sign-off verdict when the run is a reviewer assignment", async () => {
    const required = { roleKey: "qa-tester" };
    const verdict = await evaluateFinishGates(finishInput({ writtenPaths: [A_TS], requiredSignoff: required, summary: "done" }));
    expect(verdict.block).toBe(missingReviewVerdictMessage(required));
    expect(verdict.reason).toBe("review_verdict_missing");
  });

  it("blocks a claimed check that could not have run (honesty), once", async () => {
    const gates = initialFinishGateState(undefined, false);
    const verdict = await evaluateFinishGates(
      finishInput({ writtenPaths: [A_TS], summary: "all tests passed", gates }),
    );
    expect(verdict.block).toBeTruthy();
    expect(verdict.reason).toBe("honesty");
    expect(gates.finishBlockedOnce).toBe(true);
    const retry = await evaluateFinishGates(
      finishInput({ writtenPaths: [A_TS], summary: "all tests passed", gates }),
    );
    expect(retry.block).toBeNull();
  });

  it("does not block a summary that makes no check claim", async () => {
    const verdict = await evaluateFinishGates(finishInput({ writtenPaths: [A_TS], summary: "implemented the parser" }));
    expect(verdict.block).toBeNull();
  });
});

describe("branch CI gate", () => {
  it("a CI-pending branch blocks finish and spends a pending allowance", async () => {
    const ci = ciFinishDecision(
      { status: "pending", sha: "abc1234", count: 2, failed: [] },
      { pendingBlocks: 0, failureBlocks: 0 },
    );
    expect(ci.block).toMatch(/still running/);
    expect(ci.pendingBlocks).toBe(1);
    expect(ci.ciVerified).toBe(false);
    // Evaluate through the gate: pending CI blocks, reason branch_ci_pending.
    const gates = initialFinishGateState(undefined, false);
    const verdict = await evaluateFinishGates(
      finishInput({ writtenPaths: [A_TS], summary: "ok", gates }, { pollBranchCi: async () => ci }),
    );
    expect(verdict.reason).toBe("branch_ci_pending");
  });

  it("green CI verifies the run and never blocks", async () => {
    const ci = ciFinishDecision(
      { status: "success", sha: "abc1234", count: 3, failed: [] },
      { pendingBlocks: 0, failureBlocks: 0 },
    );
    expect(ci.block).toBeNull();
    expect(ci.ciVerified).toBe(true);
    // A claimed check is fine once CI is verified.
    const verdict = await evaluateFinishGates(
      finishInput({ writtenPaths: [A_TS], summary: "tests passed", gates: initialFinishGateState(undefined, false) }, { pollBranchCi: async () => ci }),
    );
    expect(verdict.block).toBeNull();
  });

  it("red CI blocks until its cap, then relents", async () => {
    let state = { pendingBlocks: 0, failureBlocks: 0 };
    for (let i = 0; i < 3; i += 1) {
      const ci = ciFinishDecision(
        { status: "failure", sha: "abc1234", count: 2, failed: ["build"] },
        state,
      );
      expect(ci.block).toMatch(/CI failed/);
      state = { pendingBlocks: ci.pendingBlocks, failureBlocks: ci.failureBlocks };
    }
    expect(state.failureBlocks).toBe(3);
    // Past the cap the gate relents so a broken pipeline cannot deadlock the run.
    const relent = ciFinishDecision(
      { status: "failure", sha: "abc1234", count: 2, failed: ["build"] },
      state,
    );
    expect(relent.block).toBeNull();
    expect(relent.ciVerified).toBe(false);
  });
});

describe("placeholder anti-stub gate", () => {
  it("blocks on flagged placeholder code up to its cap, then relents", async () => {
    const scan = { scanPlaceholders: async () => ({ flagged: [{ path: A_TS, markers: ["TODO: implement"] }] }) };
    const gates = initialFinishGateState(undefined, false);
    for (let i = 0; i < 2; i += 1) {
      const verdict = await evaluateFinishGates(finishInput({ writtenPaths: [A_TS], summary: "ok", gates }, scan));
      expect(verdict.reason).toBe("placeholders");
    }
    expect(gates.placeholderBlocks).toBe(2);
    // Past the cap the gate relents; a clean scan always passes.
    const relent = await evaluateFinishGates(finishInput({ writtenPaths: [A_TS], summary: "ok", gates }, scan));
    expect(relent.block).toBeNull();
    const clean = await evaluateFinishGates(
      finishInput({ writtenPaths: [A_TS], summary: "ok", gates }, { scanPlaceholders: async () => ({ flagged: [] }) }),
    );
    expect(clean.block).toBeNull();
  });
});

describe("finish gate resume state", () => {
  it("a sub-agent's no-deliverable gate starts spent; its owner is held to it", () => {
    expect(initialFinishGateState(undefined, true).noDeliverableBlocked).toBe(true);
    expect(initialFinishGateState(undefined, false).noDeliverableBlocked).toBe(false);
  });

  it("resume restores the counters but never ciVerified / finishBlockedOnce", () => {
    const resumed = initialFinishGateState(
      { noDeliverableBlocked: true, reviewVerdictRecorded: true, placeholderBlocks: 1, ciPendingBlocks: 1, ciFailureBlocks: 2 },
      false,
    );
    expect(resumed.noDeliverableBlocked).toBe(true);
    expect(resumed.reviewVerdictRecorded).toBe(true);
    expect(resumed.placeholderBlocks).toBe(1);
    expect(resumed.ciPendingBlocks).toBe(1);
    expect(resumed.ciFailureBlocks).toBe(2);
    expect(resumed.ciVerified).toBe(false);
    expect(resumed.finishBlockedOnce).toBe(false);
  });
});
