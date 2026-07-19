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
import { toolAuditEvents } from '../../infrastructure/database/schema';
import { ingestRepoCiEvent, AUTOFIX_DISPATCH_EVENT, type RepoCiEvent, type IngestResult } from './ingestRepoCiEvent';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** Narrow port over `dispatchCloudRunForTask` so the application layer stays free of route imports. */
export type DispatchRunFn = (params: {
  taskId: number;
  tenantId: number;
  payload: string;
  submittedBy: string;
}) => Promise<number | null>;

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
  const credSecret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';

  const res = await ingestRepoCiEvent(db, env, credSecret, evt);

  if (res.autoFix) {
    const intent = res.autoFix;
    deps.waitUntil((async () => {
      try {
        const executionId = await deps.dispatchRun({
          taskId: intent.taskId, tenantId: intent.tenantId,
          payload: intent.payload, submittedBy: 'system:autofix',
        });
        if (executionId != null) {
          await db.insert(toolAuditEvents).values({
            tenantId: intent.tenantId, agentHostId: null, cloudAgentRef: null,
            executionId, sessionKey: `exec:${executionId}`,
            toolName: AUTOFIX_DISPATCH_EVENT, category: 'ci',
            args: JSON.stringify({ taskId: intent.taskId, attempt: intent.attempt, source }),
            result: `auto-fix run dispatched (attempt ${intent.attempt})`, ts: new Date(),
          }).catch(() => { /* telemetry best-effort */ });
        }
      } catch { /* webhook stays 200 — never let a dispatch failure retry the hook */ }
    })());
    return { ...res, autoFixDispatched: true };
  }

  // A red build that produced NO fix run is the case operators need to see. The
  // `reason` alone dies in a webhook response body nobody reads, so make it an
  // event on the run's Logs/Timeline (the exhaustion case already emits its own
  // `build.needs_human`, so don't double-report it).
  if (res.buildStatus === 'failure' && res.taskId != null && res.tenantId != null
      && res.reason && res.reason !== 'auto-fix attempts exhausted') {
    await db.insert(toolAuditEvents).values({
      tenantId: res.tenantId, agentHostId: null, cloudAgentRef: null,
      executionId: res.executionId ?? null,
      sessionKey: res.executionId ? `exec:${res.executionId}` : `task:${res.taskId}`,
      toolName: AUTOFIX_SKIPPED_EVENT, category: 'ci',
      args: JSON.stringify({ source, branch: evt.branch, sha: evt.sha, eventType: evt.eventType, reason: res.reason }),
      result: `build failed but no auto-fix dispatched — ${res.reason}`.slice(0, 300),
      ts: new Date(),
    }).catch(() => { /* telemetry best-effort */ });
  }

  return { ...res, autoFixDispatched: false };
}
