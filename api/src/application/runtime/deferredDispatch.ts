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
import { and, eq, sql } from 'drizzle-orm';
import { inTransaction, type Db, type Tx } from '../../infrastructure/database/connection';
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

/** A claim older than this is retakeable (the claiming tick died). The sweep's lease and the park's "in flight" test share it. */
export const DEFERRED_DISPATCH_LEASE_SECONDS = 5 * 60;

type DeferredPayload = { dispatchPayload: string | null; meta: Record<string, unknown> };

/** JSON with object keys sorted at every level: jsonb storage does not preserve key order, so a plain stringify is not an identity. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Record that the replaced (never-dispatched) payload was a different event than the one that replaced it. Best-effort. */
async function recordSuperseded(db: Db, kind: DeferredDispatchKind, tenantId: number, taskId: number, older: DeferredPayload, next: DeferredPayload): Promise<void> {
  try {
    // Lazy: the handlers import the dispatchers, which import admission, which imports this module.
    const handler = (await import('./deferredDispatchHandlers')).DEFERRED_DISPATCH_HANDLERS[kind];
    if (!handler.onSuperseded) return;
    const identity = (meta: Record<string, unknown>): string => handler.supersedeKey?.(meta) ?? stableStringify(meta);
    if (identity(older.meta) === identity(next.meta)) return;
    await handler.onSuperseded({ tenantId, taskId, payload: older }, db);
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/deferredDispatch.ts', operation: 'parkDeferredDispatch:superseded', context: { logMessage: '[deferred-dispatch] could not record a superseded deferral', details: { tenantId, taskId, kind } } });
  }
}

/**
 * Park a deferred one-shot dispatch for the `deferred-dispatch` sweep. Upserts the pending row
 * for (tenant, ticket, kind): a second deferral of the same dispatch refreshes its payload and
 * keeps the EARLIEST `created_at`, so the abandon window runs from the first deferral.
 *
 * SUPERSEDE POLICY: one pending row per (tenant, ticket, kind), so a newer deferral REPLACES the older one's payload
 * ("latest wins": for CI auto-fix that is the newest build's facts, the only one worth fixing). The older event is never
 * silently lost: when the replaced payload is a DIFFERENT event, the kind's `onSuperseded` hook records it (CI auto-fix
 * writes its refused row with reason `superseded`, so the per-build audit shows the older build was deliberately not
 * retried). What "the same event" means is the handler's `supersedeKey` (CI auto-fix: the build's sha); without one the
 * metas are compared by a key-sorted stringify (jsonb does not keep key order).
 *
 * The read of the old row (`FOR UPDATE`) and the upsert are ONE transaction, so two concurrent parks cannot both see the
 * same old row. The upsert clears `claimed_at`: a sweep that is dispatching the old payload RIGHT NOW is fenced out
 * (its settle/reschedule matches nothing), and the new payload stays pending and due. A row that was claimed was being
 * dispatched, not superseded, so no hook runs for it. The hook runs only AFTER the upsert succeeded.
 */
export async function parkDeferredDispatch(db: Db, params: DeferredDispatchParams): Promise<void> {
  const row = {
    tenantId: params.tenantId, taskId: params.taskId, kind: params.kind,
    // Normalised to what jsonb will hold (undefined keys dropped, Dates as ISO strings), so it compares equal to a stored meta.
    payload: { dispatchPayload: params.payload ?? null, meta: JSON.parse(JSON.stringify(params.meta ?? {})) as Record<string, unknown> },
    submittedBy: params.submittedBy,
    agentHostId: params.agentHostId != null ? String(params.agentHostId) : null,
  };
  const upsert = async (q: Db | Tx, lock: boolean): Promise<{ payload: DeferredPayload; claimed: boolean } | null> => {
    // `FOR UPDATE` cannot lock a row that does not exist yet, so two FIRST parks of one (tenant, ticket, kind) would both
    // see "no older row": serialise them on an advisory lock (transaction-scoped; the key is a bound parameter).
    if (lock) await q.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`deferred-dispatch:${row.tenantId}:${row.taskId}:${row.kind}`}))`);
    const [older] = await q.select({ payload: deferredDispatches.payload, claimedAt: deferredDispatches.claimedAt }).from(deferredDispatches)
      .where(and(
        eq(deferredDispatches.tenantId, row.tenantId), eq(deferredDispatches.taskId, row.taskId),
        eq(deferredDispatches.kind, row.kind), eq(deferredDispatches.state, 'pending'),
      )).for('update').limit(1);
    await q.insert(deferredDispatches).values(row).onConflictDoUpdate({
      target: [deferredDispatches.tenantId, deferredDispatches.taskId, deferredDispatches.kind],
      targetWhere: sql`state = 'pending'`,
      set: { payload: row.payload, submittedBy: row.submittedBy, agentHostId: row.agentHostId, claimedAt: null, updatedAt: sql`now()` },
    });
    // A claim older than the lease is a dead tick's, not a dispatch in flight: it counts as unclaimed.
    const inFlight = older?.claimedAt != null && Date.now() - new Date(older.claimedAt).getTime() <= DEFERRED_DISPATCH_LEASE_SECONDS * 1000;
    return older ? { payload: older.payload, claimed: inFlight } : null;
  };
  let older: { payload: DeferredPayload; claimed: boolean } | null;
  try {
    older = await inTransaction(db, (tx) => upsert(tx, true)).catch((error: unknown) => {
      // No transaction available (a pool that will not open): the same statements without the locks, reported like the
      // admission module's unlocked fallback.
      reportCaughtError(error, { source: 'application/runtime/deferredDispatch.ts', operation: 'parkDeferredDispatch:lock', level: 'warning', context: { logMessage: '[deferred-dispatch] could not park inside a transaction; parking without the lock', details: { tenantId: params.tenantId, taskId: params.taskId, kind: params.kind } } });
      return upsert(db, false);
    });
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/deferredDispatch.ts', operation: 'parkDeferredDispatch', context: { logMessage: '[deferred-dispatch] could not park a deferred dispatch', details: { tenantId: params.tenantId, taskId: params.taskId, kind: params.kind } } });
    return;
  }
  if (older && !older.claimed) await recordSuperseded(db, params.kind, row.tenantId, row.taskId, older.payload, row.payload);
  await recordCloudToolEvent(db, {
    tenantId: params.tenantId, executionId: null, sessionKey: `task:${params.taskId}`,
    toolName: DEFERRED_DISPATCH_EVENT, category: 'planning',
    detail: { kind: params.kind, submittedBy: params.submittedBy },
    result: 'Dispatch deferred (a run is live on the ticket, or the workspace is at its concurrent cloud-run limit); it is retried automatically.',
  });
}
