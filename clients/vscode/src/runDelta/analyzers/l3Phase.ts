/**
 * Phase 2 of the run delta (PRD 41 §6 "Agent run": "the card is posted in 'measuring' state and filled as the analyzers
 * settle"). Phase 1 (`finalizeRunDelta.ts`) computed, stored and posted the static delta with every L3 analyzer
 * `pending` (engine `ComputeOptions.analyzers: 'pending'`). This is the detached job that finishes it, one per repository,
 * queued on the background indexer's L3 gate (`knowledge/l3Tasks.ts`: idle, on mains, one at a time):
 *
 *   1. run the analyzers on both sides (`repoAnalyzers.ts`, each tool bounded by `ANALYZER_TIMEOUT_MS`);
 *   2. recompute with the SAME prepared inputs plus their results (a new digest);
 *   3. store it as a superseding revision of the record (`reviseRunDelta`) and re-post the card;
 *   4. an autonomous run whose phase-1 delta had a blocking analyzer kind pending: its hold port hears the final blocking
 *      codes (or `unmeasured` when the job failed), then `settled`.
 *
 * A job that fails still lands a final delta: every analyzer `failed` with the reason — the card never stays `pending`.
 */

import { ANALYZER_RULES, type AnalyzerResult, type RunDelta } from "@builderforce/run-delta";
import type { PreparedDelta } from "../preparedPorts";
import { DEFAULT_EXTENSION_CAPS, type RunHoldPort } from "../runHoldGate";
import type { StoredRunDelta } from "../runDeltaRecords";
import type { PreparedAnalyzers } from "./repoAnalyzers";

/** How long an autonomous run's hold waits for its pending blocking analyzers (the gate's deadline moves by this). */
export const L3_HOLD_WAIT_MS = DEFAULT_EXTENSION_CAPS.l3;

/** The prefix of a phase-1 blocking code that waits for an analyzer (`analyzer-pending:<tool>`). */
export const PENDING_BLOCKING = "analyzer-pending:";

export interface L3Job {
  root: string;
  prepared: PreparedDelta;
  /** The phase-1 delta as stored. */
  stored: StoredRunDelta;
  /** Present when the run's hold waits for this job (its phase-1 delta had a pending blocking code). */
  hold?: RunHoldPort;
}

export interface L3PhaseDeps {
  analyze(root: string, prepared: PreparedDelta, signal: AbortSignal): Promise<PreparedAnalyzers>;
  compute(prepared: PreparedDelta, signal: AbortSignal): Promise<RunDelta>;
  /** Stores the final delta as a revision; false when it was not written (the record is gone). */
  revise(stored: StoredRunDelta): Promise<boolean>;
  /** Re-posts the card of a revised delta. */
  repost(stored: StoredRunDelta): void;
  onError(error: unknown): void;
  /** Today, ISO date (osv data age). */
  today?(): string;
}

/** Every analyzer row failed with one reason: the final delta of a job that could not run. */
export function failedTier(reason: string): PreparedAnalyzers {
  const run = (tool: string): AnalyzerResult => ({ tool, version: "", status: "failed", reason, findings: [] });
  return { before: ANALYZER_RULES.filter((r) => r.sides !== "after").map((r) => run(r.tool)), after: ANALYZER_RULES.map((r) => run(r.tool)) };
}

/** The phase-1 blocking codes that hold the run now (the pending ones wait for phase 2). */
export const blockingNow = (codes: readonly string[]): string[] => codes.filter((c) => !c.startsWith(PENDING_BLOCKING));
/** Whether a phase-1 delta waits on an analyzer to certify an autonomous run. */
export const waitsForL3 = (delta: RunDelta): boolean => delta.blocking.some((c) => c.startsWith(PENDING_BLOCKING));

/** Runs one job to its final revision. Never rejects. */
export async function runL3Phase(job: L3Job, deps: L3PhaseDeps, signal: AbortSignal): Promise<void> {
  const started = Date.now();
  const today = deps.today?.() ?? new Date().toISOString().slice(0, 10);
  let final: RunDelta | undefined;
  let ok = true;
  try {
    let analyzers: PreparedAnalyzers;
    try {
      analyzers = await deps.analyze(job.root, job.prepared, signal);
    } catch (error) {
      deps.onError(error);
      ok = false;
      analyzers = failedTier(signal.aborted ? "timeout" : "analyzer-threw");
    }
    final = await deps.compute({ ...job.prepared, analyzers, options: { analyzers: "run", asOf: today } }, signal);
    const stored: StoredRunDelta = { ...job.stored, value: { ...job.stored.value, delta: final, computedMs: job.stored.value.computedMs + (Date.now() - started) } };
    if (await deps.revise(stored)) deps.repost(stored);
  } catch (error) {
    deps.onError(error);
    ok = false;
  } finally {
    if (job.hold) {
      if (!ok || !final) job.hold.unmeasured();
      else if (final.blocking.length > 0) job.hold.block(final.blocking);
      job.hold.settled();
    }
  }
}
