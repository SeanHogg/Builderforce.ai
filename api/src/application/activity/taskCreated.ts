/**
 * THE ONE PLACE A TICKET'S CREATION IS RECORDED.
 *
 * Measured 2026-07-25 across 821 tickets: **722 (88%) had no `task.created` activity row
 * at all**, so "who opened this — the AI Manager or a person?" was unanswerable for the
 * overwhelming majority and they audited as `origin: 'unknown'`. The lifecycle ledger's
 * whole origin axis — the axis the autonomy funnel is broken down BY — was reporting on
 * 12% of the fleet.
 *
 * The reason was structural, not a missed line: only ONE writer emitted the row (the HTTP
 * create route). Every other path that mints a ticket did not, and there are six of them:
 * `QaFindingRouter`, `ValidationService`, `IncidentService`, `SecurityAuditService`,
 * board-sync inbound, and `decomposeEpic`'s child fan-out. Adding a call to each would
 * have left the seventh writer to be forgotten in the same way.
 *
 * So creation attribution now hangs off the ACT of creating, not off the caller
 * remembering: `TaskService.createTask` and `TaskService.decomposeEpic` invoke this
 * through a composition-root hook, which is the funnel every one of those six already
 * passes through. Board-sync — which inserts rows directly and cannot use the service —
 * calls it explicitly, and is the only path that has to.
 *
 * TWO INVARIANTS the previous ad-hoc emitters broke:
 *
 *  • **`target_type` is always `'task'`.** The MCP writer wrote `'tasks'` while the HTTP
 *    route wrote `'task'` (103 rows against 8), so the ledger read one and silently
 *    missed the other. The ledger now reads both for history's sake; nothing new should
 *    ever be written in the plural.
 *  • **At most one creation row per ticket.** The route still fires its board-event
 *    trigger and the service still emits, so both can reach a single create. The guard
 *    below makes the second a no-op rather than a duplicate — which is what makes it safe
 *    for a new writer to call this without checking whether some other layer already did.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { activityLog } from '../../infrastructure/database/schema';
import { recordActivity, SYSTEM_ACTOR, type ActorIdentity } from './activityLog';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** The verb every creation row carries. */
export const TASK_CREATED_VERB = 'task.created';

/**
 * Target types a historical creation row may carry. `'tasks'` is the MCP writer's
 * pre-canonicalization plural — read for the duplicate guard so a ticket created before
 * the fix cannot acquire a second row now.
 */
const TASK_TARGET_TYPES = ['task', 'tasks'] as const;

export interface TaskCreatedInput {
  tenantId: number;
  segmentId?: string | null;
  taskId: number;
  projectId: number | null;
  /** Ticket title, for the activity row's label. */
  title: string | null;
  /** Ticket key (`PRJ-12`), for the summary sentence. */
  key?: string | null;
  /**
   * WHO opened it. Absent ⇒ {@link SYSTEM_ACTOR}, which is the honest answer for a
   * writer with no identity (a webhook, a sweep) and a much better one than no row.
   */
  actor?: ActorIdentity;
  /** Which writer minted it — `qa_finding`, `validation_gap`, `incident`, `security_audit`,
   *  `board_sync`, `epic_child`, `http`, `mcp`. Lands in `metadata.origin`. */
  via?: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Record that a ticket was created. Best-effort by contract: creation must never fail
 * because its audit row could not be written.
 *
 * Idempotent per ticket — see the module header for why that is load-bearing rather than
 * defensive.
 */
export async function recordTaskCreated(env: Env | undefined, db: Db, input: TaskCreatedInput): Promise<void> {
  try {
    const existing = await db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(and(
        eq(activityLog.tenantId, input.tenantId),
        eq(activityLog.verb, TASK_CREATED_VERB),
        inArray(activityLog.targetType, [...TASK_TARGET_TYPES]),
        eq(activityLog.targetId, String(input.taskId)),
      ))
      .limit(1);
    if (existing.length > 0) return;

    await recordActivity(env, db, {
      tenantId:    input.tenantId,
      segmentId:   input.segmentId ?? null,
      projectId:   input.projectId ?? null,
      actor:       input.actor ?? SYSTEM_ACTOR,
      verb:        TASK_CREATED_VERB,
      targetType:  'task',
      targetId:    input.taskId,
      targetLabel: input.title ?? null,
      summary:     `Created ${input.key ?? `#${input.taskId}`}`,
      metadata:    { ...(input.metadata ?? {}), ...(input.via ? { origin: input.via } : {}) },
    });
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/activity/taskCreated.ts',
      operation: 'recordTaskCreated',
      context: { details: { taskId: input.taskId, via: input.via ?? null } },
    });
  }
}
