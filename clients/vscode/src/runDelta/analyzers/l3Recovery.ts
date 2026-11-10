/**
 * After a restart (PRD 41 §6 "Agent run"): a stored delta whose L3 analyzers are still `pending` lost its phase 2 with
 * the editor — the prepared inputs phase 2 recomputes from live only in memory and are not kept across a restart (they
 * hold every changed file's text on both sides). So it is SETTLED as final: every pending analyzer `failed` /
 * `interrupted` (run-delta `settlePendingAnalyzers`, a new digest), stored as a revision and its card re-posted. A card
 * never stays "measuring" across restarts.
 *
 * The run's hold needs nothing here: an autonomous run's terminal status waits on the finalize gate, which lives in the
 * editor too — a restart mid-wait leaves the run to run recovery (it never completes unmeasured on its own).
 */

import type { LocalFirstStore } from "@builderforce/local-first";
import { ANALYZER_RULES, DEFAULT_REGISTRIES, hasPendingAnalyzers, settlePendingAnalyzers } from "@builderforce/run-delta";
import { readRunDeltas, reviseRunDelta, type RunDeltaCard, type RunDeltaRecordValue, type StoredRunDelta } from "../runDeltaRecords";

/** The reason a pending analyzer is settled with after a restart. */
export const INTERRUPTED = "interrupted";

/** Settles every stored delta with pending analyzers; returns how many were settled. Never throws. */
export async function settleInterruptedDeltas(
  store: LocalFirstStore, deps: { post(card: RunDeltaCard): void; at?: () => string; onError?(error: unknown): void },
): Promise<number> {
  let settled = 0;
  try {
    const rows = (await store.read((tx) => tx.list<RunDeltaRecordValue>("run-delta")))
      .filter((r) => !r.deletedAt && !!r.payload?.delta && hasPendingAnalyzers(r.payload.delta));
    for (const row of rows) {
      const value = row.payload;
      const delta = settlePendingAnalyzers(value.delta, INTERRUPTED, ANALYZER_RULES, DEFAULT_REGISTRIES.blocking);
      const stored = { value: { ...value, delta }, local: undefined } as unknown as StoredRunDelta;
      if (!(await reviseRunDelta(store, { at: deps.at?.() ?? new Date().toISOString() }, stored))) continue;
      settled++;
      for (const card of await readRunDeltas(store, { runId: value.runId })) deps.post(card);
    }
  } catch (error) {
    deps.onError?.(error);
  }
  return settled;
}
