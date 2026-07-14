import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { swimlaneRequirements, swimlanes, tasks } from '../../infrastructure/database/schema';
import { parseActAsRole, parseCloudAgentRef } from '../runtime/cloudDispatch';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';
import { isAgentRefRoleCapable } from './roleCapability';
import { requirementApplies } from './types';

export interface ManagedExecutionDecision { allowed: boolean; managed: boolean; reason?: string }

/** Managed boards accept only Coordinator-issued, role-attributed executions. */
export async function authorizeManagedTaskExecution(
  db: Db, tenantId: number, taskId: number, payload: string | undefined,
): Promise<ManagedExecutionDecision> {
  const [task] = await db.select({ projectId: tasks.projectId, status: tasks.status, taskType: tasks.taskType, actionType: tasks.actionType })
    .from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return { allowed: false, managed: false, reason: 'task not found' };
  const board = await findCanonicalBoard(db, task.projectId, tenantId);
  if (!board?.lifecycleManaged) return { allowed: true, managed: false };

  const roleKey = parseActAsRole(payload);
  const agentRef = parseCloudAgentRef(payload);
  if (!roleKey || !agentRef) {
    return { allowed: false, managed: true, reason: 'This ticket is lifecycle-managed. Use the Coordinator to dispatch a required role; the assignee is not an executor.' };
  }
  const [lane] = await db.select({ id: swimlanes.id }).from(swimlanes)
    .where(and(eq(swimlanes.boardId, board.id), eq(swimlanes.key, task.status))).limit(1);
  if (!lane) return { allowed: false, managed: true, reason: `No coordinated stage exists for status '${task.status}'.` };
  const requirements = await db.select({ kind: swimlaneRequirements.kind, ref: swimlaneRequirements.ref, responsibility: swimlaneRequirements.responsibility, ticketType: swimlaneRequirements.ticketType, condition: swimlaneRequirements.condition })
    .from(swimlaneRequirements).where(and(eq(swimlaneRequirements.swimlaneId, lane.id), eq(swimlaneRequirements.isRequired, true)));
  const roleRequiredHere = requirements.some((r) =>
    (r.kind === 'role' || r.kind === 'review') && r.ref === roleKey
    && requirementApplies({ ticketType: r.ticketType, condition: r.condition }, task));
  if (!roleRequiredHere) return { allowed: false, managed: true, reason: `Role '${roleKey}' is not required in stage '${task.status}'.` };
  if (!(await isAgentRefRoleCapable(db, tenantId, agentRef, roleKey))) {
    return { allowed: false, managed: true, reason: `Agent '${agentRef}' is not capable of acting as role '${roleKey}'.` };
  }
  return { allowed: true, managed: true };
}
