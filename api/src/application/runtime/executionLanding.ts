/**
 * executionLanding - the ONE way code OUTSIDE `RuntimeService` lands an execution terminal (a rehearsal, the crash path, a stranded
 * dispatch, an analysis run). It is `IExecutionRepository.land` (built in the composition root, `buildExecutionRepository`, wired to the
 * run's outcome owner), so a terminal write can neither overwrite a run that already landed nor skip the outcome row - and a caller
 * that LOSES the race skips its side effects. (`check:execution-landing` fails a raw terminal write anywhere else.)
 */
import { asExecutionId } from '../../domain/shared/types';
import type { IExecutionRepository, LandContext, LandFields, NonTerminalStatus, TerminalStatus } from '../../domain/execution/IExecutionRepository';
import { EXECUTION_NON_TERMINAL_STATUSES } from '../../domain/shared/terminalStatus';
import type { Execution } from '../../domain/execution/Execution';

/**
 * Land an execution terminal. `won: false` means another writer got there first: skip audits, narration, signals and lane moves.
 * `context.telemetry` is the run's final tally when the lander has one (a rehearsal does); without it the outcome row carries no counts.
 */
export function landExecution(
  executions: IExecutionRepository,
  executionId: number,
  status: TerminalStatus,
  fields: LandFields = {},
  from?: readonly NonTerminalStatus[],
  context: LandContext = {},
): Promise<{ won: boolean; execution: Execution }> {
  return executions.land(asExecutionId(executionId), status, fields, from, context);
}

/**
 * Persist a domain transition the right way: a TERMINAL entity lands (one winner; its outcome row recorded; `won: false` = lost, so
 * skip every side effect), anything else is a guarded write that REPORTS whether it applied - a stale RUNNING write that finds the
 * run already terminal is refused by the repository and comes back `won: false` with the winner's row, exactly like a lost landing.
 */
export async function persistTransition(
  executions: IExecutionRepository,
  entity: Execution,
  telemetry?: object,
): Promise<{ won: boolean; execution: Execution }> {
  const p = entity.toPlain();
  if (EXECUTION_NON_TERMINAL_STATUSES.includes(p.status)) {
    const saved = await executions.update(entity);
    return { won: saved.status === p.status, execution: saved };
  }
  return executions.land(entity.id, p.status as TerminalStatus, { result: p.result, errorMessage: p.errorMessage, produced: p.produced, completedAt: p.completedAt }, undefined, { telemetry });
}
