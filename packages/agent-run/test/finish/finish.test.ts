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
  finishGateSnapshot,
  initialFinishGateState,
  isInconclusiveFinishBlock,
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

// The two source cases the gates above do not already carry, through the same seam: the
// changed-file source policy reads the committed file through the `read` port.
describe("evaluateFinishGates — source quality and the durable snapshot", () => {
  it("names a source-quality block", async () => {
    const v = await evaluateFinishGates(finishInput({ writtenPaths: ["cfg.json"] }, { read: async () => '{ "a": ' }));
    expect(v.reason).toBe("source_quality");
    expect(v.block).toContain("cfg.json");
    expect(isInconclusiveFinishBlock(v.reason)).toBe(false);
  });

  it("carries its counters through a durable snapshot", () => {
    const g = initialFinishGateState({ placeholderBlocks: 2, ciPendingBlocks: 1 }, true);
    expect(g.noDeliverableBlocked).toBe(true);
    expect(finishGateSnapshot(g)).toEqual({ noDeliverableBlocked: true, reviewVerdictRecorded: false, placeholderBlocks: 2, ciPendingBlocks: 1, ciFailureBlocks: 0 });
  });
});

// ── The cloud's finish-gate cases (`api/.../cloudAgent/finishGates.test.ts`), over the ports the cloud binds ──────────
// The source mocked the api's repo / CI / claim modules; here those are the gates' ports. Inputs and expected values are the source's.
describe("evaluateFinishGates — over the cloud's ports", () => {
  const verdictOf = (status: "success" | "failure" | "pending" | "none") => ({ status, sha: "abcdef1234", count: 1, failed: status === "failure" ? ["build"] : [] });
  const reasons: string[] = [];
  const cloud = (over: { verify?: FinishGatePorts["verify"]; ci?: "success" | "failure" | "pending" | "none" } = {}): FinishGatePorts => ({
    bound: true,
    verify: over.verify ?? (async () => ({ ok: true, checked: [A_TS], skipped: [], errors: [] }) as never),
    pollBranchCi: async (counters) => ciFinishDecision(verdictOf(over.ci ?? "success"), counters),
    scanPlaceholders: async () => ({ flagged: [] }),
    recordClaim: async () => ({ ok: true }),
    onBlocked: (reason) => { reasons.push(reason); },
  });
  const cloudArgs = (patch: Partial<FinishGateArgs> = {}, ports: FinishGatePorts = cloud()) =>
    finishInput({ writtenPaths: [A_TS], summary: "Implemented the change.", ...patch }, ports);

  it("ships a verified finish, enters verify and marks CI green", async () => {
    let entered = 0;
    const a = cloudArgs({ enterVerify: () => { entered += 1; } });
    expect(await evaluateFinishGates(a)).toEqual({ block: null });
    expect(entered).toBeGreaterThan(0);
    expect(a.gates.ciVerified).toBe(true);
  });

  it("names a source-quality block", async () => {
    const v = await evaluateFinishGates(cloudArgs({}, cloud({ verify: async () => ({ ok: false, checked: [], skipped: [], errors: [{ path: "src/a.ts", line: 3, message: "Unexpected token" }] }) as never })));
    expect(v.reason).toBe("source_quality");
    expect(v.block).toContain("src/a.ts:3");
  });

  it("tells a pending CI block (not the model's failure) from a red one", async () => {
    reasons.length = 0;
    const pending = await evaluateFinishGates(cloudArgs({}, cloud({ ci: "pending" })));
    expect(pending.reason).toBe("branch_ci_pending");
    expect(isInconclusiveFinishBlock(pending.reason)).toBe(true);
    const red = await evaluateFinishGates(cloudArgs({}, cloud({ ci: "failure" })));
    expect(red.reason).toBe("branch_ci");
    expect(isInconclusiveFinishBlock(red.reason)).toBe(false);
    // The timeline keeps its one reason for both.
    expect(reasons).toEqual(["branch_ci", "branch_ci"]);
  });

  it("blocks an unrun-verification claim once", async () => {
    const a = cloudArgs({ summary: "All tests passed and the build is green." }, cloud({ ci: "none" }));
    expect((await evaluateFinishGates(a)).reason).toBe("honesty");
    expect((await evaluateFinishGates(a)).block).toBeNull();
  });

  it("requires the reviewer verdict before anything else", async () => {
    const v = await evaluateFinishGates(cloudArgs({ requiredSignoff: { roleKey: "code-reviewer" } }));
    expect(v.reason).toBe("review_verdict_missing");
  });

  it("absorbs nothing for a run with no children, and starts every attempt with beginAttempt", async () => {
    let absorbed = 0;
    let attempts = 0;
    const ports: FinishGatePorts = { ...cloud(), absorbChildWrites: async () => { absorbed += 1; }, beginAttempt: () => { attempts += 1; } };
    await evaluateFinishGates(cloudArgs({ delegated: false }, ports));
    await evaluateFinishGates(cloudArgs({ delegated: false }, ports));
    expect(absorbed).toBe(0);
    expect(attempts).toBe(2);
  });
});
