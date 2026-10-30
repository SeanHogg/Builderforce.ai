/**
 * Composition-root factory for the execution repository: the ONE place the `ExecutionRepository` is constructed and wired to the run's
 * outcome owner (`cloudOutcomeRow`). `buildRuntimeService` and every out-of-service lander (a rehearsal, the crash path, a stranded
 * dispatch, an analysis run) take their `IExecutionRepository` from here; application code only ever sees the port.
 */
import type { Db } from './infrastructure/database/connection';
import { ExecutionRepository } from './infrastructure/repositories/ExecutionRepository';
import { recordTerminalOutcome } from './application/runtime/cloudOutcomeRow';

/** The execution repository wired to the outcome owner: every terminal status it lands is recorded once, by that owner. */
export function buildExecutionRepository(db: Db): ExecutionRepository {
  return new ExecutionRepository(db, { onTerminal: (saved, context) => recordTerminalOutcome(db, saved, context.telemetry) });
}
