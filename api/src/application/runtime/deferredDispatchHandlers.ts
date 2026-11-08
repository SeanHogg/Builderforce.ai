/**
 * What each deferred one-shot dispatcher does once the `deferred-dispatch` sweep settles its
 * parked run. DATA, not branches: a new one-shot dispatcher is a row in
 * {@link DEFERRED_DISPATCH_HANDLERS} (and a kind in `deferredDispatch.ts`), and the sweep never
 * learns its name.
 *
 * Each hook mirrors what the dispatcher's DIRECT path does at the same moment, through the same
 * shared function, so a run that started (or gave up) late leaves exactly the bookkeeping one
 * that started (or gave up) on the spot would:
 *   - `ci_autofix`  started: the `autofix.dispatch` row the per-build dedupe and attempt budget
 *                   read; abandoned: the refused row; superseded by a newer build's deferral: a refused row
 *                   (reason `superseded`) for the replaced one.
 *   - `security`    abandoned: the audit is finished `failed` (never stuck `running`).
 *   - `incident`    abandoned: the refusal is reported, as the direct path reports it.
 *   - `validation`  the direct path does nothing on either outcome, so neither hook does.
 */
import type { Db } from '../../infrastructure/database/connection';
import { recordAutofixDispatched, recordAutofixRefused, type AutofixAuditFacts } from '../ci/autofixDispatchRecord';
import { reportIncidentTriageRefused } from '../incident/incidentDispatch';
import { failSecurityAudit } from '../security/securityDispatch';
import type { DeferredDispatchKind } from './deferredDispatch';

/** A claimed `deferred_dispatches` row, as the sweep and its handlers see it. */
export interface DeferredRow {
  id: number;
  tenantId: number;
  taskId: number;
  kind: string;
  payload: { dispatchPayload: string | null; meta: Record<string, unknown> };
  submittedBy: string | null;
  agentHostId: string | null;
  attempts: number;
  createdAt: Date;
  /** The lease this claim took: the fencing token `settle` and `reschedule` write under. */
  claimedAt: Date | null;
}

export interface DeferredDispatchOutcome {
  executionId: number | null;
  refusal?: { reason: string; message: string };
  deferred?: true;
}

/** `dispatchCloudRunForTask`, bound by the sweep to its env, db and service. */
export type RunDeferredDispatch = (params: {
  taskId: number; tenantId: number; submittedBy: string; payload?: string; agentHostId?: number | null;
}) => Promise<DeferredDispatchOutcome>;

export interface DeferredDispatchHandler {
  /** Re-dispatch the parked run. */
  dispatch(row: DeferredRow, run: RunDeferredDispatch): Promise<DeferredDispatchOutcome>;
  /** The run started: the dispatcher's own after-start bookkeeping. */
  onStarted(row: DeferredRow, executionId: number, db: Db): Promise<void>;
  /** The run will never start (refused for a reason that will not clear, or too old). */
  onAbandoned(row: DeferredRow, reason: string, db: Db): Promise<void>;
  /** A newer deferral of the same ticket + kind replaced this pending payload (latest wins); record the older event. Optional. */
  onSuperseded?(older: Pick<DeferredRow, 'tenantId' | 'taskId' | 'payload'>, db: Db): Promise<void>;
  /** The identity of the EVENT a payload's `meta` stands for (ci_autofix: the build's sha); a re-park of the same key supersedes nothing. */
  supersedeKey?(meta: Record<string, unknown>): string;
}

/** Re-dispatch through the one dispatcher with the params the dispatcher parked. */
const redispatch: DeferredDispatchHandler['dispatch'] = (row, run) => run({
  taskId: row.taskId, tenantId: row.tenantId, submittedBy: row.submittedBy ?? 'system:deferred-dispatch',
  ...(row.payload.dispatchPayload ? { payload: row.payload.dispatchPayload } : {}),
  ...(row.agentHostId != null && Number.isFinite(Number(row.agentHostId)) ? { agentHostId: Number(row.agentHostId) } : {}),
});

const nothing = async (): Promise<void> => undefined;

export const DEFERRED_DISPATCH_HANDLERS: Readonly<Record<DeferredDispatchKind, DeferredDispatchHandler>> = {
  ci_autofix: {
    dispatch: redispatch,
    onStarted: (row, executionId, db) => recordAutofixDispatched(db, row.payload.meta as AutofixAuditFacts, executionId),
    onAbandoned: (row, reason, db) => recordAutofixRefused(db, row.payload.meta as AutofixAuditFacts, { message: reason }),
    supersedeKey: (meta) => String(meta.sha ?? ''),
    // Distinct builds share one pending row (latest wins): the replaced build's attempt is recorded as refused, not lost.
    onSuperseded: (older, db) => recordAutofixRefused(db, older.payload.meta as AutofixAuditFacts, {
      reason: 'superseded', message: 'superseded: a newer build deferred for the same ticket, which is retried instead',
    }),
  },
  incident: {
    dispatch: redispatch,
    onStarted: nothing,
    onAbandoned: async (row, reason) => reportIncidentTriageRefused(String(row.payload.meta.incidentId ?? row.taskId), { message: reason }),
  },
  security: {
    dispatch: redispatch,
    onStarted: nothing,
    onAbandoned: async (row, reason, db) => {
      const auditId = Number(row.payload.meta.auditId);
      if (Number.isSafeInteger(auditId)) await failSecurityAudit(db, row.tenantId, auditId, `Audit dispatch abandoned: ${reason}`);
    },
  },
  validation: { dispatch: redispatch, onStarted: nothing, onAbandoned: nothing },
};
