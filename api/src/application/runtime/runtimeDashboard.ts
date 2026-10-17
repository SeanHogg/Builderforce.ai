import { inArray } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { executionStateVersion } from './executionStateVersion';

/**
 * The tenant runtime dashboard (`GET /api/runtime/dashboard`) — status totals and
 * a per-agent-host breakdown over the tenant's most recent executions.
 *
 * It samples up to 2,000 execution rows and aggregates them, which is the most
 * expensive read on the runtime surface, and it used to do that on every load.
 * It is now cached behind the SAME execution-state version token as the tenant
 * executions list and the active-runs board (`executionStateVersion.ts`): every
 * status change orphans it, and repeated loads between changes never reach Neon.
 * The KV TTL bounds a status change the lifecycle outbox has not drained yet, and
 * an agent-host rename (which does not bump the token).
 */
const DASHBOARD_CACHE = { kvTtlSeconds: 60, l1TtlMs: 3_000 };

/** The slice of `Execution.toPlain()` the aggregation reads. */
export interface DashboardExecution {
  status: string;
  agentHostId: number | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  createdAt: Date | string;
}

interface AgentHostStats {
  agentHostId: number;
  totalExecutions: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
  cancelled: number;
  lastExecutionAt: string | null;
}

export interface RuntimeDashboard {
  tenantId: number;
  window: { sampledExecutions: number; limit: number };
  totals: {
    totalExecutions: number;
    pending: number;
    submitted: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    successRate: number;
    avgDurationMs: number;
  };
  byAgentHost: Array<AgentHostStats & { name: string; successRate: number }>;
}

/** Pure aggregation over a sample of executions. Host names are resolved by the caller. */
export function aggregateRuntimeDashboard(executions: readonly DashboardExecution[]) {
  const totals: RuntimeDashboard['totals'] = {
    totalExecutions: executions.length,
    pending: 0,
    submitted: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    successRate: 0,
    avgDurationMs: 0,
  };
  let durationSamples = 0;
  let durationTotalMs = 0;
  const agentHostStats = new Map<number, AgentHostStats>();

  for (const execution of executions) {
    switch (execution.status) {
      case 'pending': totals.pending += 1; break;
      case 'submitted': totals.submitted += 1; break;
      case 'running': totals.running += 1; break;
      case 'completed': totals.completed += 1; break;
      case 'failed': totals.failed += 1; break;
      case 'cancelled': totals.cancelled += 1; break;
    }

    if (execution.startedAt && execution.completedAt) {
      durationSamples += 1;
      durationTotalMs += new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime();
    }

    if (execution.agentHostId != null) {
      const current = agentHostStats.get(execution.agentHostId) ?? {
        agentHostId: execution.agentHostId,
        totalExecutions: 0,
        completed: 0,
        failed: 0,
        running: 0,
        pending: 0,
        cancelled: 0,
        lastExecutionAt: null,
      };
      current.totalExecutions += 1;
      if (execution.status === 'completed') current.completed += 1;
      if (execution.status === 'failed') current.failed += 1;
      if (execution.status === 'running') current.running += 1;
      if (execution.status === 'pending' || execution.status === 'submitted') current.pending += 1;
      if (execution.status === 'cancelled') current.cancelled += 1;
      const createdAtIso = new Date(execution.createdAt).toISOString();
      if (!current.lastExecutionAt || createdAtIso > current.lastExecutionAt) current.lastExecutionAt = createdAtIso;
      agentHostStats.set(execution.agentHostId, current);
    }
  }

  const terminalCount = totals.completed + totals.failed + totals.cancelled;
  totals.successRate = terminalCount > 0 ? totals.completed / terminalCount : 0;
  totals.avgDurationMs = durationSamples > 0 ? Math.round(durationTotalMs / durationSamples) : 0;
  return { totals, agentHostStats };
}

/** Attach host names and per-host success rates; busiest host first. */
export function rankAgentHosts(
  agentHostStats: ReadonlyMap<number, AgentHostStats>,
  names: ReadonlyMap<number, string>,
): RuntimeDashboard['byAgentHost'] {
  return Array.from(agentHostStats.values())
    .map((entry) => {
      const terminal = entry.completed + entry.failed + entry.cancelled;
      return {
        ...entry,
        name: names.get(entry.agentHostId) ?? `AgentHost ${entry.agentHostId}`,
        successRate: terminal > 0 ? entry.completed / terminal : 0,
      };
    })
    .sort((left, right) => right.totalExecutions - left.totalExecutions);
}

async function loadRuntimeDashboard(
  db: Db,
  listExecutions: () => Promise<DashboardExecution[]>,
  tenantId: number,
  limit: number,
): Promise<RuntimeDashboard> {
  const sample = await listExecutions();
  const { totals, agentHostStats } = aggregateRuntimeDashboard(sample);
  const agentHostIds = Array.from(agentHostStats.keys());
  const names = new Map<number, string>();
  if (agentHostIds.length > 0) {
    const hostRows = await db
      .select({ id: agentHosts.id, name: agentHosts.name })
      .from(agentHosts)
      .where(scopedToTenant(agentHosts, tenantId, inArray(agentHosts.id, agentHostIds)));
    hostRows.forEach((host) => names.set(host.id, host.name));
  }
  return {
    tenantId,
    window: { sampledExecutions: sample.length, limit },
    totals,
    byAgentHost: rankAgentHosts(agentHostStats, names),
  };
}

/**
 * The dashboard for `tenantId` over its `limit` most recent executions, cached per
 * (tenant, limit) behind the execution-state version. `listExecutions` is the
 * caller's tenant-scoped execution read (the route passes `RuntimeService.listByTenant`),
 * so the sample is exactly what it was before caching. Without an `env` it reads live.
 */
export async function readRuntimeDashboard(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  limit: number,
  listExecutions: () => Promise<DashboardExecution[]>,
): Promise<RuntimeDashboard> {
  const load = () => loadRuntimeDashboard(db, listExecutions, tenantId, limit);
  if (!env) return load();
  const version = await executionStateVersion(env, tenantId);
  return getOrSetCached(env, `runtime-dashboard:v:${version}:${tenantId}:${limit}`, load, DASHBOARD_CACHE);
}
