/**
 * Read-through cache for `GET /api/agent-hosts/:id/cron`.
 *
 * Every host polls its schedule every few minutes, and the answer almost never
 * changes — an uncached `SELECT * FROM cron_jobs` per poll keeps the core Neon compute
 * awake for nothing. The list is keyed per (tenant, host, filters) and folded under a
 * per-host VERSION token, so ONE bump on any write orphans every filter variant
 * without enumerating them.
 *
 * Writers that go through the host cron routes call {@link invalidateHostCronJobs}.
 * `cron.*` MCP tools (builtinMcpService) also write `cron_jobs` and do not — those
 * changes reach the poller within {@link HOST_CRON_TTL_SECONDS}.
 */
import type { Env } from '../../env';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';

/** Bounds the lag for writers that cannot bump the token. */
export const HOST_CRON_TTL_SECONDS = 120;

const versionKey = (agentHostId: number): string => `host-cron:${agentHostId}`;

export interface HostCronFilter {
  tenantId: number;
  agentHostId: number;
  projectId?: string | null;
  /** A numeric id, `'none'` (project-wide only) or absent (no agent filter). */
  projectAgentId?: string | null;
}

export async function cachedHostCronJobs<T>(
  env: Env,
  filter: HostCronFilter,
  load: () => Promise<T>,
): Promise<T> {
  const version = await getCacheVersion(env, versionKey(filter.agentHostId));
  const key = `host-cron:${filter.tenantId}:${filter.agentHostId}:${version}:${filter.projectId ?? '-'}:${filter.projectAgentId ?? '-'}`;
  return getOrSetCached(env, key, load, { kvTtlSeconds: HOST_CRON_TTL_SECONDS, l1TtlMs: 30_000 });
}

/** Call after any create / update / delete of a host's cron job. */
export function invalidateHostCronJobs(env: Env, agentHostId: number): Promise<void> {
  return bumpCacheVersion(env, versionKey(agentHostId));
}
