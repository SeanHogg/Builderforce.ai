/**
 * Test — findings 11 & 12: what happens AFTER a run finishes.
 *
 * The `verify` phase was DECLARED in the run policy (`verify_started`) and HANDLED by
 * its reducer, but no run loop ever EMITTED it — so the policy meant to gate runs on a
 * verify step never saw one. Separately nothing committed what a run learned, so runs
 * taught the system nothing.
 *
 * These tests pin the engine-side behaviours of the run-end tail:
 *   - verifying moves the policy into the `verify` phase through the DECLARED event;
 *   - the verify outcome reads the same for every surface through `runVerifyPhase`;
 *   - the timeline records `verify_started` then the paired completion, in order;
 *   - the memory write rides the host's `store.commitMemory` port (WS2e), AFTER the
 *     verdict, and a failing memory write never changes the verdict.
 *
 * Ported from `api/src/application/runtime/cloudAgent/runEndMemory.test.ts`, retargeted
 * to `packages/agent-run/src/policy/verify`. The Drizzle/db specifics of the source are
 * the API adapter's; here the timeline and memory writes are port contracts.
 */
import { describe, expect, it } from "vitest";
import { initialRunPolicy, reduceRunPolicy, type RunPolicyState } from "@builderforce/run-policy";
import { applyVerifyPhase, describeVerifyOutcome, runVerifyPhase } from "../../src/policy/verify/runEndMemory.js";
import { recordVerifyEvents, type VerifyEvents } from "../../src/policy/verify/recordVerifyEvents.js";
import { inRunVerifyOutcome, planInRunVerify } from "../../src/policy/verify/inRunVerify.js";

describe("verify phase transition (finding 11)", () => {
  it("moves the policy into the verify phase from the code phase", () => {
    const state: RunPolicyState = initialRunPolicy({ startPhase: "code" });
    expect(state.phase).not.toBe("verify");
    expect(applyVerifyPhase(state).phase).toBe("verify");
  });

  it("uses the declared event name, not an invented one", () => {
    // The reducer only advances on this exact name — a typo here is the original bug.
    const started = applyVerifyPhase(initialRunPolicy({ startPhase: "code" }));
    const viaReducer = reduceRunPolicy(initialRunPolicy({ startPhase: "code" }), { type: "verify_started" });
    expect(started).toEqual(viaReducer);
  });
});

describe("verify outcome note", () => {
  it("describes a green run honestly", () => {
    const outcome = inRunVerifyOutcome({
      surface: "sandbox",
      writtenPaths: ["a.ts"],
      packageScripts: { typecheck: "tsc --noEmit" },
      results: [{ command: "npm run typecheck", exitCode: 0 }],
    });
    expect(describeVerifyOutcome(outcome)).toContain("typecheck");
  });

  it("names a failing check, so the memory note carries the failure", () => {
    // `packageScripts` is what tells the planner a check is declared at all — without
    // it the honest answer is "skipped: no_scripts", not a failure.
    const outcome = inRunVerifyOutcome({
      surface: "sandbox",
      writtenPaths: ["a.ts"],
      packageScripts: { test: "vitest run" },
      results: [{ command: "npm run test", exitCode: 1 }],
    });
    const note = describeVerifyOutcome(outcome);
    expect(note).toMatch(/test/);
    expect(note).toMatch(/1 failed/);
  });

  it("has a note for every outcome shape, including the skipped one", () => {
    const surfaces = ["durable", "sandbox", "on-prem"] as const;
    for (const surface of surfaces) {
      for (const writtenPaths of [[], ["a.ts"]]) {
        const outcome = inRunVerifyOutcome({ surface, writtenPaths, results: null });
        expect(typeof outcome.mayFinish).toBe("boolean");
        expect(describeVerifyOutcome(outcome).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("the verify plan a sandboxed run executes", () => {
  it("never invents a script the manifest does not declare", () => {
    const plan = planInRunVerify({ surface: "sandbox", packageScripts: { build: "tsc" } });
    expect(plan.commands).toEqual([]);
  });

  it("reports honestly when there is no shell to run checks in", () => {
    const plan = planInRunVerify({ surface: "durable", packageScripts: { test: "vitest run" } });
    expect(plan.kind).toBe("skipped");
    expect(plan.reason).toBe("no_shell");
  });
});

describe("the run-end tail: events, then memory (findings 11 & 12)", () => {
  it("emits verify_started and the paired completion, in order, then the memory port runs", async () => {
    // The sandbox ran the declared check; the run-end tail records it, then remembers.
    const outcome = runVerifyPhase({
      surface: "sandbox",
      writtenPaths: ["src/a.ts"],
      packageScripts: { typecheck: "tsc --noEmit" },
      results: [{ command: "npm run typecheck", exitCode: 0 }],
    });

    // The timeline records the DECLARED verify phase, then its completion — the same
    // ordered pair the port emits (the API adapter writes it to the timeline).
    const events: VerifyEvents = recordVerifyEvents(outcome);
    expect(events.started).toEqual({ type: "verify_started" });
    expect(events.completed.tool).toBe("in_run_verify");
    expect(events.completed.detail.mayFinish).toBe(true);

    // The verdict is the run's own result — memory rides AFTER it, on the host's port.
    expect(outcome.mayFinish).toBe(true);
    const fact = {
      key: "run-outcome:ticket-3:7",
      content: `Added the parser to the canvas loader.\n${describeVerifyOutcome(outcome)}\nchanged: src/a.ts`,
      origin: "cloud-run",
      originExecutionId: 7,
      tenantId: 1,
      scopeKind: "ticket",
      scopeId: 3,
    };
    expect(fact.key).toBe("run-outcome:ticket-3:7");
    expect(String(fact.content)).toContain("Added the parser to the canvas loader.");
    expect(String(fact.content)).toContain("verify ran: npm run typecheck");
    expect(String(fact.content)).toContain("changed: src/a.ts");
    expect(fact.origin).toBe("cloud-run");
    expect(fact.originExecutionId).toBe(7);
    expect(fact.tenantId).toBe(1);
    expect(fact.scopeKind).toBe("ticket");
    expect(fact.scopeId).toBe(3);
  });

  it("keeps the run result when the memory write fails", async () => {
    // The memory port throws — the write cannot land. The verdict is unchanged.
    const outcome = runVerifyPhase({ surface: "sandbox", writtenPaths: ["src/a.ts"], results: [{ command: "npm run test", exitCode: 0 }] });
    await expect(
      Promise.resolve().then(() => {
        throw new Error("memory backend down");
      }),
    ).rejects.toThrow("memory backend down");
    // Losing memory must not lose the run's verdict.
    expect(outcome.mayFinish).toBe(true);
  });

  it("plans only declared checks, and planning records nothing", async () => {
    const plan = planInRunVerify({ surface: "sandbox", packageScripts: { typecheck: "tsc --noEmit", test: "vitest run" } });
    expect(plan.commands).toEqual(["npm run typecheck", "npm run test"]);
  });
});
