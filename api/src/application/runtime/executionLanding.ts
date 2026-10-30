/**
 * executionLanding - the ONE way code OUTSIDE `RuntimeService` lands an execution terminal (a rehearsal, the crash path, a stranded
 * dispatch, an analysis run). It is `ExecutionRepository.land` wired to the run's outcome owner, so a terminal write can neither
 * overwrite a run that already landed nor skip the outcome row - and a caller that LOSES the race skips its side effects.
 * (`check:execution-landing` fails a raw terminal write anywhere else.)
 */
import { ExecutionRepository } from '../../infrastructure/repositories/ExecutionRepository';
import type { ExecutionStatus } from '../../domain/shared/types';
import { asExecutionId } from '../../domain/shared/types';
import type { LandFields, TerminalStatus } from '../../domain/execution/IExecutionRepository';
import type { Execution } from '../../domain/execution/Execution';
import type { Db } from '../../infrastructure/database/connection';
import { recordTerminalOutcome } from './cloudOutcomeRow';

/** The execution repository wired to the outcome owner: every terminal status it lands is recorded once, by that owner. */
export function executionRepositoryFor(db: Db): ExecutionRepository {
  return new ExecutionRepository(db, { onTerminal: (saved) => recordTerminalOutcome(db, saved) });
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
