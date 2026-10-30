import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ExecutionStatus } from '../../domain/shared/types';
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { teardownCrashedRunArtifacts } from './runRollback';

/**
 * failedRunSweep - the branch residue of a cloud run that landed FAILED.
 *
 * A cloud run commits to a `builderforce/task-<id>` branch as it goes. A run that is CANCELLED has its branch swept by the cloud
 * finalize (`cloudFinalize`: it knows the paths the run wrote), and one that finishes with work gets a revertable snapshot. A run that
 * FAILS - a sandbox that kept crashing, a gateway failure, a stalled model, a reaped orphan - never reaches either, so its half-written
 * branch used to stay forever. It is swept here, at the one place every terminal status is persisted (`buildExecutionRepository`'s
 * `onTerminal`, the same hook that records the run's outcome row), by the same conservative decision as the cancelled path: only a
 * branch that is provably nothing but this run's abandoned work, with no PR, is deleted (`teardownCrashedRunArtifacts`).
 *
 * Best-effort: a sweep that throws is reported and swallowed - it must never change how the run landed.
 */
export async function sweepFailedCloudRun(
  env: Env,
  db: Db,
  run: { id: unknown; status: string; cloudAgentRef: string | null },
): Promise<void> {
  // Only a cloud run (it is attributed to a cloud agent) that landed FAILED: a host's run, a completed or cancelled one is not this module's.
  if (run.status !== ExecutionStatus.FAILED || !run.cloudAgentRef) return;
  await teardownCrashedRunArtifacts(env, db, { executionId: Number(run.id), secret: integrationCredentialSecret(env) })
    .catch((error: unknown) => reportCaughtError(error, { source: 'application/runtime/failedRunSweep.ts', operation: 'sweepFailedCloudRun', context: { logMessage: '[failed-run-sweep] branch sweep failed', details: { executionId: Number(run.id), error } } }));
}
