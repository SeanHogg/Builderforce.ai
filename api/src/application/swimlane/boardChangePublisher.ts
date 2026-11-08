/**
 * Publish the project's `{type:'changed'}` live-room event for STAFFING and OWNERSHIP
 * writes.
 *
 * The board refetches its config (agent chips, scope) on that event. REST task routes
 * already publish; the staffing writers (lane assignments, project assignments) and the
 * non-REST ticket-owner writers (manager, built-in MCP) did not, so a chip was stale
 * until reload whenever the change came from anywhere but a task route. Every such writer
 * calls THIS, so there is one place that resolves "which project's room".
 *
 * Best-effort: a relay miss never fails the write that triggered it.
 */
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { boards, projects, swimlanes } from '../../infrastructure/database/schema';
import { broadcastProjectChanged } from '../../infrastructure/relay/broadcastRoom';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Env } from '../../env';
import { invalidateLaneRouting } from './laneRouting';

type RelayEnv = Parameters<typeof broadcastProjectChanged>[0];

/** Publish one project's change event; never throws. */
export async function publishProjectStaffingChanged(
  env: RelayEnv,
  tenantId: number,
  projectId: number | string | null | undefined,
): Promise<void> {
  try {
    await broadcastProjectChanged(env, tenantId, projectId);
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/swimlane/boardChangePublisher.ts',
      operation: 'publishProjectStaffingChanged',
      context: { details: { tenantId, projectId } },
    });
  }
}

/** Publish for a project known only by id (resolves its tenant; never throws). */
export async function publishProjectStaffingChangedById(env: RelayEnv, db: Db, projectId: number): Promise<void> {
  if (!env) return;
  try {
    const [row] = await db.select({ tenantId: projects.tenantId }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (row) await publishProjectStaffingChanged(env, row.tenantId, projectId);
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/swimlane/boardChangePublisher.ts',
      operation: 'publishProjectStaffingChangedById',
      context: { details: { projectId } },
    });
  }
}

/** Publish for every project that owns one of `swimlaneIds` (one batched lookup). */
export async function publishLaneStaffingChanged(
  env: RelayEnv,
  db: Db,
  tenantId: number,
  swimlaneIds: readonly string[],
): Promise<void> {
  if (!env || swimlaneIds.length === 0) return;
  try {
    const rows = await db
      .selectDistinct({ projectId: boards.projectId })
      .from(swimlanes)
      .innerJoin(boards, eq(swimlanes.boardId, boards.id))
      .where(scopedToTenant(swimlanes, tenantId, inArray(swimlanes.id, [...swimlaneIds])));
    await Promise.all(rows.flatMap((r) => [
      publishProjectStaffingChanged(env, tenantId, r.projectId),
      // Lane staffing changed, so the lane router's cached per-lane runtimes are stale (laneRouting.ts).
      invalidateLaneRouting(env as Env, tenantId, Number(r.projectId)),
    ]));
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/swimlane/boardChangePublisher.ts',
      operation: 'publishLaneStaffingChanged',
      context: { details: { tenantId } },
    });
  }
}
