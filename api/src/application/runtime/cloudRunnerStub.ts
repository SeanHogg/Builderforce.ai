/**
 * Addressing the durable cloud runner (`CloudRunnerDO`): ONE place spells the
 * per-execution instance name, so dispatch, self-heal, resume, delegation and the
 * cancel signal can never address different instances for the same run.
 */
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Env } from '../../env';

/** The runner instance that owns `executionId`. */
export function cloudRunnerStub(ns: DurableObjectNamespace, executionId: number): DurableObjectStub {
  return ns.get(ns.idFromName(`exec:${executionId}`));
}

/**
 * Tell the run's durable runner it was concluded elsewhere (a cancel), so it stops on
 * its next cancel poll instead of on its next DB re-read. A run that never touched the
 * runner (container / GitHub Actions) wakes an empty instance that records nothing.
 * Best-effort: the runner's own periodic re-read is the backstop.
 */
export async function signalCloudRunnerConcluded(env: Pick<Env, 'CLOUD_RUNNER'>, executionId: number): Promise<void> {
  if (!env.CLOUD_RUNNER) return;
  await cloudRunnerStub(env.CLOUD_RUNNER, executionId)
    .fetch('https://cloud-runner/concluded', { method: 'POST' })
    .catch((error) => reportCaughtError(error, { source: 'application/runtime/cloudRunnerStub.ts', operation: 'signalCloudRunnerConcluded', context: { executionId } }));
}
