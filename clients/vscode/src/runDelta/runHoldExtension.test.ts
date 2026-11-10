import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRunDeltaProgress } from "./runDeltaProgress";
import { createRunHoldGate, DEFAULT_EXTENSION_CAPS, runExtender } from "./runHoldGate";

const MIN = 60_000;

describe("the finalize gate's extension buckets (dynamic, l3), once per run", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("caps each bucket, moves the timer by what it granted, and answers the grant", async () => {
    const timeouts: number[] = [];
    const gate = createRunHoldGate({ budgetMs: 10_000, finalizeCeilingMs: 60_000, onTimeout: (_id, ms) => timeouts.push(ms) });
    gate.expect("r");
    const port = gate.port("r");
    port.begin(true);
    expect(port.extend!(50 * MIN, "dynamic")).toBe(50 * MIN);
    expect(port.extend!(30 * MIN, "dynamic")).toBe(10 * MIN); // the dynamic bucket is 60 min per run
    expect(port.extend!(5 * MIN, "dynamic")).toBe(0);
    expect(port.extend!(15 * MIN, "l3")).toBe(15 * MIN);
    expect(port.extend!(15 * MIN, "l3")).toBe(0); // the l3 bucket is spent once per run, not per repository
    const verdict = gate.beforeTerminal({ runId: "r", status: "completed" });
    // Still waiting just before budget + 60 + 15 min; held unmeasured right after.
    await vi.advanceTimersByTimeAsync(10_000 + 75 * MIN - 1);
    expect(timeouts).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(timeouts).toEqual([10_000 + DEFAULT_EXTENSION_CAPS.dynamic + DEFAULT_EXTENSION_CAPS.l3]);
    expect(await verdict).toMatchObject({ rules: [] });
  });

  it("3 repositories: the run's extender grants min(run cap, gate grant), so the gate never expires before the delta's deadline", async () => {
    const gate = createRunHoldGate({ budgetMs: 35_000, finalizeCeilingMs: 60_000 });
    gate.expect("r");
    const port = gate.port("r");
    port.begin(true);
    let deltaDeadline = 30_000; // the delta's own budget (the gate's adds the hand-off grace)
    let holdDeadline = 35_000;
    const realExtend = port.extend!;
    const hold = { ...port, extend: (ms: number, kind: "dynamic" | "l3") => { const g = realExtend(ms, kind); holdDeadline += g; return g; } };
    const extend = runExtender(hold, (g) => { deltaDeadline += g; });
    const grants = [extend(31 * MIN), extend(31 * MIN), extend(31 * MIN)];
    expect(grants).toEqual([31 * MIN, 29 * MIN, 0]); // one 60-minute bucket for the whole run
    expect(holdDeadline).toBeGreaterThanOrEqual(deltaDeadline);
    // An L3 wait later (its own bucket) never takes from the dynamic tier's.
    expect(hold.extend(15 * MIN, "l3")).toBe(15 * MIN);
    expect(holdDeadline).toBeGreaterThanOrEqual(deltaDeadline);
  });

  it("a gate that is not waiting on the run does not constrain it", () => {
    const gate = createRunHoldGate({ budgetMs: 1_000, finalizeCeilingMs: 1_000 });
    expect(gate.port("unknown").extend!(5 * MIN, "dynamic")).toBe(5 * MIN);
  });
});

describe("the progress card while the dynamic tier runs", () => {
  it("dynamic() changes only a PENDING card, keeping the larger ceiling", () => {
    const relayed: unknown[] = [];
    const progress = createRunDeltaProgress((c) => relayed.push(c));
    const over = progress.begin({ chatId: 1, runId: "r", repos: 1 });
    progress.dynamic("r", 14.2);
    expect(relayed.at(-1)).toEqual({ chatId: 1, runId: "r", status: "pending", dynamicMinutes: 15 });
    progress.dynamic("r", 3);
    expect(relayed.at(-1)).toMatchObject({ dynamicMinutes: 15 });
    over(); // no computed card came: the run's card turns `failed`
    const count = relayed.length;
    progress.dynamic("r", 20);
    expect(relayed.length).toBe(count); // a failed card is never changed
    progress.dynamic("unknown", 5);
    expect(relayed.length).toBe(count);
  });
});
