/**
 * Composition-root factory for the execution repository: the ONE place the `ExecutionRepository` is constructed and wired to the run's
 * outcome owner (`cloudOutcomeRow`). `buildRuntimeService` and every out-of-service lander (a rehearsal, the crash path, a stranded
 * dispatch, an analysis run, the cron reaper) take their `IExecutionRepository` from here; application code only ever sees the port.
 */
import type { Db } from './infrastructure/database/connection';
import { ExecutionRepository } from './infrastructure/repositories/ExecutionRepository';
import { recordReapedOutcomes, recordTerminalOutcome } from './application/runtime/cloudOutcomeRow';
import { voidUnboundGrantOnTerminal } from './application/runtime/mergeGrants';
import { reportCaughtError } from './application/observability/caughtErrorReporter';

/** The execution repository wired to the outcome owner: every terminal status it lands is recorded once, by that owner. */
export function buildExecutionRepository(db: Db): ExecutionRepository {
  return new ExecutionRepository(db, {
    onTerminal: async (saved, context) => {
      await recordTerminalOutcome(db, saved, context.telemetry);
      // PRD 48 §4.6 — a run that lands anything but `completed` voids its unbound merge grant, so a
      // grant never sits "pending" on a run that failed before finalize or was refused admission.
      const plain = saved.toPlain();
      await voidUnboundGrantOnTerminal(db, { id: plain.id, tenantId: plain.tenantId, status: plain.status })
        .catch((error) => reportCaughtError(error, { source: 'buildExecutionRepository.ts', operation: 'voidUnboundGrantOnTerminal', context: { executionId: plain.id } }));
    },
    onReaped: async (rows) => {
      await recordReapedOutcomes(db, rows);
      for (const row of rows) {
        await voidUnboundGrantOnTerminal(db, { id: row.id, tenantId: row.tenant_id, status: 'failed' })
          .catch((error) => reportCaughtError(error, { source: 'buildExecutionRepository.ts', operation: 'voidUnboundGrantOnTerminal.reaped', context: { executionId: row.id } }));
      }
    },
  });
}
