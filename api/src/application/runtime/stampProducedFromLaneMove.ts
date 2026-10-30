/**
 * A lane advance is a durable product of the run just as much as a commit or PR (`finalizeCloudRun` stamps repository artifacts before the
 * lifecycle transition): complete the productivity verdict once the authoritative from/to statuses are known, so a legitimate no-code
 * workflow that advances a ticket is not counted as an empty completion and cannot trip the unproductive-run breaker. Best-effort.
 * Lives beside `RuntimeService`, its only caller.
 *
 * The verdict is a field of an ALREADY-LANDED run, so the landed row stays authoritative for everything else: only `produced` is
 * adopted from the write. (Taking whatever row the write handed back made the returned status depend on the repository's read-back -
 * a stale one turned a completed run into `running` for the caller.)
 */
import type { IExecutionRepository } from '../../domain/execution/IExecutionRepository';
import { Execution } from '../../domain/execution/Execution';
import { reportCaughtError } from '../observability/caughtErrorReporter';

export async function stampProducedFromLaneMove(executions: IExecutionRepository, saved: Execution): Promise<Execution> {
  if (saved.produced === true) return saved;
  try {
    await executions.setProduced(saved.id, true);
    return Execution.reconstitute({ ...saved.toPlain(), produced: true });
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/runtime/stampProducedFromLaneMove.ts', operation: 'markProducedFromLaneMove',
      context: { executionId: Number(saved.id), taskId: Number(saved.taskId) },
    });
    return saved;
  }
}
