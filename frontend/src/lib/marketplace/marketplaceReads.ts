/**
 * The marketplace page's reads, served through the browser's read-through cache.
 *
 * Mounting the page fired four uncached round-trips (listings, owned hosts,
 * installed artifacts, purchased agents) plus one per stats bucket — on every
 * visit, every tab switch back, every category change that remounted it. These
 * are slow-changing reads whose only writers are on this same page, so the page
 * owns the keys AND the invalidation: every mutation below drops exactly the
 * entries it changed, and nothing else has to remember.
 */
import { invalidateClientCache, getOrSetClientCached } from '@/infrastructure/http/readThrough';
import {
  agentHosts,
  artifactAssignments,
  listMarketplaceSkills,
  marketplaceStats,
  type ArtifactStats,
  type ArtifactType,
} from '@/lib/builderforceApi';
import { listAgents, listPurchasedAgents } from '@/lib/api';
import type { PublishedAgent } from '@/lib/types';

const TTL_MS = 5 * 60_000;
const KEY = {
  skills: 'marketplace:skills',
  hosts: 'marketplace:agent-hosts',
  installed: (tenantId: number) => `marketplace:installed:${tenantId}`,
  stats: (type: ArtifactType, slugs: string[]) => `marketplace:stats:${type}:${[...slugs].sort().join(',')}`,
  agents: 'marketplace:agents',
  purchased: 'marketplace:purchased',
};

export const marketplaceReads = {
  skills: (limit = 100) =>
    getOrSetClientCached(KEY.skills, () => listMarketplaceSkills({ limit }), { ttlMs: TTL_MS, staleWhileRevalidate: true }),
  hasAgentHosts: () =>
    getOrSetClientCached(KEY.hosts, () => agentHosts.list().then((list) => list.length > 0), { ttlMs: TTL_MS }),
  installedArtifacts: (tenantId: number) =>
    getOrSetClientCached(KEY.installed(tenantId), () => artifactAssignments.list('tenant', tenantId), { ttlMs: TTL_MS }),
  stats: (type: ArtifactType, slugs: string[]): Promise<Record<string, ArtifactStats>> =>
    slugs.length === 0
      ? Promise.resolve({})
      : getOrSetClientCached(KEY.stats(type, slugs), () => marketplaceStats.getStats(type, slugs), { ttlMs: TTL_MS, staleWhileRevalidate: true }),
  publishedAgents: (): Promise<PublishedAgent[]> =>
    getOrSetClientCached(KEY.agents, () => listAgents(), { ttlMs: TTL_MS, staleWhileRevalidate: true }),
  purchasedAgents: () =>
    getOrSetClientCached(KEY.purchased, () => listPurchasedAgents(), { ttlMs: TTL_MS }),
};

/** After an install / uninstall of a skill or persona. */
export function invalidateInstalledArtifacts(tenantId: number): void {
  invalidateClientCache(KEY.installed(tenantId));
}

/** After a hire, unhire, publish, unpublish or delete of an agent listing. */
export function invalidateMarketplaceAgents(): void {
  invalidateClientCache(KEY.agents);
  invalidateClientCache(KEY.purchased);
}

/** After a like / unlike — the stats bucket for that type is re-read. */
export function invalidateMarketplaceStats(type: ArtifactType): void {
  invalidateClientCache(`marketplace:stats:${type}:`);
}

/** After a skill is published from this page. */
export function invalidateMarketplaceSkills(): void {
  invalidateClientCache(KEY.skills);
  invalidateClientCache('marketplace:stats:skill:');
}
