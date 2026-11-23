import { asksForChange } from '@builderforce/agent-stall';
import type { AssignedWork, WorkEvidence } from '@builderforce/agent-run';
import { and, eq, isNull } from 'drizzle-orm';
import { executions, toolAuditEvents } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { CloudRunHost } from './cloudRunHost';
import { childHandle, MAX_CHILD_ROWS, parseCloudChild } from './cloudChildSpec';

export const CHILD_WORK_RECORDED = 'child.work_recorded';

/** Read proof from completed direct children of this execution and ticket in one scoped query. */
export async function readChildWork(
  db: Db, tenantId: number, parentExecutionId: number, taskId: number,
): Promise<WorkEvidence[]> {
  const rows = await db.selectDistinct({ id: executions.id, payload: executions.payload })
    .from(executions)
    .innerJoin(toolAuditEvents, and(
      eq(toolAuditEvents.tenantId, executions.tenantId),
      eq(toolAuditEvents.executionId, executions.id),
      eq(toolAuditEvents.toolName, CHILD_WORK_RECORDED),
      isNull(toolAuditEvents.agentHostId),
      eq(toolAuditEvents.category, 'run'),
    ))
    .where(scopedToTenant(executions, tenantId, eq(executions.parentExecutionId, parentExecutionId),
      eq(executions.taskId, taskId), eq(executions.status, 'completed')))
    .orderBy(executions.id)
    .limit(MAX_CHILD_ROWS);
  const id = String(taskId);
  const handles = rows.flatMap((row) => {
    const spec = parseCloudChild(row.payload);
    return spec?.parentExecutionId === parentExecutionId
      && Array.isArray(spec.workItemIds) && spec.workItemIds.includes(id) ? [childHandle(row.id)] : [];
  });
  return handles.length ? [{ id, status: 'in_review', detail: `Delegated changes recorded by ${handles.join(', ')}` }] : [];
}

/** The task is already scoped by the host. A child only inherits an admission-stamped reference. */
export function cloudAssignedWork({ taskRow, opts }: Pick<CloudRunHost, 'taskRow' | 'opts'>): AssignedWork | undefined {
  const id = String(taskRow.id);
  const child = opts.delegation?.spec;
  if (child) {
    if (!Array.isArray(child.workItemIds) || !child.workItemIds.includes(id)) return undefined;
    return { id, criteria: [child.task] };
  }
  if (opts.suppressFinalize || !asksForChange([taskRow.title, taskRow.description].filter(Boolean).join('\n'))) return undefined;
  return { id, criteria: [taskRow.title] };
}
