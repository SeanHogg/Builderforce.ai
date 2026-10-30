/**
 * executionLanding - the ONE way code OUTSIDE `RuntimeService` lands an execution terminal (a rehearsal, the crash path, a stranded
 * dispatch, an analysis run). It is `ExecutionRepository.land` wired to the run's outcome owner, so a terminal write can neither
 * overwrite a run that already landed nor skip the outcome row - and a caller that LOSES the race skips its side effects.
 * (`check:execution-landing` fails a raw terminal write anywhere else.)
 */
import { ExecutionRepository } from '../../infrastructure/repositories/ExecutionRepository';
import type { ExecutionStatus } from '../../domain/shared/types';
import { asExecutionId } from '../../domain/shared/types';
import type { IExecutionRepository, LandFields, TerminalStatus } from '../../domain/execution/IExecutionRepository';
import { EXECUTION_NON_TERMINAL_STATUSES } from '../../domain/shared/terminalStatus';
import type { Execution } from '../../domain/execution/Execution';
import type { Db } from '../../infrastructure/database/connection';
import { recordTerminalOutcome } from './cloudOutcomeRow';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** The execution repository wired to the outcome owner: every terminal status it lands is recorded once, by that owner. */
export function executionRepositoryFor(db: Db): ExecutionRepository {
  return new ExecutionRepository(db, { onTerminal: (saved, context) => recordTerminalOutcome(db, saved, context.telemetry) });
}

/** Land an execution terminal. `won: false` means another writer got there first: skip audits, narration, signals and lane moves. */
export function landExecution(
  db: Db,
  executionId: number,
  status: TerminalStatus,
  fields: LandFields = {},
  from?: readonly ExecutionStatus[],
): Promise<{ won: boolean; execution: Execution }> {
  return executionRepositoryFor(db).land(asExecutionId(executionId), status, fields, from);
}

/**
 * A lane advance is a durable product of the run just as much as a commit or PR (`finalizeCloudRun` stamps repository artifacts before the
 * lifecycle transition): complete the productivity verdict once the authoritative from/to statuses are known, so a legitimate no-code
 * workflow that advances a ticket is not counted as an empty completion and cannot trip the unproductive-run breaker. Best-effort.
 */
export async function stampProducedFromLaneMove(executions: IExecutionRepository, saved: Execution): Promise<Execution> {
  if (saved.produced === true) return saved;
  try {
    return await executions.setProduced(saved.id, true);
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/runtime/executionLanding.ts', operation: 'markProducedFromLaneMove',
      context: { executionId: Number(saved.id), taskId: Number(saved.taskId) },
    });
    return saved;
  }
}

/**
 * Persist a domain transition the right way: a TERMINAL entity lands (one winner; its outcome row recorded; `won: false` = lost, so
 * skip every side effect), anything else is an ordinary guarded write (always `won: true`).
 */
export async function persistTransition(
  executions: IExecutionRepository,
  entity: Execution,
  telemetry?: object,
): Promise<{ won: boolean; execution: Execution }> {
  const p = entity.toPlain();
  if (EXECUTION_NON_TERMINAL_STATUSES.includes(p.status)) return { won: true, execution: await executions.update(entity) };
  return executions.land(entity.id, p.status as TerminalStatus, { result: p.result, errorMessage: p.errorMessage, produced: p.produced, completedAt: p.completedAt }, undefined, { telemetry });
}
