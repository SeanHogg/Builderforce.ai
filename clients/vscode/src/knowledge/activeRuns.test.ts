import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ state: { running: [] as number[], awaiting: [] as number[] }, listeners: new Set<() => void>() }));
vi.mock("@seanhogg/builderforce-brain-embedded", () => ({
  getGlobalRunState: () => store.state,
  subscribeRunStore: (l: () => void) => { store.listeners.add(l); return () => { store.listeners.delete(l); }; },
}));

import { anyRunActive, onRunStarted } from "./activeRuns";

const set = (running: number[], awaiting: number[] = []): void => {
  store.state = { running, awaiting };
  for (const l of [...store.listeners]) l();
};

describe("activeRuns — the indexer's view of the run store", () => {
  it("regression: is active while a run executes — NOT while one waits on a confirmation nobody answers — and clears when the run store clears", () => {
    set([]);
    expect(anyRunActive()).toBe(false);
    set([7]);
    expect(anyRunActive()).toBe(true);
    set([], [7]);
    expect(anyRunActive()).toBe(false);
    set([]);
    expect(anyRunActive()).toBe(false);
  });

  it("calls back once per start (none -> some), not for a second run joining, nor for the end", () => {
    set([]);
    const started = vi.fn();
    const stop = onRunStarted(started);
    set([1]);
    set([1, 2]);
    set([2]);
    set([]);
    expect(started).toHaveBeenCalledTimes(1);
    set([3]);
    expect(started).toHaveBeenCalledTimes(2);
    stop();
    set([]);
    set([4]);
    expect(started).toHaveBeenCalledTimes(2);
  });
});
