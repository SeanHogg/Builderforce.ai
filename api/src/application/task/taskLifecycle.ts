/**
 * Ticket-lifecycle recording — the write half of the metrics layer (migrations
 * 0117/0118). Called from PATCH /api/tasks/:id whenever a task changes status
 * (lane). Appends one {@link taskStatusTransitions} row and updates the
 * denormalized lifecycle counters on the task so board reads never have to
 * aggregate the log.
 *
 * Direction (redo signal) is derived from the project board's swimlane ordinals:
 * a move to a lower-position lane is "backward" = a redo/iteration. The ordinal
 * map is cached read-through (boards/swimlanes change rarely) so the hot PATCH
 * path does not re-query the board on every move.
 */
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { boards, swimlanes, tasks, taskStatusTransitions } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached, projectScoreCacheKey, tenantRollupCacheKey } from '../../infrastructure/cache/readThroughCache';
import { bumpWorkforceMetricsVersion } from '../metrics/workforceMetrics';
import { releaseWorkItemWebhook } from '../seams/workItemWebhook';
import { TaskStatus } from '../../domain/shared/types';

/** Lane keys that mean "done". Mirrors reportRoutes.DONE_CLASS_STATUSES; also
 *  any swimlane flagged `isTerminal` is treated as done-class at runtime. */
const DONE_CLASS = new Set<string>([TaskStatus.DONE]);

type LaneInfo = { position: number; isTerminal: boolean };
type OrdinalMap = Record<string, LaneInfo>;

function ordinalsCacheKey(projectId: number): string {
  return `swimlane-ordinals:project:${projectId}`;
}

/** Per-project lane-key → {position, isTerminal} map, cached (board layout is
 *  slow-changing). Empty object when the project has no board yet (free-form
 *  status with no swimlane → direction undeterminable, recorded as null). */
async function loadOrdinals(env: Env, db: Db, projectId: number): Promise<OrdinalMap> {
  return getOrSetCached(env, ordinalsCacheKey(projectId), async () => {
    const rows = await db
      .select({ key: swimlanes.key, position: swimlanes.position, isTerminal: swimlanes.isTerminal })
      .from(swimlanes)
      .innerJoin(boards, eq(boards.id, swimlanes.boardId))
      .where(eq(boards.projectId, projectId));
    const map: OrdinalMap = {};
    for (const r of rows) map[r.key] = { position: r.position, isTerminal: r.isTerminal };
    return map;
  });
}

/** Call when a project's swimlanes change so the cached ordinal map re-loads. */
export async function invalidateSwimlaneOrdinals(env: Env, projectId: number): Promise<void> {
  await invalidateCached(env, ordinalsCacheKey(projectId));
}

function isDoneClass(status: string, ordinals: OrdinalMap): boolean {
  return DONE_CLASS.has(status) || ordinals[status]?.isTerminal === true;
}

export interface RecordTransitionInput {
  tenantId: number;
  projectId: number;
  taskId: number;
  fromStatus: string | null;
  toStatus: string;
  /** The authenticated user who moved it, if any (a human keeping the board
   *  honest). Absent ⇒ the move came from an agent/automation ⇒ actor 'system'. */
  actorUserId?: string | null;
}

/**
 * Record one lane move and fold it into the task's lifecycle counters. Pure
 * best-effort: callers run it in waitUntil so a metrics failure never blocks the
 * PATCH. A no-op when status didn't actually change.
 */
export async function recordStatusTransition(env: Env, db: Db, input: RecordTransitionInput): Promise<void> {
  const { tenantId, projectId, taskId, fromStatus, toStatus, actorUserId } = input;
  if (fromStatus === toStatus) return;

  const ordinals = await loadOrdinals(env, db, projectId);
  const fromPos = fromStatus != null ? ordinals[fromStatus]?.position : undefined;
  const toPos = ordinals[toStatus]?.position;
  const isBackward = fromPos != null && toPos != null ? toPos < fromPos : null;

  const wasDone = fromStatus != null && isDoneClass(fromStatus, ordinals);
  const nowDone = isDoneClass(toStatus, ordinals);

  await db.insert(taskStatusTransitions).values({
    tenantId,
    projectId,
    taskId,
    fromStatus,
    toStatus,
    actorKind: actorUserId ? 'human' : 'system',
    actorRef: actorUserId ?? null,
    isBackward,
  });

  // Fold into the task's denormalized lifecycle columns.
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (nowDone) {
    // Entered a done-class lane: stamp completion. Leave lastWorkedAt as the last
    // pre-done move so idle-after-done = completedAt − lastWorkedAt.
    patch.completedAt = new Date();
  } else {
    // Still in flight: this move is the latest "work happened" marker.
    patch.lastWorkedAt = new Date();
    if (wasDone) {
      // Bounced back out of done = a reopen (premature close / regression).
      patch.completedAt = null;
      patch.reopenCount = sql`${tasks.reopenCount} + 1`;
    }
  }
  if (isBackward === true) {
    patch.redoCount = sql`${tasks.redoCount} + 1`;
  }

  await db.update(tasks).set(patch).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));

  // Invalidate the workforce scorecard / DORA caches for this tenant.
  await bumpWorkforceMetricsVersion(env, tenantId).catch(() => {});

  // A status transition (a manual PATCH, an agent advance, OR a PR-merge completion via
  // completeTaskOnMerge) can flip a remediation ticket's badge — so drop the diagnostics
  // project-score + tenant-rollup caches that carry it, instead of letting the badge lag
  // the transition by the read-through TTL. Over-invalidation is cheap (300s recompute).
  await Promise.all([
    invalidateCached(env, projectScoreCacheKey(tenantId, projectId)).catch(() => {}),
    invalidateCached(env, tenantRollupCacheKey(tenantId)).catch(() => {}),
  ]);

  // A work item FIRST reaching a released/done lane fans out `workitem.released`
  // to any segment webhook subscriptions (the Investor board / Changelog feed,
  // spec 05 §4.3). Segment-gated + best-effort: a no-op for single-mode tenants
  // (no segment) or when nothing subscribed; never blocks the metrics path.
  if (nowDone && !wasDone) {
    await releaseWorkItemWebhook(db, { tenantId, taskId }).catch(() => {});
    // FAST Validator review: the moment work is Done, kick an acceptance review (if the
    // tenant has a Validator) instead of waiting for the daily sweep. Dynamic import
    // breaks the taskLifecycle → validationDispatch → runtimeRoutes → taskLifecycle
    // cycle; best-effort (the review run is non-mutating, so no completion loop).
    await import('../validation/validationDispatch')
      .then((m) => m.triggerFastValidatorReview(env, db, { tenantId, taskId }))
      .catch(() => {});
  }
}

/**
 * Mark the task linked to a just-merged/deployed PR as Done — the SINGLE completion
 * path shared by the human "Approve & Merge" route, the AI Manager sweep, and the
 * green-CI / post-deploy webhooks, so "merge & deploy → ticket complete" can never
 * drift or be forgotten on one path. Best-effort + idempotent: a no-op when the task
 * is missing or already in a done-class lane. Sets the `status` column AND folds the
 * transition into the lifecycle metrics (completedAt / DORA / release webhook) via
 * {@link recordStatusTransition} — the plain db.update the manager used skipped the
 * metrics, which this closes.
 */
export async function completeTaskOnMerge(
  env: Env,
  db: Db,
  input: { tenantId: number; taskId: number; actorUserId?: string | null },
): Promise<void> {
  const [t] = await db
    .select({ status: tasks.status, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, input.taskId))
    .limit(1);
  if (!t) return;
  const ordinals = await loadOrdinals(env, db, t.projectId);
  if (isDoneClass(t.status, ordinals)) return; // already complete — nothing to do
  await db.update(tasks).set({ status: TaskStatus.DONE, updatedAt: new Date() }).where(eq(tasks.id, input.taskId));
  await recordStatusTransition(env, db, {
    tenantId: input.tenantId,
    projectId: t.projectId,
    taskId: input.taskId,
    fromStatus: t.status,
    toStatus: TaskStatus.DONE,
    actorUserId: input.actorUserId ?? null,
  }).catch(() => { /* metrics are best-effort; completion already persisted */ });
}

/**
 * Stamp `tasks.last_worked_at = now()` — the true "work stopped" signal emitted
 * when an agent execution reaches a terminal state (completed OR failed). This is
 * the baseline for idle-after-done: the gap between the agent finishing and a
 * human dragging the ticket into a done lane. Sharper than the lane-move
 * approximation because a failed run leaves the lane unchanged.
 */
export async function stampLastWorked(env: Env, db: Db, tenantId: number, taskId: number): Promise<void> {
  await db.update(tasks).set({ lastWorkedAt: new Date() }).where(eq(tasks.id, taskId));
  await bumpWorkforceMetricsVersion(env, tenantId).catch(() => {});
}

/** Info for {@link syncExecutionTaskLifecycle} — one execution→task status sync. */
export interface ExecutionTaskSync {
  tenantId: number;
  taskId: number;
  projectId: number;
  fromStatus: string;
  toStatus: string;
  /** The execution reached a terminal state (completed/failed) — stamp last_worked_at. */
  terminal: boolean;
}

/**
 * Bridge the agent-execution lifecycle into the ticket-metrics layer. Wired into
 * RuntimeService so an agent moving a task (RUNNING→in_progress, COMPLETED→
 * in_review/done) records a transition exactly like a human PATCH, and a terminal
 * run stamps the work-stopped signal even when the lane doesn't change (FAILED).
 */
export async function syncExecutionTaskLifecycle(env: Env, db: Db, info: ExecutionTaskSync): Promise<void> {
  if (info.fromStatus !== info.toStatus) {
    await recordStatusTransition(env, db, {
      tenantId: info.tenantId,
      projectId: info.projectId,
      taskId: info.taskId,
      fromStatus: info.fromStatus,
      toStatus: info.toStatus,
      actorUserId: null, // agent/automation move ⇒ actor 'system'
    });
  }
  if (info.terminal) {
    await stampLastWorked(env, db, info.tenantId, info.taskId);
  }
}
