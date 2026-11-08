/**
 * Per-tenant CONCURRENT cloud-run cap (PRD 09 D8).
 *
 * The monthly allowance (`cloudRunLedger`) bounds total volume; this bounds the burst -
 * how many billable cloud runs one tenant may have in flight at once - so a double
 * click, a script or a runaway client cannot fan out dozens of simultaneous runs.
 *
 * The limit is the plan's `maxConcurrentCloudRuns` (domain/tenant/PlanLimits). The
 * plan lookup, the superadmin-unlimited bypass and the fail-open posture are NOT
 * re-implemented: they are `enforceTenantCap`'s / `resolveTenantCapLimit`'s, the policy
 * every non-token meter shares - only the unit (a live-run count instead of a month's
 * usage) differs.
 *
 * WHAT COUNTS AS A CLOUD RUN. A live execution with `cloud_admitted_seq IS NOT NULL` - the
 * marker `dispatchAdmission.admitCloudRun` assigns (from a sequence, in the same UPDATE that
 * marks the row cloud-bound), and ONLY it does. `cloudRunLedger` meters the same thing by
 * `llm_usage_log.surface = 'cloud'`, but that row appears only on a run's FIRST MODEL TURN,
 * so a run admitted a moment ago would be invisible to the very check that must count it.
 * It is NOT `agent_host_id IS NULL` / `source`: a pinned host that is offline falls back to
 * the cloud, and that run is a cloud run. Nor is it a payload field a client could forge.
 *
 * RANK BY ADMISSION, NOT BY ID. A row is inserted seconds before it is admitted, so a lower id
 * can be admitted after a higher one; ranking by id would let it jump ahead of runs that were
 * already admitted. Runs are therefore ordered by `(cloud_admitted_seq, id)`.
 *
 * SUB-AGENT RUNS share their parent's slot: `liveExecution()` excludes rows with
 * `parent_execution_id` set, so a delegated fan-out is one run for the cap, as it is for every
 * other aggregate. Children are never passed through `admitCloudRun`.
 *
 * SUPERADMIN runs are unlimited but still occupy ranking slots (they are stamped and counted),
 * so a superadmin's burst can push an ordinary user's run of the same tenant past the cap.
 * That is accepted: the cap protects a tenant from bursts, and a superadmin-operated tenant
 * is the exception it exempts, not a tenant it should hide from the count.
 */
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db, Tx } from '../../infrastructure/database/connection';
import { executions } from '../../infrastructure/database/schema';
import { ExecutionStatus } from '../../domain/shared/types';
import { resolveConcurrentCloudRuns } from '../../domain/tenant/PlanLimits';
import { liveExecution } from '../rehearsal/executionMode';
import { enforceTenantCap, resolveTenantCapLimit, type MonthlyTenantCapResult } from '../shared/monthlyTenantCap';

/** A parked (`paused`) run waits on a human and holds no compute, so it does not count. */
const RUNNING_STATUSES = [ExecutionStatus.PENDING, ExecutionStatus.SUBMITTED, ExecutionStatus.RUNNING] as const;

/** The predicate "this execution was admitted as a cloud run". */
export function cloudBoundExecution() {
  return isNotNull(executions.cloudAdmittedSeq);
}

const liveCloudRuns = (tenantId: number) => and(
  eq(executions.tenantId, tenantId),
  inArray(executions.status, [...RUNNING_STATUSES]),
  cloudBoundExecution(),
  liveExecution(),
);

/** Live cloud runs the tenant has in flight. */
export async function countLiveCloudExecutions(db: Db, tenantId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(executions)
    .where(liveCloudRuns(tenantId));
  return row?.n ?? 0;
}

/** The ids of the tenant's live cloud runs in ADMISSION order - the order the cap ranks by. */
export async function liveCloudExecutionIds(db: Db | Tx, tenantId: number): Promise<number[]> {
  const rows = await db
    .select({ id: executions.id })
    .from(executions)
    .where(liveCloudRuns(tenantId))
    .orderBy(asc(executions.cloudAdmittedSeq), asc(executions.id));
  return rows.map((r) => r.id);
}

export type ConcurrentRunCapResult = MonthlyTenantCapResult;

/** May this tenant start ONE more cloud run right now? Fails open on any lookup error. */
export async function enforceConcurrentRunCap(
  db: Db, tenantId: number, env?: Env, opts: { actingUserId?: string | null } = {},
): Promise<ConcurrentRunCapResult> {
  return enforceTenantCap({
    db,
    tenantId,
    env,
    actingUserId: opts.actingUserId,
    resolveLimit: resolveConcurrentCloudRuns,
    sumUsage: (handle, id) => countLiveCloudExecutions(handle, id),
  });
}

/** The tenant's concurrent-run ceiling: a count, or `null` for unlimited (a superadmin
 *  included) and on any lookup error (fail open, as {@link enforceConcurrentRunCap}). */
export async function resolveConcurrentRunLimit(
  db: Db, tenantId: number, env?: Env, opts: { actingUserId?: string | null } = {},
): Promise<{ limit: number; effectivePlan: string } | null> {
  try {
    const cap = await resolveTenantCapLimit({
      db, tenantId, env, actingUserId: opts.actingUserId, resolveLimit: resolveConcurrentCloudRuns,
    });
    return cap.unlimited ? null : { limit: cap.limit, effectivePlan: String(cap.effectivePlan) };
  } catch {
    return null;
  }
}
