/**
 * Producer for the `workitem.released` outbound webhook (spec 05 §4.3 — the
 * Investor board / Changelog feed).
 *
 * The other two seam events (`sprint.completed`, `roadmap.published`) are emitted
 * by the segment-tracker factory's `emit` hook, but tasks (the backlog/kanban
 * work items) flow through the task-lifecycle path, not the tracker factory — so
 * there was no producer for `workitem.released`. This helper is that producer:
 * called from the task status-transition path when a task FIRST reaches a
 * released/done-class lane, it fans the released work item out to every segment
 * subscription via the shared {@link emitWebhookEvent} pipeline.
 *
 * Segment-gated: a subscription is keyed by `segment_id`, so a work item with no
 * segment (single-mode tenants, who have no integrator webhooks) is a no-op. This
 * keeps the common single-tenant path free of any extra query/emit cost.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tasks } from '../../infrastructure/database/schema';
import { emitWebhookEvent, type EmitDeps } from './webhookService';

export interface ReleaseWorkItemInput {
  tenantId: number;
  taskId: number;
}

/**
 * Emit `workitem.released` for a task that just entered a released/done lane.
 * Best-effort + null-safe: returns the number of endpoints attempted (0 when the
 * task has no segment, is missing, or no subscription matched). Never throws — the
 * caller invokes it fire-and-forget from a metrics path that must not be blocked.
 */
export async function releaseWorkItemWebhook(
  db: Db,
  input: ReleaseWorkItemInput,
  deps: EmitDeps = {},
): Promise<number> {
  const [row] = await db
    .select({
      id: tasks.id,
      key: tasks.key,
      title: tasks.title,
      status: tasks.status,
      projectId: tasks.projectId,
      segmentId: tasks.segmentId,
      priority: tasks.priority,
    })
    .from(tasks)
    // Tasks are tenant-scoped via projectId; the lifecycle caller has already
    // validated ownership, so a by-id lookup is sufficient (and the emit is
    // segment-gated below — a cross-tenant id can't carry a matching segment).
    .where(eq(tasks.id, input.taskId))
    .limit(1);

  // No segment ⇒ a single-mode tenant with no integrator webhook contract.
  if (!row || !row.segmentId) return 0;

  return emitWebhookEvent(
    db,
    {
      tenantId: input.tenantId,
      segmentId: row.segmentId,
      eventType: 'workitem.released',
      eventId: String(row.id),
      data: {
        id: row.id,
        key: row.key,
        title: row.title,
        status: row.status,
        projectId: row.projectId,
        priority: row.priority,
        releasedAt: new Date().toISOString(),
      },
    },
    deps,
  );
}
