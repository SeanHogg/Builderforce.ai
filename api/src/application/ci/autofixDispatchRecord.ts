/**
 * The audit rows that follow a CI auto-fix dispatch decision - written by BOTH the direct path
 * (`handleCiEventOutcome`, the webhook's own dispatch) and the deferred path (the
 * `deferred-dispatch` sweep's `ci_autofix` handler), so the two can never disagree about what
 * the loop-guard sees.
 *
 * `AUTOFIX_DISPATCH_EVENT` is load-bearing, not telemetry: `ingestRepoCiEvent` counts these per
 * task for the attempt budget and reads `sha` back off them for the per-build de-duplication. A
 * deferred auto-fix that started without this row would spend no attempt and would be dispatched
 * a second time by the next status post for the same build. `AUTOFIX_REFUSED_EVENT` is a
 * different name on purpose, so a refusal can never spend the build's fix budget.
 */
import type { Db } from '../../infrastructure/database/connection';
import { redactThenCap } from '../../infrastructure/security/redactSecrets';
import { insertToolAudit } from '../audit/toolAuditWrite';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { AUTOFIX_DISPATCH_EVENT, AUTOFIX_REFUSED_EVENT } from './ingestRepoCiEvent';

/** What the auto-fix intent carries that its audit rows record (all of it plain JSON, so it parks as `meta`). */
export type AutofixAuditFacts = {
  taskId: number;
  tenantId: number;
  attempt: number;
  source: string;
  sha: string | null;
  statusKey: string | null;
};

/** A started auto-fix run: the row the loop-guard counts and de-duplicates on. */
export async function recordAutofixDispatched(db: Db, facts: AutofixAuditFacts, executionId: number): Promise<void> {
  await insertToolAudit(db, {
    tenantId: facts.tenantId, agentHostId: null, cloudAgentRef: null,
    executionId, sessionKey: `exec:${executionId}`,
    toolName: AUTOFIX_DISPATCH_EVENT, category: 'ci',
    // `sha` is load-bearing, not just telemetry: the per-build de-duplication
    // in `ingestRepoCiEvent` reads it back off these rows.
    args: JSON.stringify({ taskId: facts.taskId, attempt: facts.attempt, source: facts.source, sha: facts.sha, statusKey: facts.statusKey }),
    result: `auto-fix run dispatched (attempt ${facts.attempt})`, ts: new Date(),
  }).catch((error) => { /* telemetry best-effort */
    reportCaughtError(error, { source: 'application/ci/autofixDispatchRecord.ts', operation: 'recordAutofixDispatched' });
  });
}

/** A declined (or still-deferred, or abandoned) auto-fix: a refused auto-fix used to vanish. */
export async function recordAutofixRefused(
  db: Db, facts: AutofixAuditFacts, outcome: { deferred?: boolean; reason?: string | null; message?: string | null },
): Promise<void> {
  await insertToolAudit(db, {
    tenantId: facts.tenantId, agentHostId: null, cloudAgentRef: null,
    executionId: null, sessionKey: `task:${facts.taskId}`,
    toolName: AUTOFIX_REFUSED_EVENT, category: 'ci',
    args: JSON.stringify({ taskId: facts.taskId, attempt: facts.attempt, source: facts.source, sha: facts.sha, statusKey: facts.statusKey, reason: outcome.reason ?? null }),
    result: redactThenCap(`auto-fix run ${outcome.deferred ? 'DEFERRED (parked, retried automatically)' : 'REFUSED'}: ${outcome.message ?? 'the dispatcher declined without a reason'}`, 300),
    ts: new Date(),
  }).catch((error) => {
    reportCaughtError(error, { source: 'application/ci/autofixDispatchRecord.ts', operation: 'recordAutofixRefused' });
  });
}
