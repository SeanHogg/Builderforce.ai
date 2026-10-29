/**
 * Which "Fix it" coding runs are still going (PRD 33 §5.1.4).
 *
 * A fix is `applied` the moment its ticket and run are created, but the agent has not
 * finished editing the app's workspace yet — building a preview then would publish the
 * unchanged app. `buildPreview` waits on this answer. ONE read for a whole list of rows
 * (no per-row query); a fix with no run (ticket mode, dispatcher refusal) has no
 * execution row and so is never "running".
 *
 * The answer is a live fact: a run ends without bumping the site version the prescription
 * reads are cached under, so it is settled AFTER the cache (`holdBuildPreviewWhileRunning`).
 */

import { and, inArray, notInArray, type SQL } from 'drizzle-orm';
import type { ReplayPrescriptionDto } from '@builderforce/interaction-contract';
import type { Db } from '../../infrastructure/database/connection';
import { executions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { EXECUTION_TERMINAL_STATUSES } from '../../domain/shared/terminalStatus';

/** The runs of these tickets, in this workspace, that have not finished. */
export function unfinishedRunsOf(tenantId: number, taskIds: readonly number[]): SQL {
  return scopedToTenant(
    executions,
    tenantId,
    and(inArray(executions.taskId, [...taskIds]), notInArray(executions.status, [...EXECUTION_TERMINAL_STATUSES])),
  );
}

/** Of these tickets, the ones with a run that has not finished: ONE tenant-scoped query, none for no tickets. */
async function runningAmong(db: Db, tenantId: number, taskIds: readonly number[]): Promise<ReadonlySet<number>> {
  if (taskIds.length === 0) return new Set();
  const running = await db
    .selectDistinct({ taskId: executions.taskId })
    .from(executions)
    .where(unfinishedRunsOf(tenantId, taskIds));
  return new Set(running.map((r) => r.taskId));
}

/**
 * Withdraw `buildPreview` from the fixes whose coding run is still going. A non-null
 * `buildPreview` already means an applied fix, so the tickets come straight from the DTOs'
 * own `refs.taskId`. Returns copies (the input may be a cached value); one query, skipped
 * when no DTO offers a preview.
 */
export async function holdBuildPreviewWhileRunning(
  db: Db,
  tenantId: number,
  dtos: readonly ReplayPrescriptionDto[],
): Promise<ReplayPrescriptionDto[]> {
  const taskIds = new Set<number>();
  for (const dto of dtos) if (dto.buildPreview && dto.refs.taskId !== null) taskIds.add(dto.refs.taskId);
  const running = await runningAmong(db, tenantId, [...taskIds]);
  return dtos.map((dto) => (dto.buildPreview && dto.refs.taskId !== null && running.has(dto.refs.taskId) ? { ...dto, buildPreview: null } : dto));
}
