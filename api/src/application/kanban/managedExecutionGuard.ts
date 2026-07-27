import { reportCaughtError } from '../observability/caughtErrorReporter';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { projects, swimlanes, tasks } from '../../infrastructure/database/schema';
import { parseActAsRole, parseCloudAgentRef, parseLaneKey } from '../runtime/cloudDispatch';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';
import { isAgentRefRoleCapable } from './roleCapability';
import { loadStageProducerSlots, resolveManagedLaneAuthority, slotAuthorizesRole } from './managedLaneRoles';

export interface ManagedExecutionDecision { allowed: boolean; managed: boolean; reason?: string }

/**
 * Managed boards accept only Coordinator-issued, role-attributed executions.
 *
 * The authorized role set comes from {@link resolveManagedLaneAuthority} — the SAME
 * resolver the lane trigger picks its producer from. That shared source is load-bearing:
 * while this guard derived the set privately, the trigger had no way to build a payload
 * it would accept, so every autonomous dispatch on a managed board threw and the ticket
 * churned an `auto_run_error` per sweep forever. See `managedLaneRoles.ts` for the
 * measured failure and `evaluateAutoRun` for the consuming side.
 */
export async function authorizeManagedTaskExecution(
  db: Db, tenantId: number, taskId: number, payload: string | undefined,
): Promise<ManagedExecutionDecision> {
  const [task] = await db.select({ projectId: tasks.projectId, status: tasks.status, taskType: tasks.taskType, actionType: tasks.actionType })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(projects.tenantId, tenantId), eq(tasks.id, taskId)))
    .limit(1);
  if (!task) return { allowed: false, managed: false, reason: 'task not found' };
  const board = await findCanonicalBoard(db, task.projectId, tenantId);
  if (!board?.lifecycleManaged) return { allowed: true, managed: false };

  const roleKey = parseActAsRole(payload);
  const agentRef = parseCloudAgentRef(payload);
  if (!roleKey || !agentRef) {
    return { allowed: false, managed: true, reason: 'This ticket is lifecycle-managed. Use the Coordinator to dispatch a required role; the assignee is not an executor.' };
  }
  // THE STAGE BEING SERVED IS THE PAYLOAD'S, NOT THE TICKET'S CURRENT STATUS. A role run
  // is dispatched against one accountability slot, and an outstanding slot routinely
  // belongs to an EARLIER stage than the lane the ticket now sits in — that is what
  // "waiting on 10 of 10 sign-offs in review" means. Measuring a Developer's outstanding
  // `in_progress` slot against the ticket's `in_review` status refused it every time:
  // measured on project 11, the gate held 24 tickets and asked exactly ZERO of the 227
  // agent-owed slots to sign off, on every pass, forever.
  const stageKey = parseLaneKey(payload) ?? task.status;
  const [lane] = await db.select({ id: swimlanes.id }).from(swimlanes)
    .where(and(eq(swimlanes.tenantId, tenantId), eq(swimlanes.boardId, board.id), eq(swimlanes.key, stageKey))).limit(1);
  if (!lane) return { allowed: false, managed: true, reason: `No coordinated stage exists for status '${stageKey}'.` };

  const [authority, slots] = await Promise.all([
    resolveManagedLaneAuthority(db, { tenantId, swimlaneId: lane.id, task })
      .catch((error) => {
        reportCaughtError(error, { source: "application/kanban/managedExecutionGuard.ts", operation: "authority", context: { logMessage: '[managed-execution-guard] lane authority resolution failed', details: {
          tenantId,
          taskId,
          swimlaneId: lane.id,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        } } });
        return { roleKeys: [] as string[], approvers: [], tier: 'none' as const };
      }),
    loadStageProducerSlots(db, { tenantId, taskId, stageKey }).catch(() => []),
  ]);
  // Either the lane TEMPLATE authorizes the role, or the ticket's OWN manifest does. The
  // second is strictly more specific and was written by the coordinator, so a slot the
  // lifecycle itself opened can always be worked — see `slotAuthorizesRole`.
  if (!authority.roleKeys.includes(roleKey) && !slotAuthorizesRole(slots, roleKey)) {
    return { allowed: false, managed: true, reason: `Role '${roleKey}' is not required in stage '${stageKey}'.` };
  }
  if (!(await isAgentRefRoleCapable(db, tenantId, agentRef, roleKey, task.projectId))) {
    return { allowed: false, managed: true, reason: `Agent '${agentRef}' is not capable of acting as role '${roleKey}'.` };
  }
  return { allowed: true, managed: true };
}
