import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, executions, ideAgents, projects, tasks } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { liveExecution } from '../rehearsal/executionMode';
import { DEFAULT_CLOUD_REF } from './cloudAgentEngine';
import { executionStateVersion } from './executionStateVersion';

/**
 * The fleet's "what is running right now" — every non-terminal execution for the
 * tenant (pending / submitted / running), with its task, project, the executing
 * agent (host or cloud ref) and how long it has been going. The single source the
 * UI uses to mark a cloud agent as actively running.
 *
 * Polled every few seconds by every open board, so it is cached per tenant behind
 * the execution-state version token (`executionStateVersion.ts`): any status
 * change orphans it, and every poller in the tenant shares one read until then.
 * L1 is short so an isolate sees a bump within seconds; the KV TTL (60s, Workers'
 * minimum) only bounds a status change the lifecycle outbox has not drained yet.
 * `elapsedMs` is derived from the clock at read time, never cached.
 */
const ACTIVE_RUNS_CACHE = { kvTtlSeconds: 60, l1TtlMs: 3_000 };

export async function readActiveRuns(env: Env | undefined, db: Db, tenantId: number, limit: number) {
  const load = () => loadActiveRuns(db, tenantId, limit);
  const rows = env
    ? await getOrSetCached(env, `active-runs:v:${await executionStateVersion(env, tenantId)}:${tenantId}:${limit}`, load, ACTIVE_RUNS_CACHE)
    : await load();

  const now = Date.now();
  const active = rows.map((r) => {
    const isCloud = r.agentHostId == null;
    const since = r.startedAt ?? r.createdAt;
    return {
      ...r,
      kind: isCloud ? ('cloud' as const) : ('on-prem' as const),
      cloudAgentRef: isCloud ? (r.cloudAgentRef ?? DEFAULT_CLOUD_REF) : null,
      elapsedMs: since ? Math.max(0, now - new Date(since).getTime()) : null,
    };
  });
  return { active, runningCloudRefs: [...new Set(active.filter((a) => a.kind === 'cloud').map((a) => a.cloudAgentRef))] };
}

function loadActiveRuns(db: Db, tenantId: number, limit: number) {
  // `liveExecution()` — a rehearsal (0372) drives a real execution row but is a
  // probe rather than fleet activity, so it must not appear on the active-runs board.
  return db
    .select({
      id: executions.id,
      status: executions.status,
      taskId: executions.taskId,
      taskTitle: tasks.title,
      projectId: projects.id,
      projectName: projects.name,
      agentHostId: executions.agentHostId,
      cloudAgentRef: tasks.assignedAgentRef,
      agentName: sql<string | null>`coalesce(${agentHosts.name}, ${ideAgents.name})`,
      submittedBy: executions.submittedBy,
      startedAt: executions.startedAt,
      createdAt: executions.createdAt,
    })
    .from(executions)
    .innerJoin(tasks, eq(tasks.id, executions.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(agentHosts, eq(agentHosts.id, executions.agentHostId))
    .leftJoin(ideAgents, eq(ideAgents.id, tasks.assignedAgentRef))
    .where(and(eq(executions.tenantId, tenantId), inArray(executions.status, ['pending', 'submitted', 'running']), liveExecution()))
    .orderBy(desc(executions.createdAt))
    .limit(limit);
}
