/**
 * Fast-path admission for a HUMAN-initiated run (`POST /executions`, `POST /tasks/submit`).
 *
 * This is the PRE-ROW check: it refuses before an execution row exists, so the common
 * double-click costs nothing. It is NOT the authority. The authority is the choke point
 * (`dispatchAdmission.admitCloudRun`, in `startDispatchedExecution`'s not-delivered
 * branch), which decides "cloud-bound" from the routing outcome and ranks the inserted
 * row against its peers, so a race or a pinned host that falls back to the cloud is
 * still gated. Here `cloudBound` only decides whether the optimistic cap look is worth a
 * query.
 *
 *   1. In-flight dedupe (PRD 09 D6) - 409 naming the live execution.
 *   2. Concurrent-run cap (D8) - 429 with the cap and the current count.
 *   3. Pre-dispatch budget estimate (B3) - 429 when the allowance left is below what a
 *      run needs.
 *
 * A caller that sent an `Idempotency-Key` is answered by the replay middleware BEFORE
 * reaching here.
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { CONCURRENT_RUN_RETRY_AFTER_SECONDS, preAdmitRun, type AdmissionRefusal } from './dispatchAdmission';
import { checkRunBudgetViable } from './runBudgetEstimate';

export interface DispatchRefusal {
  status: 409 | 429;
  body: Record<string, unknown>;
  /** Seconds for a `Retry-After` header on a cap refusal. */
  retryAfterSeconds?: number;
}

export interface HumanDispatchRequest {
  tenantId: number;
  taskId: number;
  userId: string;
  /** False for a run that executes on the user's own machine (pinned host / editor): the
   *  optimistic cap look and the cloud budget floor are skipped; the choke point still
   *  gates it if it falls back to the cloud. */
  cloudBound: boolean;
}

/** The HTTP shape of a typed admission refusal - the ONE mapping (409 live run, 429 cap). */
export function admissionRefusalResponse(refusal: AdmissionRefusal, retryAfterSeconds: number): DispatchRefusal {
  if (refusal.code === 'execution_already_live') {
    return {
      status: 409,
      body: { error: refusal.message, code: refusal.code, executionId: refusal.executionId, taskId: refusal.taskId },
    };
  }
  return {
    status: 429,
    retryAfterSeconds,
    body: {
      error: refusal.message,
      code: refusal.code,
      limit: refusal.limit,
      current: refusal.current,
      effectivePlan: refusal.effectivePlan,
      retryAfterSeconds,
    },
  };
}

export async function admitHumanDispatch(env: Env, db: Db, req: HumanDispatchRequest): Promise<DispatchRefusal | null> {
  const refusal = await preAdmitRun(env, db, {
    tenantId: req.tenantId,
    taskId: req.taskId,
    actingUserId: req.userId,
    checkCap: req.cloudBound,
  });
  if (refusal) return admissionRefusalResponse(refusal, CONCURRENT_RUN_RETRY_AFTER_SECONDS);

  if (!req.cloudBound) return null;

  const budget = await checkRunBudgetViable(db, req.tenantId, { actingUserId: req.userId }, env);
  if (budget) return { status: 429, body: { ...budget } };

  return null;
}
