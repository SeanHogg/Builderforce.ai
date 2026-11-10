/**
 * The audited release of a run held at its finalize gate (PRD 41 §12.5): the host side of `run-delta/release`.
 *
 * Only a run whose execution is `awaiting_input` with a `run_delta_blocking` hold is released; anything else is refused
 * with `run_delta_release_refused` and nothing is written. A release:
 *   1. writes the execution `completed`, keeping its `hold` and adding the `waiver` (who, when, which rules) —
 *      `runRecovery.recordRunReleased`, which checks and writes in one transaction;
 *   2. puts the same waiver on the audit-run record when the run is an audit's (`localAuditStore.recordLocalAuditGate`);
 *   3. posts the run's delta cards again: read back, they say `released: true` (the waiver is what `readRunDeltas` reads).
 * It never touches auto-approve: a release is one person's decision about one run.
 */

import type { LocalFirstStore, RunWaiver } from "@builderforce/local-first";
import type { InstalledRunRecovery } from "../installRunRecovery";
import { recordLocalAuditGate } from "../localAuditStore";

export interface ReleaseHeldRunDeps {
  recovery: Pick<InstalledRunRecovery, "recordReleased">;
  /** The store the audit-run records live in. */
  store: LocalFirstStore;
  /** Who releases: the signed-in user's id, else `local`. */
  by(): Promise<string>;
  /** Posts the run's stored delta cards again. */
  repost(runId: string): Promise<void>;
  log(what: string, error: unknown): void;
  now?: () => Date;
}

/** Releases a held run. Rejects with `run_delta_release_refused` for any run that is not held at its gate. */
export async function releaseHeldRun(deps: ReleaseHeldRunDeps, runId: string): Promise<RunWaiver> {
  const waiver = await deps.recovery.recordReleased({ runId, by: await deps.by() });
  await recordLocalAuditGate(deps.store, { ...(deps.now ? { now: deps.now } : {}) }, { runId, waiver })
    .catch((error: unknown) => deps.log(`audit waiver ${runId}`, error));
  await deps.repost(runId).catch((error: unknown) => deps.log(`repost ${runId}`, error));
  return waiver;
}

/** The releasing person: the signed-in user's id, else `local` (signed out, or the identity cannot be read). */
export async function releaserOf(currentUserId: () => Promise<string | null>): Promise<string> {
  try {
    return (await currentUserId()) ?? "local";
  } catch {
    return "local";
  }
}
