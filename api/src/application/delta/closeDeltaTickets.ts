/**
 * Close a set of delta tickets that a provider event proved shipped — the ONE close loop
 * shared by the merge webhook (`completeDeltaOnMerge`) and the push webhook
 * (`completeDeltaOnPush`).
 *
 * Every close goes THROUGH THE REVIEW GATE (1153) via {@link closeTicketAutomatically}: a
 * webhook is automation, so a human-gated review lane holds the ticket in review unless the
 * workspace lets the manager close reviewed tickets. No actor is passed — a webhook has no
 * user, and the completion path falls back to the agent whose run produced the work rather
 * than stamping it anonymous.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { closeTicketAutomatically, type AutoCloseSource } from '../manager/reviewGateAuthority';

export interface DeltaCloseTarget {
  tenantId: number;
  taskId: number;
  /** The evidence sentence the hold journal carries (e.g. "commit abc1234"). */
  evidence?: string | null;
}

export interface DeltaCloseOutcome {
  /** Task ids actually moved to done. */
  completed: number[];
  /** Task ids left in review because the board's review lane needs a person. */
  heldForReview: number[];
}

export async function closeDeltaTickets(
  env: Env,
  db: Db,
  source: Extract<AutoCloseSource, 'delta_merge' | 'delta_push'>,
  targets: readonly DeltaCloseTarget[],
): Promise<DeltaCloseOutcome> {
  const completed: number[] = [];
  const heldForReview: number[] = [];
  for (const t of targets) {
    const close = await closeTicketAutomatically(env, db, {
      tenantId: t.tenantId, taskId: t.taskId, source,
      ...(t.evidence ? { heldDetail: t.evidence } : {}),
    });
    (close.closed ? completed : heldForReview).push(t.taskId);
  }
  return { completed, heldForReview };
}
