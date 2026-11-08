/**
 * Admission for a run that is about to become a CLOUD run: no duplicate live run per
 * ticket (PRD 09 D6) and a concurrent cloud-run cap per plan (D8).
 *
 * ONE module, called from the places where a run actually becomes a cloud run:
 *   - the pre-row twins (`dispatchCloudRunForTask`, `startFollowUpRun`, the submit
 *     routes) call {@link preAdmitRun} - a cheap check that refuses BEFORE a row exists;
 *   - the choke point (`startDispatchedExecution`) and the paused-run resume call
 *     {@link admitCloudRun} AFTER the row exists.
 *
 * "Cloud-bound" is decided from the ROUTING OUTCOME, never from a header, a body field or a
 * client surface: a run with no usable host is admitted up front, and a pinned host that is
 * offline or rejects the run falls back to the cloud and is admitted then. A run that IS
 * delivered to a host holds no cloud compute, so only the per-task dedupe applies to it.
 *
 * WHY TWO STEPS. A read-then-insert check is not race-safe: N parallel submits all read
 * "under the cap", all insert, all start. {@link admitAfterInsert} therefore re-reads AFTER
 * this run is stamped and ranks it. The stamp is `cloud_admitted_seq`, taken from a sequence
 * in the same UPDATE that marks the row cloud-bound, so the rank is ADMISSION order: a row
 * inserted early but admitted late queues behind runs already admitted (ranking by id would
 * let it jump them, because insert and admission are seconds apart). The earliest admitted
 * runs win, so exactly `limit` start. The pre-check stays for the fast path's fast refusal.
 *
 * SUB-AGENT children share their parent's slot and are never passed through here (see
 * `concurrentRunCap`). Everything FAILS OPEN on a lookup error: admission bounds a burst, it
 * is not a second point of failure for the run it guards.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { executions } from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { liveExecution } from '../rehearsal/executionMode';
import { AUTO_RUN_REASON_TEXT } from '../swimlane/evaluateAutoRun';
import { recordCloudToolEvent } from './cloudToolEvents';
import { enforceConcurrentRunCap, liveCloudExecutionIds, resolveConcurrentRunLimit } from './concurrentRunCap';
import { parkDeferredDispatch, type DeferredDispatchParams } from './deferredDispatch';
import { notifyExecutionSubscribers } from './executionEvents';
import { findLiveExecution, LIVE_EXECUTION_STATUSES } from './liveExecutionStatus';
import { recordAutoRunSkip } from './autoRunSkipLedger';
import type { RuntimeService } from './RuntimeService';

export type AdmissionRefusal =
  | { code: 'execution_already_live'; taskId: number; executionId: number; status: string; message: string }
  | { code: 'concurrent_run_limit'; limit: number; current: number; effectivePlan: string; message: string };

/** Dispatch refusal reasons that are admission (clear when a run finishes), not governance or billing. */
export const ADMISSION_REFUSALS: ReadonlySet<string> = new Set(['already_running', 'concurrent_run_limit']);

/** Seconds a refused caller should wait before retrying a cap refusal. */
export const CONCURRENT_RUN_RETRY_AFTER_SECONDS = 30;

const dedupeRefusal = (taskId: number, live: { id: number; status: string }): AdmissionRefusal => ({
  code: 'execution_already_live',
  taskId,
  executionId: live.id,
  status: live.status,
  message: `This task already has a live run (execution ${live.id}, ${live.status}). Wait for it to finish or cancel it first.`,
});

const capRefusal = (limit: number, current: number, effectivePlan: string): AdmissionRefusal => ({
  code: 'concurrent_run_limit',
  limit,
  current,
  effectivePlan,
  message: `This workspace already has ${current} of ${limit} cloud runs in flight, the most its ${effectivePlan} plan allows at once. Wait for a run to finish or cancel one.`,
});

/** The live runs of one ticket, oldest first. */
async function liveRunsForTask(
  db: Db, tenantId: number, taskId: number,
): Promise<Array<{ id: number; status: string }>> {
  return db
    .select({ id: executions.id, status: executions.status })
    .from(executions)
    .where(and(
      eq(executions.tenantId, tenantId),
      eq(executions.taskId, taskId),
      inArray(executions.status, [...LIVE_EXECUTION_STATUSES]),
      liveExecution(),
    ))
    .orderBy(asc(executions.id));
}

/** The ticket's live run (the newest, matching the autonomy evaluator's `already_running`), or null. */
export async function findLiveExecutionForTask(
  db: Db, tenantId: number, taskId: number,
): Promise<{ id: number; status: string } | null> {
  const rows = await liveRunsForTask(db, tenantId, taskId);
  return findLiveExecution([...rows].reverse());
}

export interface PreAdmitArgs {
  tenantId: number;
  taskId: number;
  actingUserId?: string | null;
  /** Also hold the run to the concurrent cap. False when the caller cannot yet know the
   *  run is cloud-bound (an optimistic skip only: {@link admitCloudRun} is authoritative). */
  checkCap: boolean;
}

/** The cheap pre-row check. Null = proceed. */
export async function preAdmitRun(env: Env, db: Db, args: PreAdmitArgs): Promise<AdmissionRefusal | null> {
  try {
    const live = await findLiveExecutionForTask(db, args.tenantId, args.taskId);
    if (live) return dedupeRefusal(args.taskId, live);
    if (!args.checkCap) return null;
    const cap = await enforceConcurrentRunCap(db, args.tenantId, env, { actingUserId: args.actingUserId });
    if (!cap.allowed) return capRefusal(cap.limit, cap.used, String(cap.effectivePlan));
    return null;
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/dispatchAdmission.ts', operation: 'preAdmitRun' });
    return null;
  }
}

export interface AdmitAfterInsertArgs {
  tenantId: number;
  taskId: number;
  executionId: number;
  /** The tenant's concurrent cap; `null` = unlimited (a superadmin skips the cap rank, never the dedupe). */
  limit: number | null;
  effectivePlan?: string;
}

/**
 * The race-safe check, run AFTER this run's row exists (and, for a cloud run, is stamped).
 * Refuses when an OLDER live run exists for the same ticket (dedupe is by id: the first row
 * inserted owns the ticket), or when this run's rank in ADMISSION order among the tenant's
 * live cloud runs is past the cap. Null = this run may start.
 */
export async function admitAfterInsert(db: Db, args: AdmitAfterInsertArgs): Promise<AdmissionRefusal | null> {
  try {
    const taskRuns = await liveRunsForTask(db, args.tenantId, args.taskId);
    const older = taskRuns.find((r) => r.id < args.executionId);
    if (older) return dedupeRefusal(args.taskId, older);

    if (args.limit === null) return null;
    const ids = await liveCloudExecutionIds(db, args.tenantId);
    const rank = ids.indexOf(args.executionId);
    if (rank >= args.limit) {
      return capRefusal(args.limit, Math.min(ids.length - 1, args.limit), args.effectivePlan ?? 'current');
    }
    return null;
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/dispatchAdmission.ts', operation: 'admitAfterInsert' });
    return null;
  }
}

export interface AdmitCloudRunArgs {
  tenantId: number;
  taskId: number;
  executionId: number;
  cloudAgentRef?: string;
  actingUserId?: string | null;
  /** False for a run delivered to a host: it holds no cloud compute, so it is not stamped or
   *  counted, and only the per-task dedupe applies. */
  cloudBound: boolean;
}

/**
 * THE post-insert admission. For a cloud run it stamps `cloud_admitted_seq` (so the run
 * counts itself and is visible to its peers) in ONE UPDATE, then runs {@link admitAfterInsert}.
 * A refused run is settled (CANCELLED by `system:admission`, so the auto-run circuit breaker
 * never counts it), its typed reason is written to the run's timeline, subscribers are told,
 * and the settled execution is returned carrying the refusal ({@link admissionRefusalOf}).
 * Null = the run may start.
 */
export async function admitCloudRun(
  env: Env, db: Db, runtimeService: RuntimeService, args: AdmitCloudRunArgs,
): Promise<unknown | null> {
  let refusal: AdmissionRefusal | null;
  try {
    if (args.cloudBound) {
      await db.update(executions)
        .set({ cloudAdmittedSeq: sql<number>`nextval('executions_cloud_admitted_seq')` })
        .where(eq(executions.id, args.executionId));
    }
    const cap = args.cloudBound
      ? await resolveConcurrentRunLimit(db, args.tenantId, env, { actingUserId: args.actingUserId })
      : null;
    refusal = await admitAfterInsert(db, {
      tenantId: args.tenantId,
      taskId: args.taskId,
      executionId: args.executionId,
      limit: cap?.limit ?? null,
      effectivePlan: cap?.effectivePlan,
    });
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/dispatchAdmission.ts', operation: 'admitCloudRun' });
    return null;
  }
  if (!refusal) return null;

  await settleRefusedRun(db, runtimeService, args.executionId);
  await recordCloudToolEvent(db, {
    tenantId: args.tenantId, cloudAgentRef: args.cloudAgentRef, executionId: args.executionId,
    toolName: 'runtime.route', category: 'planning',
    detail: { reason: refusal.code, taskId: args.taskId },
    result: refusal.message,
  }).catch((error) => reportCaughtError(error, { source: 'application/runtime/dispatchAdmission.ts', operation: 'admitCloudRun', context: { logMessage: '[dispatch-admission] timeline event failed', details: { executionId: args.executionId, error } } }));
  const settled = await runtimeService.getExecution(args.executionId).then((e) => e.toPlain()).catch(() => ({ id: args.executionId, status: 'cancelled' }));
  notifyExecutionSubscribers(args.executionId, {
    type: 'done', executionId: args.executionId, status: (settled as { status: never }).status,
    execution: settled as never, ts: new Date().toISOString(),
  });
  return withAdmissionRefusal(settled, refusal);
}

/**
 * Admission on RESUME of a paused run. A paused run holds no compute and is not counted, so
 * waking it is a new claim on a slot: it is held to the concurrent cap and, when admitted,
 * re-stamped so it ranks from NOW (not from its original admission). Over the cap it is
 * refused WITHOUT being cancelled - the run stays paused and resumable. Best-effort race: the
 * status flip happens in the runner's `/resume`, after this check.
 */
export async function admitResumedRun(
  env: Env, db: Db, args: { tenantId: number; executionId: number; actingUserId?: string | null },
): Promise<AdmissionRefusal | null> {
  try {
    const cap = await enforceConcurrentRunCap(db, args.tenantId, env, { actingUserId: args.actingUserId });
    if (!cap.allowed) return capRefusal(cap.limit, cap.used, String(cap.effectivePlan));
    await db.update(executions)
      .set({ cloudAdmittedSeq: sql<number>`nextval('executions_cloud_admitted_seq')` })
      .where(eq(executions.id, args.executionId));
    return null;
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/dispatchAdmission.ts', operation: 'admitResumedRun' });
    return null;
  }
}

/**
 * Cancel a refused run so it never starts and never counts. If the cancel fails twice, the
 * row must at least stop holding a slot: clear its admission stamp.
 */
async function settleRefusedRun(db: Db, runtimeService: RuntimeService, executionId: number): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await runtimeService.cancel(executionId, 'system:admission');
      return;
    } catch (error) {
      if (attempt === 1) reportCaughtError(error, { source: 'application/runtime/dispatchAdmission.ts', operation: 'settleRefusedRun', level: 'warning', context: { logMessage: '[dispatch-admission] could not cancel a refused run; releasing its slot', details: { executionId } } });
    }
  }
  await db.update(executions).set({ cloudAdmittedSeq: null }).where(eq(executions.id, executionId))
    .catch((error) => reportCaughtError(error, { source: 'application/runtime/dispatchAdmission.ts', operation: 'settleRefusedRun', context: { logMessage: '[dispatch-admission] could not release a refused run\'s slot', details: { executionId, error } } }));
}

/** The marker `startDispatchedExecution` returns its plain execution with when admission refused it. */
const REFUSAL_KEY = 'admissionRefusal';

export function withAdmissionRefusal(plain: unknown, refusal: AdmissionRefusal): unknown {
  return { ...(plain as Record<string, unknown>), [REFUSAL_KEY]: refusal };
}

/** The admission refusal on a `startDispatchedExecution` result, or null when the run started. */
export function admissionRefusalOf(result: unknown): AdmissionRefusal | null {
  if (!result || typeof result !== 'object') return null;
  const refusal = (result as Record<string, unknown>)[REFUSAL_KEY];
  return refusal && typeof refusal === 'object' ? (refusal as AdmissionRefusal) : null;
}

/** A refused dispatch, in the shape `dispatchCloudRunForTask` returns (structurally a `CloudDispatchOutcome`). */
export interface AdmissionOutcome {
  executionId: null;
  refusal: { reason: 'already_running' | 'concurrent_run_limit'; message: string };
  /** An AUTONOMOUS caller's refusal: no failed run was left for the circuit breaker, and the ticket stays eligible. */
  deferred?: true;
}

export interface AdmissionOutcomeContext {
  tenantId: number;
  taskId: number;
  cloudAgentRef: string;
  lane: string | null;
  submittedBy: string;
  force: boolean;
  /** A ONE-SHOT dispatcher (CI auto-fix, incident, security, validation) that no sweep
   *  re-evaluates: its deferred dispatch is parked and retried by the `deferred-dispatch` sweep. */
  park?: Omit<DeferredDispatchParams, 'tenantId' | 'taskId' | 'submittedBy'>;
}

/**
 * A declined admission as the dispatcher's outcome. The ticket's live run maps to the shared
 * `already_running` verdict; the cap has no triage verdict of its own (a tenant-wide, momentary
 * state, not a fact about the ticket), so it is not written to the per-ticket skip ledger. An
 * AUTONOMOUS caller (`!force`) gets `deferred`; lane and role callers are re-swept by the
 * `auto-exec` sweep, and a caller that passed `park` is retried by the `deferred-dispatch` sweep.
 */
export async function admissionOutcome(env: Env, db: Db, refusal: AdmissionRefusal, ctx: AdmissionOutcomeContext): Promise<AdmissionOutcome> {
  const deferred = !ctx.force;
  if (deferred && ctx.park) {
    await parkDeferredDispatch(db, { tenantId: ctx.tenantId, taskId: ctx.taskId, submittedBy: ctx.submittedBy, ...ctx.park });
  }
  const flag = deferred ? { deferred: true as const } : {};
  if (refusal.code === 'execution_already_live') {
    await recordAutoRunSkip(env, db, {
      tenantId: ctx.tenantId, taskId: ctx.taskId, cloudAgentRef: ctx.cloudAgentRef, lane: ctx.lane,
      reason: 'already_running',
      stateDiscriminator: refusal.executionId,
      detail: { taskId: ctx.taskId, reason: 'already_running', executionId: refusal.executionId, submittedBy: ctx.submittedBy },
      result: `Dispatch deferred: ${refusal.message}`,
    });
    return { executionId: null, refusal: { reason: 'already_running', message: `${refusal.message} ${AUTO_RUN_REASON_TEXT.already_running}` }, ...flag };
  }
  return {
    executionId: null,
    refusal: { reason: 'concurrent_run_limit', message: `${refusal.message} The ticket is retried once a run finishes.` },
    ...flag,
  };
}
