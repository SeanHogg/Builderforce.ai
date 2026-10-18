import { getOrSetClientCached } from '@/infrastructure/http/readThrough';
import { getStoredTenant } from './auth';
import { agentHosts, tasksApi, type AgentHost, type Task } from './builderforceApi';

/**
 * Dashboard reads keyed by ENDPOINT, not by the widget asking. Each widget keeps
 * its own shared-source key (core:overview, wf:agents, op:tasks), so without this
 * the same GET went out once per key on every dashboard load. A short TTL lets
 * the mounts that land in the same tick coalesce without serving stale data after
 * the user mutates something.
 */
const DASHBOARD_READ_TTL_MS = 5_000;

/** Tenant-scoped: a switch must never serve the previous workspace's rows. */
const tenantKey = (base: string): string => `${base}:${getStoredTenant()?.id ?? 'none'}`;

export const readAgentHosts = (): Promise<AgentHost[]> =>
  getOrSetClientCached(tenantKey('agent-hosts:list'), () => agentHosts.list(), { ttlMs: DASHBOARD_READ_TTL_MS });

/** Unscoped task list; scoped lists are not dashboard reads. */
export const readTasks = (): Promise<Task[]> =>
  getOrSetClientCached(tenantKey('tasks:list:all'), () => tasksApi.list(), { ttlMs: DASHBOARD_READ_TTL_MS });
