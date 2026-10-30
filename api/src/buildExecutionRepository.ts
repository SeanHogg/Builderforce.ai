/**
 * Composition-root factory for the execution repository: the ONE place the `ExecutionRepository` is constructed and wired to the run's
 * outcome owner (`cloudOutcomeRow`). `buildRuntimeService` and every out-of-service lander (a rehearsal, the crash path, a stranded
 * dispatch, an analysis run) take their `IExecutionRepository` from here; application code only ever sees the port.
 */
import type { Db } from './infrastructure/database/connection';
import type { Env } from './env';
import { ExecutionRepository } from './infrastructure/repositories/ExecutionRepository';
import { recordTerminalOutcome } from './application/runtime/cloudOutcomeRow';
import { sweepFailedCloudRun } from './application/runtime/failedRunSweep';

/**
 * The execution repository wired to the outcome owner: every terminal status it lands is recorded once, by that owner. With `env` (a
 * lander that can reach the repo provider: the runtime service every cloud run lands through) a cloud run that landed FAILED also has
 * its abandoned branch swept, here - the one place a terminal status is persisted (`failedRunSweep`).
 */
export function buildExecutionRepository(db: Db, env?: Env): ExecutionRepository {
  return new ExecutionRepository(db, {
    onTerminal: async (saved, context) => {
      await recordTerminalOutcome(db, saved, context.telemetry);
      if (env) await sweepFailedCloudRun(env, db, saved);
    },
  });
}
