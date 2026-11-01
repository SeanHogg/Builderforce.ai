/**
 * DrizzleStageWorkflowRunner — the real {@link StageWorkflowRunner}. When a lane's
 * `run_workflow` action fires, this loads the workflow definition and starts a
 * run via the shared {@link instantiateWorkflowRun}, reusing the exact contract
 * the manual `POST /workflow-definitions/:id/run` endpoint uses.
 */
import { and, eq } from 'drizzle-orm';
import { workflowDefinitions } from '../../infrastructure/database/schema';
import { parseDefinition } from '../../domain/workflowGraph';
import { instantiateWorkflowRun, runTargetFromDefinition } from '../workflow/instantiateRun';
import type { Db } from '../../infrastructure/database/connection';
import type { CronSignalEnv } from '../runtime/cronWorkSignal';
import type { StageWorkflowRunner, StageWorkflowRunResult } from './SwimlaneCoordinator';

export class DrizzleStageWorkflowRunner implements StageWorkflowRunner {
  /** `env` arms the next cron tick for the cloud run a lane action starts (see `InstantiateRunParams.env`). */
  constructor(private readonly db: Db, private readonly env?: CronSignalEnv) {}

  async run(
    workflowDefId: string,
    ctx: { tenantId: number; ticketRunId: string; taskId: number },
  ): Promise<StageWorkflowRunResult> {
    const [defRow] = await this.db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, workflowDefId), eq(workflowDefinitions.tenantId, ctx.tenantId)));
    // Definition deleted/renamed since assignment — surface as an error so the
    // coordinator routes the ticket to needs_attention instead of silently
    // advancing past an action that never ran.
    if (!defRow) {
      return { ok: false, error: `workflow definition ${workflowDefId} not found` };
    }

    const result = await instantiateWorkflowRun(this.db, {
      tenantId: ctx.tenantId,
      segmentId: defRow.segmentId ?? null,
      definition: parseDefinition(defRow.definition),
      name: defRow.name,
      projectId: defRow.projectId,
      definitionId: defRow.id,
      target: runTargetFromDefinition(defRow),
      triggerSource: `swimlane:ticket:${ctx.ticketRunId}`,
      env: this.env,
    });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, workflowId: result.workflowId };
  }
}
