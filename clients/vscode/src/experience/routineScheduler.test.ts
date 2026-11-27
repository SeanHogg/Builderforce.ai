import { describe, expect, it, vi } from "vitest";
import type { Skill } from "@seanhogg/builderforce-memory-engine";
import { TICK_MS, createRoutineScheduler } from "./routineScheduler";

const skill = (id: string) => ({ id }) as Skill;

function setup(over: { enabled?: boolean; active?: boolean; due?: Skill[]; start?: () => Promise<{ ok: boolean; error?: string }> } = {}) {
  const runner = {
    active: over.active ?? false,
    start: vi.fn(over.start ?? (async () => ({ ok: true, runId: "r", done: Promise.resolve() }))),
  };
  const due = vi.fn(async () => over.due ?? [skill("a"), skill("b")]);
  const report = vi.fn();
  let tickFn: () => void = () => undefined;
  const timers = {
    setInterval: vi.fn((fn: () => void) => {
      tickFn = fn;
      return 7;
    }),
    clearInterval: vi.fn(),
  };
  const s = createRoutineScheduler({ enabled: () => over.enabled ?? true, runner: runner as never, due, report, timers });
  return { s, runner, due, report, timers, fire: () => tickFn() };
}

describe("routineScheduler", () => {
  it("ticks every 30 seconds", () => {
    const t = setup();
    expect(t.timers.setInterval).toHaveBeenCalledWith(expect.any(Function), TICK_MS);
    expect(TICK_MS).toBe(30_000);
  });

  it("runs the FIRST due skill with trigger routine", async () => {
    const t = setup();
    await t.s.tick();
    expect(t.runner.start).toHaveBeenCalledTimes(1);
    expect(t.runner.start).toHaveBeenCalledWith({ skillId: "a", trigger: "routine" });
  });

  it("does nothing while agents are disabled", async () => {
    const t = setup({ enabled: false });
    await t.s.tick();
    expect(t.due).not.toHaveBeenCalled();
    expect(t.runner.start).not.toHaveBeenCalled();
  });

  it("does nothing while a run is active", async () => {
    const t = setup({ active: true });
    await t.s.tick();
    expect(t.due).not.toHaveBeenCalled();
    expect(t.runner.start).not.toHaveBeenCalled();
  });

  it("does nothing when nothing is due", async () => {
    const t = setup({ due: [] });
    await t.s.tick();
    expect(t.runner.start).not.toHaveBeenCalled();
  });

  it("reports a refused start and a failing lookup instead of swallowing them", async () => {
    const refused = setup({ start: async () => ({ ok: false, error: "unsupported" }) });
    await refused.s.tick();
    expect(refused.report).toHaveBeenCalledWith(expect.objectContaining({ message: "unsupported" }), "routineScheduler:start");

    const broken = setup();
    const boom = new Error("store unreadable");
    broken.due.mockRejectedValueOnce(boom);
    await broken.s.tick();
    expect(broken.report).toHaveBeenCalledWith(boom, "routineScheduler:tick");
  });

  it("does not overlap its own passes", async () => {
    const t = setup();
    await Promise.all([t.s.tick(), t.s.tick()]);
    expect(t.runner.start).toHaveBeenCalledTimes(1);
  });

  it("is disposable: dispose clears the timer", () => {
    const t = setup();
    t.s.dispose();
    expect(t.timers.clearInterval).toHaveBeenCalledWith(7);
  });
});
