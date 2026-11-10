import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunHoldGate, holdReason } from "./runHoldGate";

afterEach(() => { vi.useRealTimers(); });

describe("the finalize gate of an autonomous run (PRD 41 §12.5)", () => {
  it("holds a completed autonomous run on the blocking rules its delta computed", async () => {
    const gate = createRunHoldGate({ budgetMs: 30_000 });
    gate.expect("run-a");
    const verdict = gate.beforeTerminal({ runId: "run-a", status: "completed" });
    const port = gate.port("run-a");
    expect(port.block(["guard-removed"])).toBe(true);
    expect(port.block(["delta-config-changed", "guard-removed"])).toBe(true);
    port.settled();
    const hold = { reason: holdReason(["guard-removed", "delta-config-changed"]), rules: ["guard-removed", "delta-config-changed"] };
    expect(await verdict).toEqual(hold);
    expect(hold.reason).toBe("run_delta_blocking:guard-removed,delta-config-changed");
    // The owning start reads the same verdict, once.
    expect(await gate.verdict("run-a")).toEqual(hold);
    expect(await gate.verdict("run-a")).toBeUndefined();
  });

  it("completes an autonomous run whose delta settled clean, without waiting for the budget", async () => {
    vi.useFakeTimers();
    const gate = createRunHoldGate({ budgetMs: 30_000 });
    gate.expect("run-clean");
    const verdict = gate.beforeTerminal({ runId: "run-clean", status: "completed" });
    gate.port("run-clean").settled();
    await expect(verdict).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not hold a run whose delta missed the budget, and a late blocking code holds nothing", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const gate = createRunHoldGate({ budgetMs: 30_000, onTimeout });
    gate.expect("run-slow");
    const verdict = gate.beforeTerminal({ runId: "run-slow", status: "completed" });
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(verdict).resolves.toBeUndefined();
    expect(onTimeout).toHaveBeenCalledWith("run-slow", 30_000);
    // Computed after the verdict: not held, so the record must not claim it was.
    expect(gate.port("run-slow").block(["guard-removed"])).toBe(false);
  });

  it("never holds a failed or cancelled run, and releases it at once", async () => {
    const gate = createRunHoldGate({ budgetMs: 30_000 });
    gate.expect("run-failed");
    await expect(gate.beforeTerminal({ runId: "run-failed", status: "failed" })).resolves.toBeUndefined();
    expect(gate.port("run-failed").block(["guard-removed"])).toBe(false);
    await expect(gate.verdict("run-failed")).resolves.toBeUndefined();
  });

  it("leaves an interactive run (never expected) unaffected", async () => {
    vi.useFakeTimers();
    const gate = createRunHoldGate({ budgetMs: 30_000 });
    await expect(gate.beforeTerminal({ runId: "run-interactive", status: "completed" })).resolves.toBeUndefined();
    expect(gate.port("run-interactive").block(["guard-removed"])).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("decides at once when the delta settled before the run was asked about", async () => {
    const gate = createRunHoldGate({ budgetMs: 30_000 });
    gate.expect("run-early");
    expect(gate.port("run-early").block(["guard-removed"])).toBe(true);
    gate.port("run-early").settled();
    await expect(gate.beforeTerminal({ runId: "run-early", status: "completed" })).resolves.toMatchObject({ rules: ["guard-removed"] });
  });
});
