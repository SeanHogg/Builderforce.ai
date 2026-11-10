import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore, scanByIndex } from "@builderforce/local-first";
import type { DynamicCheckOutcome } from "@builderforce/run-delta/predict";
import { sanitizeProductEvent } from "../telemetry/productEventChannel";
import {
  MAX_SCHEDULE_ROWS, readScheduleHistory, recordScheduleOutcomes, scheduleEvent, scheduleRowId, schedulerFor,
} from "./dynamicSchedule";
import { readRunDeltas, RUN_DELTAS_BY_RUN } from "./runDeltaRecords";

const REPO = "https://example.com/acme/app.git";
const outcome = (changedVerdict: boolean, extra: Partial<DynamicCheckOutcome> = {}): DynamicCheckOutcome =>
  ({ check: "benchmark", dimensionsTouched: ["performance"], policy: "opt-in", status: "ok", changedVerdict, ...extra });
const at = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString();

describe("dynamic-tier scheduling history (D9.1, device-only)", () => {
  it("folds a repository's rows into Beta counts; the sampler takes over only with enough history", async () => {
    const store = createMemoryLocalFirstStore();
    for (let i = 0; i < 19; i++) await recordScheduleOutcomes(store, { deviceId: "dev", at: at(i) }, { runId: `r${i}`, repository: REPO, outcomes: [outcome(i < 5)] });
    expect(schedulerFor(await readScheduleHistory(store, REPO))).toBeUndefined();
    await recordScheduleOutcomes(store, { deviceId: "dev", at: at(19) }, { runId: "r19", repository: REPO, outcomes: [outcome(false)] });
    const history = await readScheduleHistory(store, REPO); // the write dropped the memoised history
    expect(history.checks.benchmark).toEqual({ n: 20, k: 5 });
    expect(schedulerFor(history)).toBeDefined();
    expect(await readScheduleHistory(store, "https://example.com/other.git")).toEqual({ checks: {}, cells: {} });
  });

  it(`prunes a repository's rows beyond the newest ${MAX_SCHEDULE_ROWS} in the write`, async () => {
    const store = createMemoryLocalFirstStore();
    for (let i = 0; i <= MAX_SCHEDULE_ROWS; i++) {
      await recordScheduleOutcomes(store, { deviceId: "dev", at: at(i) }, { runId: `r${i}`, repository: REPO, outcomes: [outcome(false)] });
    }
    expect((await readScheduleHistory(store, REPO)).checks.benchmark).toEqual({ n: MAX_SCHEDULE_ROWS, k: 0 });
    await store.read(async (tx) => {
      expect(await tx.get("run-delta", scheduleRowId("r0", REPO))).toBeFalsy(); // the oldest went
      expect(await tx.get("run-delta", scheduleRowId(`r${MAX_SCHEDULE_ROWS}`, REPO))).toBeTruthy();
    });
  });

  it("a row is in its run's group, and the run's delta readers skip it", async () => {
    const store = createMemoryLocalFirstStore();
    await recordScheduleOutcomes(store, { deviceId: "dev", at: at(0) }, { runId: "r1", repository: REPO, outcomes: [outcome(true)] });
    const ids: string[] = [];
    await store.read((tx) => scanByIndex(tx, RUN_DELTAS_BY_RUN, "r1", (row) => { ids.push(row.id); }));
    expect(ids).toEqual([scheduleRowId("r1", REPO)]);
    expect(await readRunDeltas(store, { runId: "r1" })).toEqual([]);
  });

  it("sends the §10 counts only when the sampler decided, and they pass the allowlist", () => {
    expect(scheduleEvent([outcome(true)])).toBeUndefined();
    const event = scheduleEvent([
      outcome(true, { policy: "thompson" }), outcome(true, { policy: "thompson-explore", wouldRun: true }), outcome(false, { policy: "thompson", status: "failed" }),
    ])!;
    expect(sanitizeProductEvent("delta.dynamic_scheduled", event, new Date(0))?.props).toEqual({
      surface: "vscode", scheduled: 1, scheduledChanged: 1, explored: 1, exploredChanged: 1, exploredWouldRun: 1, exploredChangedWouldRun: 1, failed: 1, notScheduled: 0,
      budgetSkipped: 0,
    });
  });

  it("regression: a read that overlaps a write never memoises the history from before the write", async () => {
    const store = createMemoryLocalFirstStore();
    const repo = "https://example.com/acme/race.git";
    await recordScheduleOutcomes(store, { deviceId: "dev", at: at(0) }, { runId: "r0", repository: repo, outcomes: [outcome(false)] });
    const overlapping = readScheduleHistory(store, repo);
    await recordScheduleOutcomes(store, { deviceId: "dev", at: at(1) }, { runId: "r1", repository: repo, outcomes: [outcome(true)] });
    await overlapping;
    expect((await readScheduleHistory(store, repo)).checks.benchmark).toEqual({ n: 2, k: 1 });
  });

  it("budget skips are counted apart from posterior skips, and pass the allowlist", () => {
    const event = scheduleEvent([
      outcome(false, { policy: "thompson", status: "skipped", reason: "budget-exhausted", changedVerdict: null } as Partial<DynamicCheckOutcome>),
      outcome(false, { policy: "thompson", status: "skipped", reason: "not-scheduled", changedVerdict: null } as Partial<DynamicCheckOutcome>),
    ])!;
    expect(sanitizeProductEvent("delta.dynamic_scheduled", event, new Date(0))?.props).toMatchObject({ budgetSkipped: 1, notScheduled: 1 });
  });
});
