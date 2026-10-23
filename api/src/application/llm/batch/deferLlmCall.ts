/**
 * `priority: 'deferred'` — THE entry point a caller nobody waits on uses instead of the
 * gateway (PRD D6).
 *
 * Returns `{ deferred: true }` when the request is durably queued: the caller returns
 * WITHOUT the answer, and the handler its `kind` names does the caller's write when the
 * provider batch settles (`batchCallbackRegistry.ts`). Returns `{ deferred: false,
 * reason }` when it is not — the lever is off for the tenant, no batch provider or
 * credential fits (`batchTarget.ts`), or the enqueue failed — and the caller runs its
 * synchronous path exactly as before. Never throws: a queue problem degrades to the
 * synchronous call, logged with its reason.
 */
import { isCostLeverOn } from '@builderforce/cost-levers';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { drizzleBatchJobStore, type BatchJobStore } from './batchJobStore';
import { BATCH_USE_CASES, resolveBatchTarget } from './batchTarget';
import type { BatchCallbackKind, DeferredLlmRequest } from './batchTypes';
import { markBatchWork } from './batchWorkMarker';

export interface DeferLlmCallInput {
  tenantId: number;
  kind: BatchCallbackKind;
  request: DeferredLlmRequest;
  /** What the handler needs to do the caller's write — never a secret. Cleared, with the
   *  request, when the job settles. */
  payload: Record<string, unknown>;
  projectId?: number | null;
  taskId?: number | null;
  /** A strict-pinned model (the teacher): batch only on its provider, or not at all. */
  pinnedModel?: string | null;
}

export type DeferOutcome = { deferred: true; jobId: number } | { deferred: false; reason: string };

export async function deferLlmCall(
  env: Env,
  db: Db,
  input: DeferLlmCallInput,
  store: BatchJobStore = drizzleBatchJobStore(db),
): Promise<DeferOutcome> {
  if (!isCostLeverOn(env, 'd6_batch_api', input.tenantId)) return { deferred: false, reason: 'lever_off' };
  try {
    const target = await resolveBatchTarget(env, input.tenantId, input.kind, input.pinnedModel);
    if (!target.ok) {
      console.info(`[llm-batch] ${input.kind} tenant=${input.tenantId} stays synchronous: ${target.reason}`);
      return { deferred: false, reason: target.reason };
    }
    const jobId = await store.insert({
      tenantId: input.tenantId,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      useCase: BATCH_USE_CASES[input.kind].useCase,
      callbackKind: input.kind,
      callbackPayload: input.payload,
      request: input.request,
      ...target.target,
    });
    await markBatchWork(env);
    return { deferred: true, jobId };
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/llm/batch/deferLlmCall.ts',
      operation: 'deferLlmCall',
      level: 'warning',
      context: { tenantId: input.tenantId, kind: input.kind, logMessage: '[llm-batch] enqueue failed; running synchronously' },
    });
    return { deferred: false, reason: 'enqueue_failed' };
  }
}
