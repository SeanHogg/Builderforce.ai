import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunHoldGate, holdReason, UNMEASURED_HOLD } from "./runHoldGate";

afterEach(() => { vi.useRealTimers(); });

const gateOf = (extra: { onTimeout?: (runId: string, ms: number, which: string) => void } = {}) =>
  createRunHoldGate({ budgetMs: 30_000, finalizeCeilingMs: 120_000, ...extra });

/**
 * CONTRACT CHANGE (PRD 41 §12.5, decision 5): the gate is FAIL-CLOSED for an autonomous run that handed off changes. A
 * delta that errors, is abandoned or misses the deadline used to complete the run; it now holds it `run_delta_unmeasured`.
 */
describe("the finalize gate of an autonomous run (PRD 41 §12.5)", () => {
  it("holds a completed autonomous run on the blocking rules its stored delta reported", async () => {
    const gate = gateOf();
    gate.expect("run-a");
    const verdict = gate.beforeTerminal({ runId: "run-a", status: "completed" });
    const port = gate.port("run-a");
    port.begin(true);
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

  it("completes an autonomous run whose delta settled clean, without waiting for the deadline", async () => {
    vi.useFakeTimers();
    const gate = gateOf();
    gate.expect("run-clean");
    const verdict = gate.beforeTerminal({ runId: "run-clean", status: "completed" });
    gate.port("run-clean").begin(true);
    gate.port("run-clean").settled();
    await expect(verdict).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("holds unmeasured (fail-closed) a run whose delta missed the deadline, and a late blocking code holds nothing more", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const gate = gateOf({ onTimeout });
    gate.expect("run-slow");
    const verdict = gate.beforeTerminal({ runId: "run-slow", status: "completed" });
    gate.port("run-slow").begin(true);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(verdict).resolves.toEqual(UNMEASURED_HOLD);
    expect(onTimeout).toHaveBeenCalledWith("run-slow", 30_000, "delta");
    expect(gate.port("run-slow").block(["guard-removed"])).toBe(false);
  });

  it("holds unmeasured a run whose delta failed or could not be stored", async () => {
    const gate = gateOf();
    gate.expect("run-failed-delta");
    const verdict = gate.beforeTerminal({ runId: "run-failed-delta", status: "completed" });
    const port = gate.port("run-failed-delta");
    port.begin(true);
    port.unmeasured();
    port.settled();
    await expect(verdict).resolves.toEqual({ reason: "run_delta_unmeasured", rules: [] });
  });

  it("never holds a run with no change set, or one that changed nothing", async () => {
    vi.useFakeTimers();
    const gate = gateOf();
    gate.expect("run-no-set");
    const none = gate.beforeTerminal({ runId: "run-no-set", status: "completed" });
    gate.port("run-no-set").settled(); // the change set's `release`: never handed off
    await expect(none).resolves.toBeUndefined();
    gate.expect("run-empty");
    const empty = gate.beforeTerminal({ runId: "run-empty", status: "completed" });
    gate.port("run-empty").begin(false);
    gate.port("run-empty").settled();
    await expect(empty).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts the deadline at hand-off, not at the run's settle: a slow finalization does not eat the delta's time", async () => {
    vi.useFakeTimers();
    const gate = gateOf();
    gate.expect("run-big");
    const verdict = gate.beforeTerminal({ runId: "run-big", status: "completed" });
    // Finalization of a large repository takes 50 s — longer than the delta's whole budget.
    await vi.advanceTimersByTimeAsync(50_000);
    const port = gate.port("run-big");
    port.begin(true);
    // 25 s into the delta (75 s after the settle): still measuring, nothing decided.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(port.block(["guard-removed"])).toBe(true);
    port.settled();
    await expect(verdict).resolves.toMatchObject({ rules: ["guard-removed"] });
  });

  it("holds unmeasured a run whose finalization outlived its ceiling", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const gate = gateOf({ onTimeout });
    gate.expect("run-stuck");
    const verdict = gate.beforeTerminal({ runId: "run-stuck", status: "completed" });
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(verdict).resolves.toEqual(UNMEASURED_HOLD);
    expect(onTimeout).toHaveBeenCalledWith("run-stuck", 120_000, "finalize");
  });

  it("never holds a failed or cancelled run, and decides it at once", async () => {
    const gate = gateOf();
    gate.expect("run-failed");
    await expect(gate.beforeTerminal({ runId: "run-failed", status: "failed" })).resolves.toBeUndefined();
    expect(gate.port("run-failed").block(["guard-removed"])).toBe(false);
    await expect(gate.verdict("run-failed")).resolves.toBeUndefined();
  });

  it("leaves an interactive run (never expected) unaffected", async () => {
    vi.useFakeTimers();
    const gate = gateOf();
    await expect(gate.beforeTerminal({ runId: "run-interactive", status: "completed" })).resolves.toBeUndefined();
    expect(gate.port("run-interactive").block(["guard-removed"])).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("decides at once when the delta settled before the run was asked about", async () => {
    const gate = gateOf();
    gate.expect("run-early");
    gate.port("run-early").begin(true);
    expect(gate.port("run-early").block(["guard-removed"])).toBe(true);
    gate.port("run-early").settled();
    await expect(gate.beforeTerminal({ runId: "run-early", status: "completed" })).resolves.toMatchObject({ rules: ["guard-removed"] });
  });

  it("forgets a run whose start threw: no timer and no verdict is kept for it", async () => {
    vi.useFakeTimers();
    const gate = gateOf();
    gate.expect("run-threw");
    gate.port("run-threw").begin(true);
    gate.forget("run-threw");
    expect(vi.getTimerCount()).toBe(0);
    await expect(gate.beforeTerminal({ runId: "run-threw", status: "completed" })).resolves.toBeUndefined();
    gate.expect("run-failed-start");
    await gate.beforeTerminal({ runId: "run-failed-start", status: "failed" });
    gate.forget("run-failed-start");
    await expect(gate.verdict("run-failed-start")).resolves.toBeUndefined();
  });
});
