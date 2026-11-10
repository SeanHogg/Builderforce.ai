/**
 * The dynamic tier's scheduling history on this device (PRD 41 D9.1, WS20): per run and repository, each dynamic check's
 * outcome (did it run, was it decisive for a verdict) as a device-only `run-delta` row,
 * `run-delta-schedule:<runId>:<repo hash>`, indexed by the synced repository identity — put, never journaled, so it never
 * syncs. It carries its `runId`, so it is in the run's `RUN_DELTAS_BY_RUN` group with the run's other delta rows (whose
 * readers skip a payload that is not theirs).
 *
 * Bounded: each write prunes the repository's rows beyond the newest {@link MAX_SCHEDULE_ROWS} in the same transaction, and
 * the folded {@link ScheduleHistory} is memoised per repository, dropped on every write.
 *
 * Also the §10 measure: per run the sampler decided, the counts of decisive checks it ran against its seeded random
 * exploration (`delta.dynamic_scheduled`, counts only, through the product-event channel).
 */

import { defineRecordIndex, newLocalRecord, scanByIndex, type LocalFirstStore } from "@builderforce/local-first";
import type { DynamicCheckScheduler } from "@builderforce/run-delta";
import {
  EXPLORE_POLICY, THOMPSON_POLICY, hasScheduleHistory, scheduleHistoryOf, scheduleTelemetry, thompsonScheduler,
  type DynamicCheckOutcome, type ScheduleHistory,
} from "@builderforce/run-delta/predict";
import { sha } from "./runDeltaRecords";

/** The device-only row. */
export interface RunDeltaScheduleValue {
  kind: "dynamic-schedule";
  runId: string;
  /** As synced (`RunDeltaRecordValue.repository`): a remote URL, else `local:<hash>`. */
  repository: string;
  /** When the tier ran (ISO): the newest {@link MAX_SCHEDULE_ROWS} are kept. */
  at: string;
  outcomes: DynamicCheckOutcome[];
}

/** At most this many runs of a repository are kept and feed its posteriors (the newest). */
export const MAX_SCHEDULE_ROWS = 500;

const isScheduleValue = (p: unknown): p is RunDeltaScheduleValue =>
  !!p && typeof p === "object" && (p as { kind?: unknown }).kind === "dynamic-schedule" && Array.isArray((p as { outcomes?: unknown }).outcomes);

/** The schedule rows of one repository. */
export const RUN_DELTA_SCHEDULES_BY_REPOSITORY = defineRecordIndex<RunDeltaScheduleValue>(
  "run-delta", "vscode.runDelta.scheduleRepository", (row) => (isScheduleValue(row.payload) ? row.payload.repository : undefined),
);

export const scheduleRowId = (runId: string, repository: string): string => `run-delta-schedule:${runId}:${sha(repository).slice(0, 16)}`;

/** Folded histories by repository; a write to a repository drops its entry. */
const memo = new Map<string, ScheduleHistory>();
/**
 * Writes per repository: a read that started before a write finishes must not memoise the history it folded (it may
 * predate the write), so a read memoises only when the generation it started at is still current.
 */
const generation = new Map<string, number>();

/** A repository's scheduling history: Beta counts over its rows (at most {@link MAX_SCHEDULE_ROWS}, pruned on write). */
export async function readScheduleHistory(store: LocalFirstStore, repository: string): Promise<ScheduleHistory> {
  const held = memo.get(repository);
  if (held) return held;
  const startedAt = generation.get(repository) ?? 0;
  const rows: RunDeltaScheduleValue[] = [];
  await store.read(async (tx) => {
    await scanByIndex<RunDeltaScheduleValue>(tx, RUN_DELTA_SCHEDULES_BY_REPOSITORY, repository, (row) => {
      if (!row.deletedAt && isScheduleValue(row.payload)) rows.push(row.payload);
    });
  });
  const newest = rows.sort((a, b) => b.at.localeCompare(a.at) || a.runId.localeCompare(b.runId)).slice(0, MAX_SCHEDULE_ROWS);
  const history = scheduleHistoryOf(newest.flatMap((r) => r.outcomes));
  if ((generation.get(repository) ?? 0) === startedAt) memo.set(repository, history);
  return history;
}

/** The Thompson sampler when the repository's posteriors exist; undefined (the opt-in default) otherwise. */
export function schedulerFor(history: ScheduleHistory): DynamicCheckScheduler | undefined {
  return hasScheduleHistory(history) ? thompsonScheduler(history) : undefined;
}

/**
 * Stores one run's outcomes (device-only; a re-run of the same run and repository replaces its row) and, in the same
 * transaction, deletes the repository's rows beyond the newest {@link MAX_SCHEDULE_ROWS}.
 */
export async function recordScheduleOutcomes(
  store: LocalFirstStore, deps: { deviceId: string; at: string }, run: { runId: string; repository: string; outcomes: DynamicCheckOutcome[] },
): Promise<void> {
  if (run.outcomes.length === 0) return;
  const id = scheduleRowId(run.runId, run.repository);
  try {
    await store.transact(async (tx) => {
      await tx.put(newLocalRecord<RunDeltaScheduleValue>({
        id, entityType: "run-delta", deviceId: deps.deviceId, occurredAt: deps.at, schemaVersion: 1,
        payload: { kind: "dynamic-schedule", runId: run.runId, repository: run.repository, at: deps.at, outcomes: run.outcomes },
      }));
      const rows: Array<{ id: string; at: string; runId: string }> = [];
      await scanByIndex<RunDeltaScheduleValue>(tx, RUN_DELTA_SCHEDULES_BY_REPOSITORY, run.repository, (row) => {
        if (!row.deletedAt && isScheduleValue(row.payload)) rows.push({ id: row.id, at: row.payload.at, runId: row.payload.runId });
      });
      rows.sort((a, b) => b.at.localeCompare(a.at) || a.runId.localeCompare(b.runId));
      for (const old of rows.slice(MAX_SCHEDULE_ROWS)) await tx.delete("run-delta", old.id);
    });
  } finally {
    generation.set(run.repository, (generation.get(run.repository) ?? 0) + 1);
    memo.delete(run.repository);
  }
}

/** The §10 event of a run the sampler decided (`delta.dynamic_scheduled`); undefined when it decided nothing. */
export function scheduleEvent(outcomes: readonly DynamicCheckOutcome[]): Record<string, string | number> | undefined {
  if (!outcomes.some((o) => o.policy === THOMPSON_POLICY || o.policy === EXPLORE_POLICY)) return undefined;
  return { surface: "vscode", ...scheduleTelemetry(outcomes) };
}
