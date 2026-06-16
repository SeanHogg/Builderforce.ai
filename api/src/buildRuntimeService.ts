/**
 * Composition-root factory for {@link RuntimeService}.
 *
 * RuntimeService.update is the ONE canonical execution-status transition: it moves
 * the `executions` row AND fans out every side-effect a status change owns — the
 * task-lane sync, ticket metrics ({@link syncExecutionTaskLifecycle}), the
 * autonomous next-lane trigger ({@link maybeAutoRunOnLaneEntry}), the audit event,
 * and the terminal-failure telemetry sink. Wiring it in one place means every
 * entry point that drives executions — the Worker request handler ({@link index})
 * and the durable cloud runner ({@link CloudRunnerDO}) — shares the IDENTICAL
 * behavior instead of each open-coding its own `db.update(executions)` (which is
 * how the durable surface silently skipped the board move + chaining, and the
 * container surface skipped the RUNNING transition entirely).
 */
import type { Env } from './env';
import type { Db } from './infrastructure/database/connection';
import { ExecutionRepository } from './infrastructure/repositories/ExecutionRepository';
import { TaskRepository } from './infrastructure/repositories/TaskRepository';
import { AgentRepository } from './infrastructure/repositories/AgentRepository';
import { AuditRepository } from './infrastructure/repositories/AuditRepository';
import { RuntimeService } from './application/runtime/RuntimeService';
import { recordRunFailureEvent } from './application/runtime/recordRunFailureEvent';
import { loadCloudRunForSelfHeal, selfHealCloudRun } from './application/runtime/cloudSelfHeal';
import { syncExecutionTaskLifecycle } from './application/task/taskLifecycle';
import { maybeAutoRunOnLaneEntry } from './presentation/routes/taskRoutes';

export function buildRuntimeService(env: Env, db: Db): RuntimeService {
  // eslint-disable-next-line prefer-const -- the lane-auto callback closes over the
  // instance it belongs to; it is only ever invoked after construction completes.
  let runtimeService: RuntimeService;
  runtimeService = new RuntimeService(
    new ExecutionRepository(db),
    new TaskRepository(db),
    new AgentRepository(db),
    new AuditRepository(db),
    (e) => recordRunFailureEvent(db, e),
    (info) => syncExecutionTaskLifecycle(env, db, info),
    async (e) => {
      // Read-path self-heal: re-queue a stale cloud run once on the durable executor
      // before it is failed (shares the cron's logic via cloudSelfHeal).
      const input = await loadCloudRunForSelfHeal(db, e.id);
      if (!input) return 'failed';
      return (await selfHealCloudRun(env, db, input)) === 'requeued' ? 'requeued' : 'failed';
    },
    // Autonomous chaining: when an agent advances its ticket into the next lane,
    // start that lane's configured agent via the SAME trigger a human board-drag
    // uses — so a multi-stage board (BA → Dev → QA …) flows without a human nudging
    // each handoff. maybeAutoRunOnLaneEntry awaits the executor kickoff internally
    // (the new agent's heavy loop then runs in its own DO/container), so awaiting it
    // here outlives setup without depending on a request `executionCtx`.
    async (info) => {
      await maybeAutoRunOnLaneEntry(env, db, runtimeService, { ...info, submittedBy: 'system:lane-auto' });
    },
  );
  return runtimeService;
}
