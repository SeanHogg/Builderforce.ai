/**
 * Deferred dispatch: a one-shot dispatcher's run that admission DEFERRED (a live run on the
 * ticket, the plan's concurrent cap) is parked and retried, instead of being dropped.
 *
 * Lane and role dispatches need none of this: the `auto-exec` sweep re-evaluates every
 * agent-owned ticket without a live run each tick, so a deferred ticket simply stays eligible.
 * A ONE-SHOT dispatcher - CI auto-fix, incident triage, security audit, validation review -
 * has no such sweep behind it: the event that triggered it will not fire again. It passes
 * `parkIfDeferred: { kind, meta }`, and the refusal is parked HERE as a pending row of the core
 * `deferred_dispatches` table (migration 1333), one per tenant + ticket + kind.
 *
 * The queue lives in that table and only there. The `dispatch.deferred` event written beside it
 * is a timeline note for humans: it is never read back, so redaction, retention or a missing
 * telemetry database cannot lose a parked dispatch. The retry half is `deferredDispatchSweep.ts`;
 * what each kind does once its retry starts or gives up is `deferredDispatchHandlers.ts`.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { deferredDispatches } from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { recordCloudToolEvent } from './cloudToolEvents';

/** The audit-timeline event beside a parked dispatch. Informational only: never read back. */
export const DEFERRED_DISPATCH_EVENT = 'dispatch.deferred';

/** The one-shot dispatchers a deferred run can belong to. A new kind is a handler row, not a branch. */
export const DEFERRED_DISPATCH_KINDS = ['ci_autofix', 'incident', 'security', 'validation'] as const;
export type DeferredDispatchKind = (typeof DEFERRED_DISPATCH_KINDS)[number];

export const isDeferredDispatchKind = (value: string): value is DeferredDispatchKind =>
  (DEFERRED_DISPATCH_KINDS as readonly string[]).includes(value);

/** What a dispatcher passes as `parkIfDeferred`: which kind it is, and what its after-start bookkeeping needs. */
export interface DeferredParkRequest {
  kind: DeferredDispatchKind;
  /** Plain JSON the kind's handler reads back (ids, never secrets). */
  meta?: Record<string, unknown>;
}

export interface DeferredDispatchParams extends DeferredParkRequest {
  tenantId: number;
  taskId: number;
  submittedBy: string;
  payload?: string;
  agentHostId?: number | null;
}

/**
 * Park a deferred one-shot dispatch for the `deferred-dispatch` sweep. Upserts the pending row
 * for (tenant, ticket, kind): a second deferral of the same dispatch refreshes its payload and
 * keeps the EARLIEST `created_at`, so the abandon window runs from the first deferral.
 */
export async function parkDeferredDispatch(db: Db, params: DeferredDispatchParams): Promise<void> {
  const row = {
    tenantId: params.tenantId, taskId: params.taskId, kind: params.kind,
    payload: { dispatchPayload: params.payload ?? null, meta: params.meta ?? {} },
    submittedBy: params.submittedBy,
    agentHostId: params.agentHostId != null ? String(params.agentHostId) : null,
  };
  try {
    await db.insert(deferredDispatches).values(row).onConflictDoUpdate({
      target: [deferredDispatches.tenantId, deferredDispatches.taskId, deferredDispatches.kind],
      targetWhere: sql`state = 'pending'`,
      set: { payload: row.payload, submittedBy: row.submittedBy, agentHostId: row.agentHostId, updatedAt: sql`now()` },
    });
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/deferredDispatch.ts', operation: 'parkDeferredDispatch', context: { logMessage: '[deferred-dispatch] could not park a deferred dispatch', details: { tenantId: params.tenantId, taskId: params.taskId, kind: params.kind } } });
    return;
  }
  await recordCloudToolEvent(db, {
    tenantId: params.tenantId, executionId: null, sessionKey: `task:${params.taskId}`,
    toolName: DEFERRED_DISPATCH_EVENT, category: 'planning',
    detail: { kind: params.kind, submittedBy: params.submittedBy },
    result: 'Dispatch deferred (a run is live on the ticket, or the workspace is at its concurrent cloud-run limit); it is retried automatically.',
  });
}
