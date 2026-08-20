/**
 * The gate in front of a run of a workflow whose card says "Approval required".
 *
 * It is the SAME gate `task.execution` uses — `approval/approvalGate.ts` decides,
 * the `approvals` table holds the record, `runApprovalExpirySweep` escalates a
 * forgotten one, and approving it actually starts the act rather than merely
 * unlocking it. A canvas-only approval concept was the obvious alternative and
 * would have been wrong twice over: an approval nobody can see in the approvals
 * queue is not governance, and a second definition of "already approved" is how
 * one act comes to be approved in one place and pending in another.
 *
 * What is gated is the DEFINITION, not the individual run: the mode is authored
 * on the definition, so the subject is its id. That means one approval unblocks
 * the runs it was granted for until it expires — deliberately, because the thing
 * the approver read and agreed to is the definition's graph.
 */
import { and, eq } from 'drizzle-orm';
import { resolveApprovalGate } from '../approval/approvalGate';
import { instantiateWorkflowRun, runTargetFromDefinition } from './instantiateRun';
import { workflowDefinitions } from '../../infrastructure/database/schema';
import { parseDefinition } from '../../domain/workflowGraph';
import type { Db } from '../../infrastructure/database/connection';

/** `approvals.action_type` for a gated workflow run. */
export const WORKFLOW_RUN_ACTION_TYPE = 'workflow.run';

/** The metadata key naming which definition an approval is about. */
export const WORKFLOW_RUN_SUBJECT_KEY = 'workflowDefinitionId';

/**
 * How long a granted approval stands. It MUST be set: without an `expires_at`
 * the expiry sweep can never escalate a forgotten request, so a gated workflow
 * would sit blocked in silence — the exact failure `executionPause` documents.
 */
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/** The definition fields the gate rules on. A structural subset of the row. */
export interface WorkflowRunGateDefinition {
  id: string;
  name: string;
  approvalMode: string;
  runTargetCloudAgentRef: string | null;
}

export type WorkflowRunApprovalVerdict =
  | { allowed: true }
  | { allowed: false; approvalId: string; status: 'pending'; reason: string; opened: boolean };

/**
 * Decide whether this definition may start a run now.
 *
 * `autonomous` (the default, and what every definition written before 1092
 * means) is not gated at all. `required` goes through the shared gate.
 */
export async function evaluateWorkflowRunApprovalGate(
  db: Db,
  tenantId: number,
  requestedBy: string | null,
  definition: WorkflowRunGateDefinition,
): Promise<WorkflowRunApprovalVerdict> {
  if (definition.approvalMode !== 'required') return { allowed: true };

  const verdict = await resolveApprovalGate(db, {
    tenantId,
    actionType: WORKFLOW_RUN_ACTION_TYPE,
    subjectKey: WORKFLOW_RUN_SUBJECT_KEY,
    subjectId: definition.id,
    pendingReason: `"${definition.name}" is waiting for approval before it can run.`,
    openedReason: `"${definition.name}" is set to require approval, so a human must approve this run first.`,
    draft: () => ({
      requestedBy,
      cloudAgentRef: definition.runTargetCloudAgentRef,
      description: `Approve running the workflow "${definition.name}"`,
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    }),
  });

  if (verdict.allowed) return { allowed: true };
  return {
    allowed: false,
    approvalId: verdict.approvalId,
    status: 'pending',
    reason: verdict.reason,
    opened: verdict.opened,
  };
}

/**
 * Start the run an approval was granted for.
 *
 * Approving must actually START the workflow, for the same reason approving a
 * `task.execution` gate replays its submit: an approval that only unlocks the
 * gate leaves the work sitting idle until somebody goes back and clicks Run
 * again, which reads to the approver as though nothing happened. Returns the run
 * id, or null when the definition has since been deleted or will not compile.
 */
export async function startApprovedWorkflowRun(
  db: Db,
  tenantId: number,
  segmentId: string | null,
  definitionId: string,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.id, definitionId), eq(workflowDefinitions.tenantId, tenantId)));
  if (!row) return null;

  const result = await instantiateWorkflowRun(db, {
    tenantId,
    segmentId,
    definition: parseDefinition(row.definition),
    name: row.name,
    projectId: row.projectId,
    definitionId: row.id,
    target: runTargetFromDefinition(row),
    triggerSource: 'approval',
  });
  return result.ok ? result.workflowId : null;
}
