/**
 * Which "Fix it" coding runs are still going (PRD 33 §5.1.4).
 *
 * A fix is `applied` the moment its ticket and run are created, but the agent has not
 * finished editing the app's workspace yet — building a preview then would publish the
 * unchanged app. `buildPreview` waits on this answer. ONE read for a whole list of rows
 * (no per-row query); a fix with no run (ticket mode, dispatcher refusal) has no
 * execution row and so is never "running".
 */

import { and, inArray, notInArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { executions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { EXECUTION_TERMINAL_STATUSES } from '../../domain/shared/terminalStatus';
import { decodeActionRef } from '../../domain/replay/prescriptions/prescriptionState';
import type { PrescriptionRow } from './prescriptionReads';

/** The ticket ids, among these rows' applied fixes, that still have a non-finished run. */
export async function runningFixTaskIds(
  db: Db,
  tenantId: number,
  rows: readonly Pick<PrescriptionRow, 'status' | 'actionKind' | 'actionRef'>[],
): Promise<ReadonlySet<number>> {
  const taskIds = new Set<number>();
  for (const row of rows) {
    if (row.status !== 'applied' || row.actionKind !== 'fix') continue;
    const taskId = decodeActionRef(row.actionRef).taskId;
    if (taskId !== null) taskIds.add(taskId);
  }
  if (taskIds.size === 0) return taskIds;
  const running = await db
    .selectDistinct({ taskId: executions.taskId })
    .from(executions)
    .where(scopedToTenant(
      executions,
      tenantId,
      and(inArray(executions.taskId, [...taskIds]), notInArray(executions.status, [...EXECUTION_TERMINAL_STATUSES])),
    ));
  return new Set(running.map((r) => r.taskId));
}
