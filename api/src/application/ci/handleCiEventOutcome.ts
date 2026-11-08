import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * handleCiEventOutcome — the PROVIDER-INDEPENDENT half of the CI feedback loop.
 *
 * `ingestRepoCiEvent` normalizes/decides and returns an `AutoFixIntent`; every
 * provider webhook (GitHub, GitLab, Bitbucket) then has to do exactly the same
 * post-ingest work:
 *   1. dispatch the fix run for the intent,
 *   2. record the `autofix.dispatch` event the per-task loop-guard counts,
 *   3. surface the cases where a FAILURE produced no fix run (cap exhausted,
 *      auto-fix disabled, event not eligible) as an observable audit event
 *      instead of a `reason` string in a webhook response nobody reads.
 * (Merge-on-green + the `build.needs_human` exhaustion event already live inside
 * `ingestRepoCiEvent` and are provider-independent there.)
 *
 * Only the NORMALIZER is per-provider. Providers must call this — never re-implement it.
 *
 * Best-effort: never throws (a webhook must always 200 to stop provider retries).
 */
import { signalMergeQueueOnCiResult } from './ciMergeQueueSignal';
import { ingestRepoCiEvent, AUTOFIX_DEDUPED_REASON, type RepoCiEvent, type IngestResult } from './ingestRepoCiEvent';
import { recordAutofixDispatched, recordAutofixRefused, type AutofixAuditFacts } from './autofixDispatchRecord';
import type { DeferredParkRequest } from '../runtime/deferredDispatch';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { insertToolAudit } from '../audit/toolAuditWrite';
import { redactThenCap } from '../../infrastructure/security/redactSecrets';

/** Narrow port over `dispatchCloudRunForTask` so the application layer stays free of route imports. */
export type DispatchRunFn = (params: {
  taskId: number;
  tenantId: number;
  payload: string;
  submittedBy: string;
  /** One-shot dispatch: a deferred admission is parked and retried by the `deferred-dispatch` sweep. */
  parkIfDeferred?: DeferredParkRequest;
}) => Promise<{ executionId: number | null; refusal?: { reason: string; message: string }; deferred?: true }>;

export interface CiOutcomeDeps {
  db: Db;
  env: Env;
  /** Starts the auto-fix run. */
  dispatchRun: DispatchRunFn;
  /** Defers the dispatch past the webhook response (Workers `executionCtx.waitUntil`). */
  waitUntil: (p: Promise<unknown>) => void;
}

export interface CiOutcomeResult extends IngestResult {
  /** True when a fix run was queued for dispatch (the run itself completes async). */
  autoFixDispatched: boolean;
}

/** Telemetry toolName recorded when a build FAILED but no auto-fix run was dispatched. */
export const AUTOFIX_SKIPPED_EVENT = 'build.autofix_skipped';

/**
 * Ingest a normalized CI event and carry out whatever it decided.
 *
 * @param deps    db/env plus the dispatch + waitUntil ports the caller owns.
 * @param evt     provider-normalized {@link RepoCiEvent}.
 * @param source  provider slug for telemetry ('github' | 'gitlab' | 'bitbucket').
 */
export async function handleCiEventOutcome(
  deps: CiOutcomeDeps,
  evt: RepoCiEvent,
  source: string,
): Promise<CiOutcomeResult> {
  const { db, env } = deps;
  const credSecret = integrationCredentialSecret(env);

  const res = await ingestRepoCiEvent(db, env, credSecret, evt);

  // The verdict decides what `pr-merge` does with the head of the queue: arm its KV-gated tick for a
  // PR that is actually waiting, so it does not sit until the 30-minute floor. Off the response path.
  deps.waitUntil(signalMergeQueueOnCiResult(env, db, res));

  if (res.autoFix) {
    const intent = res.autoFix;
    const facts: AutofixAuditFacts = { taskId: intent.taskId, tenantId: intent.tenantId, attempt: intent.attempt, source, sha: intent.sha, statusKey: intent.statusKey ?? null };
    deps.waitUntil((async () => {
      try {
        const { executionId, refusal, deferred } = await deps.dispatchRun({
          taskId: intent.taskId, tenantId: intent.tenantId,
          payload: intent.payload, submittedBy: 'system:autofix',
          // The webhook will not fire again: park a deferred auto-fix for retry. `meta` is what the
          // sweep's `ci_autofix` handler needs to write the SAME audit rows this path writes.
          parkIfDeferred: { kind: 'ci_autofix', meta: facts },
        });
        // The audit rows are shared with the deferred-dispatch sweep (`autofixDispatchRecord`): a
        // refused auto-fix used to vanish, and a deferred one that later starts must still spend
        // the build's attempt and be de-duplicated by sha.
        if (executionId == null) await recordAutofixRefused(db, facts, { deferred: deferred === true, reason: refusal?.reason, message: refusal?.message });
        else await recordAutofixDispatched(db, facts, executionId);
      } catch (error) { /* webhook stays 200 — never let a dispatch failure retry the hook */ 
        reportCaughtError(error, { source: "application/ci/handleCiEventOutcome.ts", operation: "handleCiEventOutcome" });
      }
    })());
    return { ...res, autoFixDispatched: true };
  }

  // A red build that produced NO fix run is the case operators need to see. The
  // `reason` alone dies in a webhook response body nobody reads, so make it an
  // event on the run's Logs/Timeline. Two reasons are deliberately silent: the
  // exhaustion case already emits its own `build.needs_human`, and a de-duplicated
  // sibling status key is a build already being fixed, not a skipped one — a repo
  // with several keys would otherwise log one of these per poster per build.
  if (res.buildStatus === 'failure' && res.taskId != null && res.tenantId != null
      && res.reason && res.reason !== 'auto-fix attempts exhausted'
      && res.reason !== AUTOFIX_DEDUPED_REASON) {
    await insertToolAudit(db, {
      tenantId: res.tenantId, agentHostId: null, cloudAgentRef: null,
      executionId: res.executionId ?? null,
      sessionKey: res.executionId ? `exec:${res.executionId}` : `task:${res.taskId}`,
      toolName: AUTOFIX_SKIPPED_EVENT, category: 'ci',
      args: JSON.stringify({ source, branch: evt.branch, sha: evt.sha, eventType: evt.eventType, reason: res.reason }),
      result: redactThenCap(`build failed but no auto-fix dispatched — ${res.reason}`, 300),
      ts: new Date(),
    }).catch((error) => { /* telemetry best-effort */ 
      reportCaughtError(error, { source: "application/ci/handleCiEventOutcome.ts", operation: "handleCiEventOutcome" });
    });
  }

  return { ...res, autoFixDispatched: false };
}
