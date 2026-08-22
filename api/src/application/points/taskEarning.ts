/**
 * A CLOSED TICKET → THE RIGHT EARNING ACTION.
 *
 * ── THE DISTINCTION, AND WHY IT COULD NOT BE A COLUMN READ ───────────────────
 * The points catalog pays a task completion two ways: `task.complete.system` for
 * work somebody was GIVEN, and `task.complete.user` — gated, capped, and watched
 * by the fraud engine — for work somebody set THEMSELVES. That split is the whole
 * anti-farming design: without it, "create a task, close it, repeat" is an
 * unbounded points printer.
 *
 * `tasks` has no author column. It records who a ticket is ASSIGNED to, never who
 * minted it, so the distinction is not available where it would be cheapest.
 *
 * What does record it is the audit log: every writer that mints a ticket emits
 * `verb='task.created'` with the actor attached (`activity/taskCreated.ts` is the
 * single path, so this is complete rather than best-effort). One indexed lookup on
 * `idx_activity_log_target` answers "did this person create the thing they just
 * closed", and it runs only for HUMAN completions — an agent closing its own
 * ticket is the platform working as designed and earns nobody anything.
 *
 * ── WHY NOT ADD THE COLUMN ───────────────────────────────────────────────────
 * Because the fact is already stored, and a `created_by` column would be a second
 * copy of it that backfills as NULL for every ticket in existence — which is
 * exactly the population a farming check most needs to be right about. Deriving it
 * from the log is correct for old tickets and new ones alike.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { activityLog } from '../../infrastructure/database/schema';
import { awardPoints } from './awardPoints';
import { POINT_ACTIONS } from './pointsCatalog';

/**
 * Pay for a completed ticket.
 *
 * Called from `recordStatusTransition`, which is the one path every lane move
 * funnels through — so this cannot be bypassed by a route that moves a ticket its
 * own way, and it cannot double-pay, because the award is idempotent on the
 * ticket id.
 *
 * Only humans earn. `actorKind` is already resolved by the caller, and passing it
 * rather than re-deriving it keeps one answer to "who did this".
 */
export async function awardForCompletedTask(
  db: Db, env: Env,
  input: { tenantId: number; taskId: number; actorKind: string; actorRef: string | null },
): Promise<void> {
  if (input.actorKind !== 'human' || !input.actorRef) return;

  const selfAuthored = await createdBy(db, input.tenantId, input.taskId) === input.actorRef;

  await awardPoints(
    db, env,
    selfAuthored ? POINT_ACTIONS.TASK_COMPLETE_USER : POINT_ACTIONS.TASK_COMPLETE_SYSTEM,
    {
      tenantId: input.tenantId,
      userId: input.actorRef,
      refId: String(input.taskId),
      metadata: { taskId: input.taskId, selfAuthored },
    },
  );
}

/** Who minted this ticket, per the audit log. Null when the log has no creation
 *  row — a ticket predating the unified log, or one minted by a system path that
 *  names no actor. Null is treated as "not self-authored", which is the LENIENT
 *  side of the gate and the right default: refusing to pay somebody for real work
 *  because an old audit row is missing is a worse failure than paying once for a
 *  ticket that might have been self-set. */
async function createdBy(db: Db, tenantId: number, taskId: number): Promise<string | null> {
  const [row] = await db
    .select({ actorRef: activityLog.actorRef })
    .from(activityLog)
    .where(and(
      eq(activityLog.tenantId, tenantId),
      eq(activityLog.targetType, 'task'),
      eq(activityLog.targetId, String(taskId)),
      eq(activityLog.verb, 'task.created'),
    ))
    .orderBy(desc(activityLog.id))
    .limit(1);
  return row?.actorRef ?? null;
}
