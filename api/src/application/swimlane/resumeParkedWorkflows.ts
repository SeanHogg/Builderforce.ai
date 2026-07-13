/**
 * Parked-workflow resume sweep — the back-edge that makes a `run_workflow` lane
 * action genuinely GATE on its downstream workflow.
 *
 * A ticket whose lane action is `run_workflow` parks at lifecycle
 * 'awaiting_workflow' (recording the spawned workflow id) instead of advancing.
 * This sweep finds every parked ticket whose awaited workflow has reached a
 * terminal status and resumes it via {@link SwimlaneCoordinator.onSpawnedWorkflowSettled}
 * (success → advance; failure → needs_attention). It is poll-based on purpose so
 * it works regardless of whether the spawned workflow ran on the cloud executor
 * or a self-hosted agentHost — neither completion path needs to know about the
 * ticket. Invoked from the Worker `scheduled()` handler on the frequent tick,
 * alongside the trigger sweep. Cheap on an idle tick (one indexed query).
 */

import { and, eq, isNotNull, inArray } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import { ticketRuns, workflows } from '../../infrastructure/database/schema';
import { SwimlaneCoordinator } from './SwimlaneCoordinator';
import { DrizzleCoordinatorStore } from './DrizzleCoordinatorStore';
import { DrizzleStageWorkflowRunner } from './stageWorkflowRunner';
import { DrizzlePrdEnsurer } from './DrizzlePrdEnsurer';
import { AgentHostStageDispatcher, type AgentHostRelayNamespace } from './agentHostStageDispatcher';
import type { WorkflowStatus } from './transitions';
import type { Env } from '../../env';

export interface ResumeParkedEnv {
  NEON_DATABASE_URL: string;
  AGENT_HOST_RELAY?: AgentHostRelayNamespace;
}

export interface ResumeParkedResult {
  parked: number;
  resumed: number;
  errors: number;
}

const TERMINAL: WorkflowStatus[] = ['completed', 'failed', 'cancelled'];

/** Resume every ticket parked on a now-settled run_workflow. Safe per cron tick. */
export async function runParkedWorkflowSweep(env: ResumeParkedEnv): Promise<ResumeParkedResult> {
  const db = buildDatabase(env as unknown as Parameters<typeof buildDatabase>[0]);

  // Parked tickets joined to their awaited workflow's status, terminal only.
  const rows = await db
    .select({
      workflowId: ticketRuns.awaitingWorkflowId,
      status: workflows.status,
    })
    .from(ticketRuns)
    .innerJoin(workflows, eq(workflows.id, ticketRuns.awaitingWorkflowId))
    .where(
      and(
        eq(ticketRuns.lifecycle, 'awaiting_workflow'),
        isNotNull(ticketRuns.awaitingWorkflowId),
        inArray(workflows.status, TERMINAL),
      ),
    );

  const result: ResumeParkedResult = { parked: rows.length, resumed: 0, errors: 0 };
  if (rows.length === 0) return result;

  const coordinator = new SwimlaneCoordinator(
    new DrizzleCoordinatorStore(db),
    new AgentHostStageDispatcher(env.AGENT_HOST_RELAY),
    new DrizzleStageWorkflowRunner(db),
    new DrizzlePrdEnsurer(db, env as unknown as Env),
  );

  for (const row of rows) {
    if (!row.workflowId) continue;
    try {
      const updated = await coordinator.onSpawnedWorkflowSettled(row.workflowId, row.status as WorkflowStatus);
      if (updated) result.resumed++;
    } catch (e) {
      result.errors++;
      console.error(`[cron:wf-gate] resume for workflow ${row.workflowId} failed`, e);
    }
  }

  console.log(`[cron:wf-gate] parked=${result.parked} resumed=${result.resumed} errors=${result.errors}`);
  return result;
}
