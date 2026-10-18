/**
 * THE agent-host list — one read behind every "which hosts does this tenant have"
 * surface.
 *
 * Four routes answered it: `GET /api/agent-hosts` (via the repository),
 * `GET /api/agent-hosts/fleet` (host-key peer discovery, same repository call),
 * `GET /api/tenants/:id/agentHosts` and `GET /api/projects/:id/agentHosts` — the
 * last two each with a hand-written select of their own, so the tenant one parsed
 * capabilities and joined project links while the project one did neither, and an
 * `offline` filter existed on one path only. They now all come from
 * {@link listAgentHostDirectory}: hosts from the repository, project links from one
 * grouped query, filtered by status and/or project.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentHostProjects, agentHosts } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { AgentHostRepository } from '../../infrastructure/repositories/AgentHostRepository';
import { isAgentHostOnline } from '../../domain/agentHost/onlineStatus';
import { getOrSetCached, invalidateCached, type CacheEnv } from '../../infrastructure/cache/readThroughCache';
import { AgentHostService, type AgentHostFilterStatus } from './AgentHostService';

export interface AgentHostDirectoryFilter {
  tenantId: number;
  /** `online` / `offline` by the canonical liveness rule; anything else = all. */
  status?: string | null;
  /** Only hosts linked to this project. */
  projectId?: number | null;
  /** When present the tenant's host list is read through the cache (the dashboard
   *  polls it every 30 s). Writers call {@link invalidateAgentHostDirectory}. */
  env?: CacheEnv;
}

/** Bounds the staleness of writers that cannot invalidate (heartbeat liveness is
 *  written by the throttled beat and invalidated there; project-link edits in other
 *  routes are not). KV's minimum TTL is 60 s. */
const DIRECTORY_TTL_SECONDS = 60;
const DIRECTORY_L1_TTL_MS = 30_000;
const directoryKey = (tenantId: number): string => `agent-hosts:dir:${tenantId}`;

/** Drop the tenant's cached host list — call on register / update / delete / status
 *  change / project link / connect / capability change. */
export function invalidateAgentHostDirectory(env: CacheEnv, tenantId: number): Promise<void> {
  return invalidateCached(env, directoryKey(tenantId));
}

export interface AgentHostDirectoryEntry {
  id: number;
  name: string;
  slug: string;
  status: string;
  online: boolean;
  connectedAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  capabilities: string[];
  declaredCapabilities: string[];
  projectIds: number[];
  capabilitySummary: { distributed: boolean; remoteDispatch: boolean; projectCount: number };
}

const normalizeStatus = (raw: string | null | undefined): AgentHostFilterStatus => {
  const s = (raw ?? '').trim().toLowerCase();
  return s === 'online' || s === 'offline' ? s : null;
};

/** Every host this tenant owns, with its project links, optionally filtered. */
export async function listAgentHostDirectory(
  db: Db,
  filter: AgentHostDirectoryFilter,
  service: AgentHostService = new AgentHostService(new AgentHostRepository(db)),
): Promise<AgentHostDirectoryEntry[]> {
  const { tenantId } = filter;
  const status = normalizeStatus(filter.status);
  if (!filter.env) return applyFilter(await loadEntries(db, tenantId, service, status), filter);

  // Cache the UNFILTERED tenant list and filter in JS, so one entry (one invalidation)
  // serves every status / project variant. Dates come back from KV as ISO strings,
  // which is exactly what the JSON response would have serialized them to.
  const all = await getOrSetCached(
    filter.env,
    directoryKey(tenantId),
    () => loadEntries(db, tenantId, service, null),
    { kvTtlSeconds: DIRECTORY_TTL_SECONDS, l1TtlMs: DIRECTORY_L1_TTL_MS },
  );
  const byStatus = status === 'online' ? all.filter((e) => e.online)
    : status === 'offline' ? all.filter((e) => !e.online)
    : all;
  return applyFilter(byStatus, filter);
}

const applyFilter = (entries: AgentHostDirectoryEntry[], filter: AgentHostDirectoryFilter): AgentHostDirectoryEntry[] =>
  filter.projectId != null ? entries.filter((e) => e.projectIds.includes(filter.projectId!)) : entries;

async function loadEntries(
  db: Db,
  tenantId: number,
  service: AgentHostService,
  status: AgentHostFilterStatus,
): Promise<AgentHostDirectoryEntry[]> {
  const hosts = await service.listAgentHostsForTenant(tenantId, status);
  const links = await projectLinksByHost(db, tenantId, hosts.map((h) => h.id));

  return hosts.map((h): AgentHostDirectoryEntry => {
    const projectIds = links.get(h.id) ?? [];
    const capabilities = h.capabilities ?? [];
    const online = isAgentHostOnline(h);
    return {
      id: h.id,
      name: h.name,
      slug: h.slug,
      status: h.status,
      online,
      connectedAt: h.connectedAt,
      lastSeenAt: h.lastSeenAt,
      createdAt: h.createdAt,
      capabilities,
      declaredCapabilities: h.declaredCapabilities ?? [],
      projectIds,
      capabilitySummary: {
        distributed: online && projectIds.length > 1,
        remoteDispatch: online && capabilities.includes('remote-dispatch'),
        projectCount: projectIds.length,
      },
    };
  });
}

/** Every host's project links in ONE query, grouped in JS (no per-host round-trip). */
async function projectLinksByHost(db: Db, tenantId: number, hostIds: number[]): Promise<Map<number, number[]>> {
  const byHost = new Map<number, number[]>();
  if (hostIds.length === 0) return byHost;
  const rows = await db
    .select({ agentHostId: agentHostProjects.agentHostId, projectId: agentHostProjects.projectId })
    .from(agentHostProjects)
    .where(scopedToTenant(agentHostProjects, tenantId, inArray(agentHostProjects.agentHostId, hostIds)));
  for (const { agentHostId, projectId } of rows) {
    const list = byHost.get(agentHostId) ?? [];
    list.push(projectId);
    byHost.set(agentHostId, list);
  }
  return byHost;
}

/** Does this host belong to the tenant? The ownership gate in front of host-scoped writes. */
export async function agentHostInTenant(db: Db, tenantId: number, agentHostId: number): Promise<boolean> {
  if (!Number.isSafeInteger(agentHostId) || agentHostId <= 0) return false;
  const [row] = await db
    .select({ id: agentHosts.id })
    .from(agentHosts)
    .where(and(eq(agentHosts.id, agentHostId), eq(agentHosts.tenantId, tenantId)))
    .limit(1);
  return Boolean(row);
}
