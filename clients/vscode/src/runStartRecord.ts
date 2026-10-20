/**
 * Run-start journal for interrupted-run recovery (G22).
 *
 * `runRecovery.ts` already journals a start, but activation and the run host do
 * not call it, and those files are owned by other writers. This module is the
 * record/recover contract they can call without rewriting the host:
 *
 *   recordRunStarted(store, run) writes { id, startedAt, status: "running" }.
 *   recoverInterruptedRuns(store, now) marks every still-running record
 *   interrupted and stamps interruptedAt. A completed run is never returned
 *   and never rewritten.
 *
 * It does not import `extension.ts` or `brainRunHostPorts.ts`, and it does not
 * replay a step.
 */

export const RUN_ID_REQUIRED = "run_id_required";

export type RunStartStatus = "running" | "interrupted" | "completed";

/** The record `recordRunStarted` writes. Recovery may add `interruptedAt`. */
export interface RunStartRecord {
  id: string;
  startedAt: string;
  status: RunStartStatus;
  interruptedAt?: string;
}

/** What a caller passes to start a run. Only `id` and `startedAt` are stored. */
export interface RunStartInput {
  id: string;
  startedAt: string;
}

/**
 * A journal that can list every start record and replace one by id.
 * `put` must store the object it is given (or an equivalent copy) and must
 * not be called by recovery for a record that is not `running`.
 */
export interface RunStartStore {
  put(record: RunStartRecord): void | Promise<void>;
  list(): readonly RunStartRecord[] | Promise<readonly RunStartRecord[]>;
}

export function createRunStartStore(): RunStartStore & { records: Map<string, RunStartRecord> } {
  const records = new Map<string, RunStartRecord>();
  return {
    records,
    put(record) {
      records.set(record.id, record);
    },
    list() {
      return [...records.values()];
    },
  };
}

function requireRunId(run: RunStartInput | null | undefined): string {
  const id = run?.id;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(RUN_ID_REQUIRED);
  }
  return id;
}

/**
 * Write `{ id, startedAt, status: "running" }`.
 * Throws `run_id_required` synchronously when `id` is missing or blank, and
 * does not touch the store in that case.
 */
export function recordRunStarted(store: RunStartStore, run: RunStartInput): void | Promise<void> {
  const id = requireRunId(run);
  return store.put({
    id,
    startedAt: run.startedAt,
    status: "running",
  });
}

/**
 * Every record still `running` is marked `interrupted` with `interruptedAt = now`
 * and returned. An empty list means nothing was running. A `completed` run is
 * neither returned nor written back.
 */
export async function recoverInterruptedRuns(store: RunStartStore, now: string): Promise<RunStartRecord[]> {
  const records = await store.list();
  const running = records.filter((record) => record.status === "running");
  if (running.length === 0) return [];
  const marked = running.map((record) => ({
    ...record,
    status: "interrupted" as const,
    interruptedAt: now,
  }));
  for (const record of marked) {
    await store.put(record);
  }
  return marked;
}
