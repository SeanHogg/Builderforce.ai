/**
 * Validator dispatch — kicks off the Validator agent to review "Done" work items
 * against the codebase, and the recurring sweep that re-reviews them so each item
 * accrues MULTIPLE review passes over time (the "reviewed multiple times" behaviour).
 *
 * The Validator is a normal, assignable cloud agent (seeded + published to the
 * marketplace, migration 0271) whose persona/skills make it perform an acceptance
 * review and report via the `reviews.record` MCP tool (→ ValidationService: review
 * ledger + GAP tasks). Auto-review therefore activates per-tenant the moment a tenant
 * has a Validator agent — no separate feature flag, no dead seam: no Validator ⇒ the
 * sweep is a no-op for that tenant; Validator present ⇒ its Done items get reviewed.
 *
 * Dispatch reuses the ONE canonical cloud-run path (dispatchCloudRunForTask), pinning
 * the Validator ref in the payload — the same contract the board lane-auto-run uses.
 */
import { and, eq, isNull, lt, or, sql, ne, inArray } from 'drizzle-orm';
import { tasks, projects, ideAgents, executions } from '../../infrastructure/database/schema';
import { dispatchCloudRunForTask } from '../../presentation/routes/runtimeRoutes';
import { buildRuntimeService } from '../../buildRuntimeService';
import { buildDatabase } from '../../infrastructure/database/connection';
import { TaskStatus, TaskType } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { VALIDATOR_REVIEW_LANE_KEY } from './validatorReviewMarker';

/** Re-review a Done item at most this often — one fresh pass per interval. */
const REVIEW_INTERVAL_MS = 20 * 60 * 60 * 1000; // ~daily, with slack for the cron tick
/** Cap Done items reviewed per tenant per sweep so a big backlog can't fan out unbounded. */
const MAX_REVIEWS_PER_TENANT = 15;
/** A distinct lane key so the run isn't confused with (or suppressed by) board lane-auto-run.
 *  Shared with the runtime, which treats a run stamped with it as non-mutating. */
const REVIEW_LANE_KEY = VALIDATOR_REVIEW_LANE_KEY;

/**
 * The tenant's Validator agent id, or null when the tenant has none. A Validator is
 * an active ide_agents row marked `builtin_kind='validator'` (migration 0289) —
 * a stable marker independent of the display name, so a team can rename the agent
 * (e.g. to "Alice") without breaking auto-review. Cheap indexed lookup.
 */
export async function findTenantValidatorRef(db: Db, tenantId: number): Promise<string | null> {
  const [row] = await db
    .select({ id: ideAgents.id })
    .from(ideAgents)
    .where(and(
      eq(ideAgents.tenantId, tenantId),
      eq(ideAgents.status, 'active'),
      eq(ideAgents.builtinKind, 'validator'),
    ))
    .limit(1);
  return row?.id ?? null;
}

/** True when the task already has a live (pending/running) execution — don't double-dispatch. */
async function hasLiveRun(db: Db, taskId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: executions.id })
    .from(executions)
    .where(and(eq(executions.taskId, taskId), inArray(executions.status, ['pending', 'running'])))
    .limit(1);
  return !!row;
}

/**
 * Dispatch ONE Validator review of a Done task. Best-effort; returns the execution id
 * or null (no Validator, task not found/owned, a live run already exists, or dispatch
 * failed). Reused by the sweep and by any explicit "review now" caller.
 */
export async function dispatchValidatorReview(
  env: Env,
  db: Db,
  params: { tenantId: number; taskId: number; validatorRef?: string | null; submittedBy?: string },
): Promise<number | null> {
  const validatorRef = params.validatorRef ?? (await findTenantValidatorRef(db, params.tenantId));
  if (!validatorRef) return null;
  if (await hasLiveRun(db, params.taskId)) return null;

  const runtimeService = buildRuntimeService(env, db);
  const payload = JSON.stringify({ cloudAgentRef: validatorRef, laneKey: REVIEW_LANE_KEY, validatorReview: true });
  const deferred: Promise<unknown>[] = [];
  try {
    const execId = await dispatchCloudRunForTask(env, db, runtimeService, (p) => { deferred.push(Promise.resolve(p)); }, {
      taskId: params.taskId,
      tenantId: params.tenantId,
      payload,
      submittedBy: params.submittedBy ?? `validator:${validatorRef}`,
    });
    await Promise.allSettled(deferred);
    return execId;
  } catch {
    return null; // best-effort — a dispatch failure must not break the sweep/caller
  }
}

/**
 * FAST on-Done trigger: the instant a ticket first enters a done-class lane, kick a
 * Validator review so acceptance feedback lands in minutes, not on the next daily
 * sweep. Safe against the completion loop because a Validator review run is stamped
 * non-mutating ({@link VALIDATOR_REVIEW_LANE_KEY}) — it records a verdict without
 * moving the ticket, so it can never re-enter Done and re-trigger itself. Best-effort:
 * skips GAP tickets (review OUTPUT, not input), a tenant with no Validator, and a
 * ticket with a live run; never throws. Returns the review execution id, or null.
 */
export async function triggerFastValidatorReview(
  env: Env,
  db: Db,
  params: { tenantId: number; taskId: number },
): Promise<number | null> {
  const validatorRef = await findTenantValidatorRef(db, params.tenantId);
  if (!validatorRef) return null;
  const [t] = await db
    .select({ taskType: tasks.taskType, archived: tasks.archived })
    .from(tasks)
    .where(eq(tasks.id, params.taskId))
    .limit(1);
  if (!t || t.archived || t.taskType === TaskType.GAP) return null;
  return dispatchValidatorReview(env, db, { tenantId: params.tenantId, taskId: params.taskId, validatorRef, submittedBy: `validator:on-done` });
}

export interface ValidatorSweepResult {
  tenantsWithValidator: number;
  dispatched: number;
}

/**
 * Daily sweep: for every tenant that has a Validator agent, dispatch a review for its
 * Done items that have never been reviewed or whose last review is older than the
 * interval — so Done work is validated once and then re-validated on a cadence,
 * accumulating multiple passes. GAP tasks themselves are excluded (they are the
 * output of review, not its input). Bounded per tenant.
 */
export async function runValidatorReviewSweep(env: Env): Promise<ValidatorSweepResult> {
  const db = buildDatabase(env);
  const out: ValidatorSweepResult = { tenantsWithValidator: 0, dispatched: 0 };

  // Tenants that own a Validator agent (the natural opt-in).
  const validators = await db
    .select({ tenantId: ideAgents.tenantId, id: ideAgents.id })
    .from(ideAgents)
    .where(and(
      eq(ideAgents.status, 'active'),
      eq(ideAgents.builtinKind, 'validator'),
    ));
  const refByTenant = new Map<number, string>();
  for (const v of validators) if (!refByTenant.has(v.tenantId)) refByTenant.set(v.tenantId, v.id);
  out.tenantsWithValidator = refByTenant.size;
  if (refByTenant.size === 0) return out;

  const cutoff = new Date(Date.now() - REVIEW_INTERVAL_MS);

  for (const [tenantId, validatorRef] of refByTenant) {
    // Done items in this tenant due for (re)review, oldest-reviewed first.
    const due = await db
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(
        eq(projects.tenantId, tenantId),
        eq(tasks.status, TaskStatus.DONE),
        ne(tasks.taskType, TaskType.GAP),
        eq(tasks.archived, false),
        or(isNull(tasks.lastReviewedAt), lt(tasks.lastReviewedAt, cutoff)),
      ))
      .orderBy(sql`${tasks.lastReviewedAt} ASC NULLS FIRST`)
      .limit(MAX_REVIEWS_PER_TENANT);

    for (const t of due) {
      const execId = await dispatchValidatorReview(env, db, { tenantId, taskId: t.id, validatorRef });
      if (execId != null) out.dispatched += 1;
    }
  }
  return out;
}
