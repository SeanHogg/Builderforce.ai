import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { executions, tasks } from '../../infrastructure/database/schema';
import { liveExecution } from '../rehearsal/executionMode';

/**
 * The board's agent-history chips: for each task, every distinct agent that has run
 * (or is queued) on it, carrying that agent's LATEST run status — a completed prior
 * agent stays visible beside a freshly queued one.
 *
 * The board used to read the tenant's 200 newest FULL execution rows (payload and
 * result text included) and fold them in the browser. This reads only the seven
 * columns a chip needs, scoped to the board's project, and ships only the newest
 * row per (task, agent) — the same fold, done before the response instead of after.
 * The window is the project's {@link TASK_RUNS_WINDOW} newest runs (the old read
 * saw 200 across the whole tenant).
 */
export const TASK_RUNS_WINDOW = 300;

export type TaskRun = {
  id: number;
  taskId: number;
  status: string;
  agentHostId: number | null;
  agentId: number | null;
  cloudAgentRef: string | null;
  createdAt: Date | string;
};

/** The chip identity of the agent that ran a row — the board's `execAgentKey`. */
export function taskRunAgentKey(run: Pick<TaskRun, 'cloudAgentRef' | 'agentHostId' | 'agentId'>): string {
  if (run.cloudAgentRef) return `c:${run.cloudAgentRef}`;
  if (run.agentHostId != null) return `h:${run.agentHostId}`;
  if (run.agentId != null) return `a:${run.agentId}`;
  return 'agent';
}

/** Keep the first (newest) row per (task, agent) from a newest-first list. Pure. */
export function latestRunPerTaskAgent(newestFirst: readonly TaskRun[]): TaskRun[] {
  const seen = new Set<string>();
  const out: TaskRun[] = [];
  for (const run of newestFirst) {
    const key = `${run.taskId}|${taskRunAgentKey(run)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(run);
  }
  return out;
}

/** `projectId` null ⇒ tenant-wide (a board showing every project). */
export async function loadTaskRuns(db: Db, tenantId: number, projectId: number | null): Promise<TaskRun[]> {
  const columns = {
    id: executions.id,
    taskId: executions.taskId,
    status: executions.status,
    agentHostId: executions.agentHostId,
    agentId: executions.agentId,
    cloudAgentRef: executions.cloudAgentRef,
    createdAt: executions.createdAt,
  };
  const base = and(eq(executions.tenantId, tenantId), liveExecution());
  const rows = projectId == null
    ? await db.select(columns).from(executions).where(base)
      .orderBy(desc(executions.createdAt)).limit(TASK_RUNS_WINDOW)
    : await db.select(columns).from(executions)
      .innerJoin(tasks, eq(tasks.id, executions.taskId))
      .where(and(base, eq(tasks.projectId, projectId)))
      .orderBy(desc(executions.createdAt)).limit(TASK_RUNS_WINDOW);
  return latestRunPerTaskAgent(rows);
}
