import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, executions, ideAgents, projects, tasks } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { liveExecution } from '../rehearsal/executionMode';
import { DEFAULT_CLOUD_REF } from './cloudAgentEngine';
import { executionStateVersion } from './executionStateVersion';
import { loadRunActivity, MAX_ACTIVITY_DAYS } from './runActivity';
import { loadTaskRuns, type TaskRun } from './taskRunChips';

/**
 * The ONE live-runs read — `GET /api/runtime/active` — every web panel that shows
 * what the fleet is doing reads it: the active-runs panel, the dashboard's
 * workforce presence and the board's run chips.
 *
 * The core is the fleet's "what is running right now": every non-terminal
 * execution for the tenant (pending / submitted / running), with its task,
 * project, the executing agent (host or cloud ref) and how long it has been going,
 * narrowed to the columns those panels draw and capped small. Two opt-in
 * projections ride the same request so a panel never needs a second list read:
 *
 *   • `activityDays` — runs started per day over the trailing window (the
 *     workforce sparkline), a `GROUP BY` instead of a 200-row execution list;
 *   • `taskRuns` — the latest run per (task, agent) for one project (the board's
 *     agent-history chips), slim columns instead of 200 full execution rows.
 *
 * Every part is cached per tenant behind the execution-state version token
 * (`executionStateVersion.ts`): any status change orphans it, and every poller in
 * the tenant shares one read until then. The token is also the response's
 * `version`; a poller that sends it back as `since` gets `{ version, unchanged }`
 * and nothing else while no run has moved — one KV/L1 read, no Neon, no payload.
 * `elapsedMs` is derived from the clock at read time, never cached.
 */
// The key embeds the version token, so a status change orphans it; the TTL only bounds orphans.
const LIVE_RUNS_CACHE = { kvTtlSeconds: 600, l1TtlMs: 3_000 };

/** The default and ceiling for the active list — a panel shows a handful of rows. */
export const ACTIVE_RUNS_DEFAULT_LIMIT = 50;
export const ACTIVE_RUNS_MAX_LIMIT = 200;

export interface LiveRunsQuery {
  limit: number;
  /** The `version` of the caller's last read; equal ⇒ `unchanged`. */
  since?: string;
  /** 1–{@link MAX_ACTIVITY_DAYS}: include the per-day run counts. */
  activityDays?: number;
  /** Minutes to ADD to UTC for the caller's local day (`-Date#getTimezoneOffset()`). */
  tzOffsetMinutes?: number;
  /** Include the latest run per (task, agent): a project id, or `'all'` for the tenant. */
  taskRuns?: number | 'all';
}

export interface ActiveRunRow {
  id: number;
  status: string;
  taskId: number;
  taskTitle: string;
  projectId: number;
  projectName: string;
  agentHostId: number | null;
  cloudAgentRef: string | null;
  agentName: string | null;
  submittedBy: string;
  startedAt: Date | string | null;
  createdAt: Date | string;
}

export interface LiveRunsResponse {
  version: string;
  unchanged?: true;
  active?: Array<ActiveRunRow & { kind: 'cloud' | 'on-prem'; elapsedMs: number | null }>;
  runningCloudRefs?: string[];
  activity?: number[];
  taskRuns?: TaskRun[];
}

const intOr = (raw: string | undefined, fallback: number | undefined): number | undefined => {
  const n = raw == null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

/** Read the query string into a bounded {@link LiveRunsQuery}. Pure. */
export function parseLiveRunsQuery(get: (key: string) => string | undefined): LiveRunsQuery {
  const limit = Math.min(ACTIVE_RUNS_MAX_LIMIT, Math.max(1, intOr(get('limit'), ACTIVE_RUNS_DEFAULT_LIMIT)!));
  const since = (get('since') ?? '').trim().slice(0, 64) || undefined;
  const days = intOr(get('activityDays'), undefined);
  const activityDays = days != null && days > 0 ? Math.min(MAX_ACTIVITY_DAYS, days) : undefined;
  const tz = intOr(get('tzOffset'), 0)!;
  const tzOffsetMinutes = Math.max(-840, Math.min(840, tz));
  const rawTaskRuns = (get('taskRuns') ?? '').trim();
  const projectId = intOr(rawTaskRuns, undefined);
  const taskRuns = rawTaskRuns === 'all' ? 'all' as const : projectId != null && projectId > 0 ? projectId : undefined;
  return { limit, since, activityDays, tzOffsetMinutes, taskRuns };
}

export async function readActiveRuns(env: Env | undefined, db: Db, tenantId: number, query: LiveRunsQuery): Promise<LiveRunsResponse> {
  const version = env ? await executionStateVersion(env, tenantId) : '';
  if (version && query.since === version) return { version, unchanged: true };

  const cached = <T>(part: string, load: () => Promise<T>): Promise<T> =>
    env ? getOrSetCached(env, `${part}:v:${version}:${tenantId}`, load, LIVE_RUNS_CACHE) : load();

  const [rows, activity, taskRuns] = await Promise.all([
    cached(`active-runs:${query.limit}`, () => loadActiveRuns(db, tenantId, query.limit)),
    query.activityDays
      ? cached(`run-activity:${query.activityDays}:${query.tzOffsetMinutes ?? 0}`,
        () => loadRunActivity(db, tenantId, query.activityDays!, query.tzOffsetMinutes ?? 0))
      : undefined,
    query.taskRuns != null
      ? cached(`task-runs:${query.taskRuns}`, () => loadTaskRuns(db, tenantId, query.taskRuns === 'all' ? null : query.taskRuns!))
      : undefined,
  ]);

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
  return {
    version,
    active,
    runningCloudRefs: [...new Set(active.filter((a) => a.kind === 'cloud').map((a) => a.cloudAgentRef as string))],
    ...(activity ? { activity } : {}),
    ...(taskRuns ? { taskRuns } : {}),
  };
}

function loadActiveRuns(db: Db, tenantId: number, limit: number): Promise<ActiveRunRow[]> {
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
