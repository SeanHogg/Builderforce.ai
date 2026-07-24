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
import { resolveNextTaskStatus } from './application/swimlane/nextLane';
import { ChatTicketService } from './application/brain/ChatTicketService';
import { attributeRunToManifest } from './application/kanban/attributeRunToManifest';
import { coordinateCompletedStage } from './application/manager/coordinateTicket';
import { findCanonicalBoard } from './application/swimlane/canonicalBoard';
import { resolvePolicyGates } from './application/governance/policyPackService';

export function buildRuntimeService(env: Env, db: Db): RuntimeService {
  // eslint-disable-next-line prefer-const -- the lane-auto callback closes over the
  // instance it belongs to; it is only ever invoked after construction completes.
  let runtimeService: RuntimeService;
  runtimeService = new RuntimeService(
    new ExecutionRepository(db),
    new TaskRepository(db),
    new AgentRepository(db),
    new AuditRepository(db, env),
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
    // Config-driven completion advance: move the ticket into the board's next
    // swimlane by position (not a hardcoded in_review), so a custom lane sequence
    // flows correctly. Null → the default in_review applies (non-board task).
    (info) => resolveNextTaskStatus(db, info.projectId, info.fromStatus),
    // Run milestones → linked Brain chats: narrate a cloud-agent run's progress
    // (started ▸ completed ▸ failed) back into every chat the ticket is linked to, so
    // "the devs provide updates as they work" is visible in the conversation that spawned
    // the work. Runtime chat-awareness. Best-effort (postRunMilestone swallows its own
    // errors + dedupes per execution+phase); the extra guard keeps a construction/throw
    // from ever bubbling into RuntimeService.update.
    (info) => new ChatTicketService(db, env).postRunMilestone(info.tenantId, {
      kind: info.taskType, ref: String(info.taskId), agentRef: info.agentRef,
      phase: info.phase, executionId: info.executionId,
      toStatus: info.toStatus, resultText: info.resultText, errorMessage: info.errorMessage,
      questionText: info.questionText, eventNonce: info.eventNonce,
    }).catch(() => {}),
    // Coordinated Role Participation attribution: a terminal run records that the role
    // it ran AS participated on the ticket's manifest (linked to the execution), and —
    // for a producer with PR evidence — completes that slot. Best-effort.
    (info) => attributeRunToManifest(env, db, info),
    async (info) => {
      const board = await findCanonicalBoard(db, info.projectId, info.tenantId);
      if (!board?.lifecycleManaged) return { managed: false, toStatus: info.fromStatus };

      // Attribution must precede verification: the Coordinator evaluates the
      // manifest produced by this exact execution, then and only then may advance.
      if (info.status === 'completed' || info.status === 'failed') {
        await attributeRunToManifest(env, db, {
          tenantId: info.tenantId, taskId: info.taskId, projectId: info.projectId,
          executionId: info.executionId, status: info.status,
          actAsRole: info.actAsRole, laneServed: info.laneServed,
        });
      }
      if (info.status !== 'completed') return { managed: true, toStatus: info.fromStatus };
      const result = await coordinateCompletedStage(env, db, runtimeService, {
        tenantId: info.tenantId, projectId: info.projectId, taskId: info.taskId,
        fromStatus: info.laneServed ?? info.fromStatus,
      });
      return { managed: result.managed, toStatus: result.toStatus };
    },
    // Governance: resolve the tenant's effective policy gates for the run being
    // submitted. This is what closes the loop between an authored policy pack
    // (migration 0348) and `evaluatePolicyGate` at the engine's tool seam — the
    // enforcement machinery already existed but never received gates. Cached
    // read-through, invalidated on every pack/gate write.
    (scope) => resolvePolicyGates(env, db, scope),
  );
  return runtimeService;
}
