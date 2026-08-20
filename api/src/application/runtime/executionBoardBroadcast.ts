import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Concrete board-level fan-out for execution lifecycle events.
 *
 * The per-execution stream ({@link ./executionRelayBroadcast}) only reaches
 * clients holding a single run's socket. This sink additionally pushes a
 * `{type:"changed"}` signal to the run's PROJECT room so every board / kanban /
 * calendar / list (and any open task drawer) refetches as the run advances — the
 * same live channel humans get for their own edits. Wired once per isolate from
 * the composition root via {@link setExecutionEventSinks}.
 *
 * Only status_change/done events broadcast: message/file_change deltas are
 * per-run drawer concerns already carried by the execution stream, and fanning
 * every token delta out to the whole board would be wasteful.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { projects, tasks } from '../../infrastructure/database/schema';
import { broadcastProjectChanged } from '../../infrastructure/relay/broadcastRoom';
import type { ExecutionEventSink, ExecutionSubscriberEvent } from './executionEvents';

/** Per-isolate taskId→{projectId, tenantId} memo so repeated events for a run skip
 *  the lookup. The tenant is needed because the project live room is tenant-scoped
 *  (`project:<tenantId>:<id>`) — publish must match the subscribe side. */
const projectRefByTask = new Map<number, { projectId: number; tenantId: number }>();

function taskIdOf(event: ExecutionSubscriberEvent): number | null {
  if (event.type !== 'status_change' && event.type !== 'done') return null;
  // The event's own `taskId` wins: a publisher that omits the hydrated execution
  // (crash recovery holds raw columns, not an entity) still names its task, and
  // the board must refetch for a run that just died exactly as for one that ended.
  if (typeof event.taskId === 'number') return event.taskId;
  const taskId = (event.execution as { taskId?: unknown } | undefined)?.taskId;
  return typeof taskId === 'number' ? taskId : null;
}

export function makeExecutionBoardSink(env: Env, db: Db): ExecutionEventSink {
  return (event) => {
    const taskId = taskIdOf(event);
    if (taskId == null) return;
    // Fire-and-forget: notifyExecutionSubscribers is synchronous and must not block.
    void (async () => {
      try {
        let ref = projectRefByTask.get(taskId);
        if (ref == null) {
          const [row] = await db
            .select({ projectId: tasks.projectId, tenantId: projects.tenantId })
            .from(tasks)
            .innerJoin(projects, eq(tasks.projectId, projects.id))
            .where(eq(tasks.id, taskId))
            .limit(1);
          if (!row) return;
          ref = { projectId: row.projectId, tenantId: row.tenantId };
          projectRefByTask.set(taskId, ref);
        }
        await broadcastProjectChanged(env, ref.tenantId, ref.projectId);
      } catch (error) {
        reportCaughtError(error, { source: "application/runtime/executionBoardBroadcast.ts", operation: "makeExecutionBoardSink", context: { logMessage: '[execution-board] project change broadcast failed', details: { taskId, error } } });
      }
    })();
  };
}
