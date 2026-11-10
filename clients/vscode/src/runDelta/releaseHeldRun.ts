/**
 * The audited release of a run held at its finalize gate (PRD 41 §12.5): the host side of `run-delta/release`.
 *
 * A release, in order:
 *   1. waits (bounded) for the run's hold to be journaled — the held card can reach the chat a moment before its hold is
 *      written; still not written by then: refused `pending` (try again), never `not_held`;
 *   2. checks who releases (`releaseAuthority.ts`): a signed-in person, with the board's approver authority when the run
 *      is on a board — refused `identity_required` / `not_approver` otherwise;
 *   3. writes the execution `completed`, keeping its `hold` and adding the `waiver` (who, when, which rules) —
 *      `runRecovery.recordRunReleased`, which checks and writes in one transaction (a run not held, or already released:
 *      `not_held`);
 *   4. puts the same waiver on the audit-run record when the run is an audit's (`localAuditGate.recordLocalAuditGate`);
 *   5. posts the run's delta cards again: read back, they say `released: true` (the execution's waiver, `runHoldState.ts`).
 * Every refusal is one of `RUN_DELTA_RELEASE_REFUSED` (the `@builderforce/run-delta` contract); anything unexpected is
 * logged and answered `error`. Nothing is written on a refusal. It never touches auto-approve: a release is one person's
 * decision about one run.
 */

import type { LocalFirstStore, RunWaiver } from "@builderforce/local-first";
import { RUN_DELTA_RELEASE_REFUSED } from "@builderforce/run-delta/contract";
import type { InstalledRunRecovery } from "../installRunRecovery";
import { recordLocalAuditGate } from "../localAuditGate";

/** How long a release waits for a just-held run's hold to be journaled before it is refused `pending`. */
export const RELEASE_JOURNAL_WAIT_MS = 5_000;

export interface ReleaseHeldRunDeps {
  recovery: Pick<InstalledRunRecovery, "recordReleased">;
  /** The store the audit-run records live in. */
  store: LocalFirstStore;
  /** Resolves true once the run's verdict and hold write have landed (or none is pending), false when the wait ran out. */
  journaled(runId: string): Promise<boolean>;
  /** The releasing person, once they may release this run (`releaseAuthority.authorizeRelease`); rejects with the refusal. */
  releaser(runId: string): Promise<string>;
  /** Posts the run's stored delta cards again. */
  repost(runId: string): Promise<void>;
  log(what: string, error: unknown): void;
  now?: () => Date;
}

const REFUSALS: ReadonlySet<string> = new Set(Object.values(RUN_DELTA_RELEASE_REFUSED));

/** A refusal as it is; anything else, logged, as `error`. */
function refusalOf(error: unknown, deps: Pick<ReleaseHeldRunDeps, "log">, runId: string): Error {
  if (error instanceof Error && REFUSALS.has(error.message)) return error;
  deps.log(`release ${runId}`, error);
  return new Error(RUN_DELTA_RELEASE_REFUSED.error);
}

/** Releases a held run, or rejects with one of `RUN_DELTA_RELEASE_REFUSED` and writes nothing. */
export async function releaseHeldRun(deps: ReleaseHeldRunDeps, runId: string): Promise<RunWaiver> {
  let waiver: RunWaiver;
  try {
    if (!(await deps.journaled(runId))) throw new Error(RUN_DELTA_RELEASE_REFUSED.pending);
    const by = await deps.releaser(runId);
    waiver = await deps.recovery.recordReleased({ runId, by });
  } catch (error) {
    throw refusalOf(error, deps, runId);
  }
  await recordLocalAuditGate(deps.store, { ...(deps.now ? { now: deps.now } : {}) }, { runId, waiver })
    .catch((error: unknown) => deps.log(`audit waiver ${runId}`, error));
  await deps.repost(runId).catch((error: unknown) => deps.log(`repost ${runId}`, error));
  return waiver;
}
