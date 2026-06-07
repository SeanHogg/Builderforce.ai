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
import type { StageWorkflowRunner } from './SwimlaneCoordinator';

export class DrizzleStageWorkflowRunner implements StageWorkflowRunner {
  constructor(private readonly db: Db) {}

  async run(
    workflowDefId: string,
    ctx: { tenantId: number; ticketRunId: string; taskId: number },
  ): Promise<void> {
    const [defRow] = await this.db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, workflowDefId), eq(workflowDefinitions.tenantId, ctx.tenantId)));
    // Definition deleted/renamed since assignment — skip rather than fail the
    // ticket (the stage already succeeded; the action is best-effort here).
    if (!defRow) return;

    await instantiateWorkflowRun(this.db, {
      tenantId: ctx.tenantId,
      segmentId: defRow.segmentId ?? null,
      definition: parseDefinition(defRow.definition),
      name: defRow.name,
      target: runTargetFromDefinition(defRow),
      triggerSource: `swimlane:ticket:${ctx.ticketRunId}`,
    });
  }
}
