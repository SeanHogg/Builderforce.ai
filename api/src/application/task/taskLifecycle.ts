import { reportCaughtError } from '../observability/caughtErrorReporter';
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
 *
 * ATTRIBUTION — `actor_kind`/`actor_ref` name WHO moved the ticket, across all four
 * kinds (human, cloud agent, on-prem host agent, identity-less automation). See
 * {@link resolveTransitionActor}: every caller supplies the identity it actually holds
 * and the classification happens once, here, rather than each call site inventing its
 * own idea of what "not a human" means. Readers that only ask "was this autonomous?"
 * keep working unchanged — every agent kind is still `!== 'human'`.
 */
import { and, desc, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { boards, executions, swimlanes, tasks, taskStatusTransitions } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached, projectScoreCacheKey, tenantRollupCacheKey } from '../../infrastructure/cache/readThroughCache';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { parseMachineSubject } from '../../infrastructure/auth/machineSubject';
import { bumpWorkforceMetricsVersion } from '../metrics/workforceMetrics';
import { releaseWorkItemWebhook } from '../seams/workItemWebhook';
import { fireEventTriggers } from '../workflow/eventTriggers';
import { TaskStatus, ExecutionStatus } from '../../domain/shared/types';
import { DONE_CLASS, isDoneLane } from '../../domain/shared/doneClass';

/**
 * Lane keys whose work is JUDGING work someone else already did.
 *
 * The distinction matters for exactly one rule, and it is a safety rule: on a review
 * lane the ticket's OWNER must never be used as the auto-run fallback agent. The
 * fallback exists to answer "I assigned Ada to this ticket, why isn't she working
 * it" — correct on a producing lane, and a self-review on this one. Since `in_review`
 * became auto-gated (0369) so an AI reviewer can actually be dispatched, without this
 * rule that same change would have had the author's own agent re-run on its own
 * output and call it reviewed.
 *
 * Exported as a lane CLASS (not a hardcoded status compare) so the review semantics
 * live in one place alongside {@link DONE_CLASS}.
 */
export const REVIEW_CLASS = new Set<string>([TaskStatus.IN_REVIEW]);

/** True when the lane's work is a judgement on someone else's output. */
export function isReviewLane(status: string | null | undefined): boolean {
  return !!status && REVIEW_CLASS.has(status);
}

export type LaneInfo = { position: number; isTerminal: boolean };
export type OrdinalMap = Record<string, LaneInfo>;

function ordinalsCacheKey(projectId: number): string {
  return `swimlane-ordinals:project:${projectId}`;
}

/** Per-project lane-key → {position, isTerminal} map, cached (board layout is
 *  slow-changing). Empty object when the project has no board yet (free-form
 *  status with no swimlane → direction undeterminable, recorded as null).
 *
 *  Exported because "where is this ticket in its board's sequence" is the same
 *  question the ticket-context read asks (lane N of M ⇒ %-complete); sharing the
 *  loader keeps both answers on one cached board layout instead of two. */
export async function loadLaneOrdinals(env: Env, db: Db, projectId: number): Promise<OrdinalMap> {
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

const isDoneClass = (status: string, ordinals: OrdinalMap): boolean => isDoneLane(status, ordinals);

/**
 * WHO moved a ticket, in the polymorphic (kind, ref) vocabulary the activity log
 * already uses. At most one field is meaningful; all three absent ⇒ automation with no
 * identity to name (a cron sweep, a webhook), which is the only honest 'system'.
 */
export interface TransitionActorInput {
  /** The authenticated user who moved it (a human keeping the board honest). */
  actorUserId?: string | null;
  /** The cloud agent (`ide_agents.id` / published agent ref) whose run moved it. */
  actorAgentRef?: string | null;
  /** The on-prem agent host (`agent_hosts.id`) whose run moved it. */
  actorAgentHostId?: number | string | null;
}

/** `task_status_transitions.actor_kind`. Matches {@link ActorType} minus 'hire', which
 *  the human branch covers — a lane move records the mover, not their contract. */
export type TransitionActorKind = 'human' | 'cloud_agent' | 'host_agent' | 'system';

export interface TransitionActor {
  actorKind: TransitionActorKind;
  /** `users.id` / `ide_agents.id` / `agent_hosts.id` — a BARE ref, resolvable by
   *  `resolveActorByRef`. Null only for identity-less automation. */
  actorRef: string | null;
}

/** `actor_ref` is varchar(64); a longer ref would abort the insert and lose the row. */
const ACTOR_REF_MAX = 64;

/**
 * Classify a lane move's actor. PURE.
 *
 * Two things make this more than a ternary, and both were live misattributions:
 *
 *  1. An agent's move used to be indistinguishable from a cron's — everything that was
 *     not a logged-in person collapsed to `('system', null)`, so per-agent throughput
 *     could not be read off the transition log at all and the digest had to infer agent
 *     contribution from runs and ticket ownership instead.
 *  2. A MACHINE token's subject is not a user id. An on-prem agent host authenticates as
 *     `agentHost:5`, so passing `c.get('userId')` straight through stamped its hops
 *     `('human', 'agentHost:5')` — worse than anonymous, because it invented a person and
 *     inflated the human half of every autonomy ratio. That sub is decoded back into the
 *     host identity it was carrying rather than being discarded.
 *
 * Precedence is human → cloud agent → host agent: when a person's PATCH is what drove an
 * agent-owned ticket, the person moved it.
 */
export function resolveTransitionActor(input: TransitionActorInput): TransitionActor {
  const ref = (v: string | number) => String(v).trim().slice(0, ACTOR_REF_MAX) || null;

  const rawUser = input.actorUserId?.trim();
  if (rawUser) {
    const machine = parseMachineSubject(rawUser);
    if (!machine) return { actorKind: 'human', actorRef: ref(rawUser) };
    // A machine sub that names a specific host IS an identity; `agentHost:mcp` and
    // embed sessions name none, so they fall through to the explicit fields below.
    if (machine.agentHostId != null) {
      return { actorKind: 'host_agent', actorRef: ref(machine.agentHostId) };
    }
  }

  const agentRef = input.actorAgentRef?.trim();
  if (agentRef) return { actorKind: 'cloud_agent', actorRef: ref(agentRef) };

  const hostId = input.actorAgentHostId;
  if (hostId != null && String(hostId).trim() !== '') {
    return { actorKind: 'host_agent', actorRef: ref(hostId) };
  }

  return { actorKind: 'system', actorRef: null };
}

export interface RecordTransitionInput extends TransitionActorInput {
  tenantId: number;
  projectId: number;
  taskId: number;
  fromStatus: string | null;
  toStatus: string;
}

/**
 * Record one lane move and fold it into the task's lifecycle counters. Pure
 * best-effort: callers run it in waitUntil so a metrics failure never blocks the
 * PATCH. A no-op when status didn't actually change.
 */
export async function recordStatusTransition(env: Env, db: Db, input: RecordTransitionInput): Promise<void> {
  const { tenantId, projectId, taskId, fromStatus, toStatus } = input;
  if (fromStatus === toStatus) return;

  const ordinals = await loadLaneOrdinals(env, db, projectId);
  const fromPos = fromStatus != null ? ordinals[fromStatus]?.position : undefined;
  const toPos = ordinals[toStatus]?.position;
  const isBackward = fromPos != null && toPos != null ? toPos < fromPos : null;

  const wasDone = fromStatus != null && isDoneClass(fromStatus, ordinals);
  const nowDone = isDoneClass(toStatus, ordinals);

  const actor = resolveTransitionActor(input);

  await db.insert(taskStatusTransitions).values({
    tenantId,
    projectId,
    taskId,
    fromStatus,
    toStatus,
    actorKind: actor.actorKind,
    actorRef: actor.actorRef,
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

  await db.update(tasks).set(patch).where(scopedToTenant(tasks, tenantId, eq(tasks.id, taskId), eq(tasks.projectId, projectId)));

  // Invalidate the workforce scorecard / DORA caches for this tenant.
  await bumpWorkforceMetricsVersion(env, tenantId).catch((error) => {
    reportCaughtError(error, { source: "application/task/taskLifecycle.ts", operation: "recordStatusTransition" });
  });

  // A status transition (a manual PATCH, an agent advance, OR a PR-merge completion via
  // completeTaskOnMerge) can flip a remediation ticket's badge — so drop the diagnostics
  // project-score + tenant-rollup caches that carry it, instead of letting the badge lag
  // the transition by the read-through TTL. Over-invalidation is cheap (300s recompute).
  await Promise.all([
    invalidateCached(env, projectScoreCacheKey(tenantId, projectId)).catch((error) => {
      reportCaughtError(error, { source: "application/task/taskLifecycle.ts", operation: "recordStatusTransition" });
    }),
    invalidateCached(env, tenantRollupCacheKey(tenantId)).catch((error) => {
      reportCaughtError(error, { source: "application/task/taskLifecycle.ts", operation: "recordStatusTransition" });
    }),
  ]);

  // Board-event workflow triggers: a lane move IS the "task moved" event, and the
  // first arrival in a done-class lane is additionally "task completed". Fired from
  // HERE rather than the PATCH route because every completion path funnels through
  // this function — board drag, agent advance, the AI Manager sweep, and the
  // PR-merge webhook — so "task moved → run a workflow" cannot be true on one path
  // and false on another. Best-effort: fireEventTriggers never throws, and the
  // cached listener gate means a tenant with no such workflow pays no query.
  await fireEventTriggers(db, {
    tenantId, env, eventType: 'board-event',
    payload: { taskId, projectId, fromStatus, toStatus, completed: nowDone },
    match: { boardEvent: 'task-moved', status: toStatus },
  }).catch(() => undefined);
  if (nowDone && !wasDone) {
    await fireEventTriggers(db, {
      tenantId, env, eventType: 'board-event',
      payload: { taskId, projectId, fromStatus, toStatus },
      match: { boardEvent: 'task-completed', status: toStatus },
    }).catch(() => undefined);
  }

  // A work item FIRST reaching a released/done lane fans out `workitem.released`
  // to any segment webhook subscriptions (the Investor board / Changelog feed,
  // spec 05 §4.3). Segment-gated + best-effort: a no-op for single-mode tenants
  // (no segment) or when nothing subscribed; never blocks the metrics path.
  if (nowDone && !wasDone) {
    await releaseWorkItemWebhook(db, { tenantId, taskId }).catch((error) => {
      reportCaughtError(error, { source: "application/task/taskLifecycle.ts", operation: "recordStatusTransition" });
    });
    // FAST Validator review: the moment work is Done, kick an acceptance review (if the
    // tenant has a Validator) instead of waiting for the daily sweep. Dynamic import
    // breaks the taskLifecycle → validationDispatch → runtimeRoutes → taskLifecycle
    // cycle; best-effort (the review run is non-mutating, so no completion loop).
    await import('../validation/validationDispatch')
      .then((m) => m.triggerFastValidatorReview(env, db, { tenantId, taskId }))
      .catch((error) => {
        reportCaughtError(error, { source: "application/task/taskLifecycle.ts", operation: "recordStatusTransition" });
      });
    // App-user loop return leg (0920, R10): if this ticket was RAISED by a
    // site_records submission, tell whoever filed it that it's done. Dynamic
    // import for the same reason as the Validator call above — siteTicketBridge
    // pulls in laneEntryTrigger, which reaches runtimeRoutes. The function itself
    // never throws; this catch only covers a failed dynamic import.
    await import('../ide/siteTicketBridge')
      .then((m) => m.notifySiteRecordTicketDone(env, db, tenantId, taskId))
      .catch((error) => {
        reportCaughtError(error, { source: "application/task/taskLifecycle.ts", operation: "recordStatusTransition" });
      });
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
  input: TransitionActorInput & { tenantId: number; taskId: number },
): Promise<void> {
  const [t] = await db
    .select({ status: tasks.status, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, input.taskId))
    .limit(1);
  if (!t) return;
  const ordinals = await loadLaneOrdinals(env, db, t.projectId);
  if (isDoneClass(t.status, ordinals)) return; // already complete — nothing to do
  await db.update(tasks).set({ status: TaskStatus.DONE, updatedAt: new Date() }).where(eq(tasks.id, input.taskId));

  // WHO FINISHED IT. The caller names an actor when one is identifiable — a user id for
  // the in-product "Approve & Merge", or a designated agent manager. It frequently is
  // NOT: the AI Manager sweep merges as `manager:system` when no manager is designated
  // (the common case), and the green-CI / post-deploy webhook has no actor at all. Both
  // fell through to `resolveTransitionActor({})` = `('system', null)`, which is an
  // ANONYMOUS stamp — and an anonymous terminal hop credits nobody, so every agent on
  // the contributor table read `0 finished` beside thousands of runs, while the "finished
  // today" list still named a ticket owner. Measured on project 11 (2026-07-29): 5
  // tickets finished, 3 PRs merged, every contributor at `finished=0`.
  //
  // So when the caller has no actor, fall back to the agent that actually PRODUCED the
  // work — the most recent terminal execution on this ticket, the same source the
  // digest's `runs` column already attributes to. Deliberately not the ticket's assignee:
  // on a lifecycle-managed board that is the Coordinator, never the executor.
  //
  // Once per merge, never in a loop, and only on the path that would otherwise write an
  // anonymous row.
  const actor = await resolveCompletionActor(db, input);
  await recordStatusTransition(env, db, {
    tenantId: input.tenantId,
    projectId: t.projectId,
    taskId: input.taskId,
    fromStatus: t.status,
    toStatus: TaskStatus.DONE,
    ...actor,
  }).catch((error) => { /* metrics are best-effort; completion already persisted */
    reportCaughtError(error, { source: "application/task/taskLifecycle.ts", operation: "completeTaskOnMerge" });
  });
}

/**
 * The actor to credit for a merge-completion: the caller's, or the ticket's producer.
 * Exported for the test that pins the fallback — the anonymous stamp it replaces was
 * invisible on every surface except as a zero.
 */
export async function resolveCompletionActor(
  db: Db,
  input: TransitionActorInput & { tenantId: number; taskId: number },
): Promise<TransitionActorInput> {
  const named = { ...input };
  if (named.actorUserId || named.actorAgentRef || named.actorAgentHostId != null) {
    return {
      actorUserId: named.actorUserId ?? null,
      actorAgentRef: named.actorAgentRef ?? null,
      actorAgentHostId: named.actorAgentHostId ?? null,
    };
  }
  const [run] = await db
    .select({ cloudAgentRef: executions.cloudAgentRef, agentHostId: executions.agentHostId })
    .from(executions)
    .where(scopedToTenant(
      executions, input.tenantId,
      eq(executions.taskId, input.taskId),
      eq(executions.status, ExecutionStatus.COMPLETED),
    ))
    // The LAST agent to finish work on the ticket is the one whose output is being
    // merged. Ordered by completion, falling back to creation for a row that predates
    // the column being populated.
    .orderBy(desc(executions.completedAt), desc(executions.createdAt))
    .limit(1)
    .catch(() => []);
  return {
    actorUserId: null,
    actorAgentRef: run?.cloudAgentRef ?? null,
    actorAgentHostId: run?.agentHostId ?? null,
  };
}

/**
 * Stamp `tasks.last_worked_at = now()` — the true "work stopped" signal emitted
 * when an agent execution reaches a terminal state (completed OR failed). This is
 * the baseline for idle-after-done: the gap between the agent finishing and a
 * human dragging the ticket into a done lane. Sharper than the lane-move
 * approximation because a failed run leaves the lane unchanged.
 */
export async function stampLastWorked(env: Env, db: Db, tenantId: number, taskId: number): Promise<void> {
  await db.update(tasks).set({ lastWorkedAt: new Date() }).where(scopedToTenant(tasks, tenantId, eq(tasks.id, taskId)));
  await bumpWorkforceMetricsVersion(env, tenantId).catch((error) => {
    reportCaughtError(error, { source: "application/task/taskLifecycle.ts", operation: "stampLastWorked" });
  });
}

/** Info for {@link syncExecutionTaskLifecycle} — one execution→task status sync. */
export interface ExecutionTaskSync extends TransitionActorInput {
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
 *
 * This is where MOST agent lane moves are written, and the execution row names the
 * agent that made them (`cloud_agent_ref` / `agent_host_id`) — so the identity is
 * forwarded rather than flattened to 'system'. It is what makes per-agent throughput
 * readable straight off the transition log instead of inferred from run counts.
 */
export async function syncExecutionTaskLifecycle(env: Env, db: Db, info: ExecutionTaskSync): Promise<void> {
  if (info.fromStatus !== info.toStatus) {
    await recordStatusTransition(env, db, {
      tenantId: info.tenantId,
      projectId: info.projectId,
      taskId: info.taskId,
      fromStatus: info.fromStatus,
      toStatus: info.toStatus,
      actorAgentRef: info.actorAgentRef ?? null,
      actorAgentHostId: info.actorAgentHostId ?? null,
    });
  }
  if (info.terminal) {
    await stampLastWorked(env, db, info.tenantId, info.taskId);
  }
}
