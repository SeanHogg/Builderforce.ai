/**
 * The team feed — the `/api/teams/memory` READ over the converged memory store.
 *
 * `team_memory` was folded into `agent_memory` by migration 0442 (every row became
 * a tenant-scoped fact keyed `team:<agentHostId>:<runId>`) and dropped by 1131.
 * Writes go through `memoryService.remember`, which bumps the tenant's memory
 * version token; this read keys on the SAME token (via `scopeCacheToken`), so a
 * pushed summary is visible on the next GET rather than after a TTL — and there
 * is exactly one token for the store, not one per reader.
 *
 * The projection is the published `TeamMemoryEntry` contract (`openapi/schema.ts`),
 * which the agent-runtime's `pullTeamMemory` consumes — so the shape is typed here,
 * once, rather than hand-rolled in the route.
 */

import { and, desc, eq, like } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { agentMemory } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { visibleScopeChain } from '../../domain/memory/memoryScope';
import { parseJsonArray } from '../../domain/shared/json';
import type { TeamMemoryEntry } from '../../openapi/schema';
import { scopeCacheToken } from './memoryService';

const TEAM_KEY_PREFIX = 'team:';
const TEAM_FEED_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

/** Split `team:<agentHostId>:<runId>` back into its parts (a runId may itself contain ':'). */
export function parseTeamMemoryKey(key: string): { agentHostId: string; runId: string } {
  const [, agentHostId = '', ...run] = key.split(':');
  return { agentHostId, runId: run.join(':') };
}

/** The key `remember` stores a pushed summary under. */
export function teamMemoryKey(agentHostId: string, runId: string): string {
  return `${TEAM_KEY_PREFIX}${agentHostId}:${runId}`;
}

/** Newest-first team summaries for a tenant, served through the read-through cache. */
export async function listTeamMemoryEntries(env: Env, db: Db, tenantId: number, limit: number): Promise<TeamMemoryEntry[]> {
  const ctx = { tenantId };
  const token = await scopeCacheToken(env, ctx, visibleScopeChain(ctx));
  return getOrSetCached(
    env,
    `mem:teamfeed:${tenantId}:${token}:${limit}`,
    async () => {
      const rows = await db
        .select({ id: agentMemory.id, key: agentMemory.key, content: agentMemory.content, tags: agentMemory.tags, createdAt: agentMemory.createdAt })
        .from(agentMemory)
        .where(and(eq(agentMemory.tenantId, tenantId), like(agentMemory.key, `${TEAM_KEY_PREFIX}%`)))
        .orderBy(desc(agentMemory.createdAt))
        .limit(limit);
      return rows.map((r): TeamMemoryEntry => {
        const createdAt = r.createdAt.toISOString();
        return { id: r.id, ...parseTeamMemoryKey(r.key), summary: r.content, tags: parseJsonArray<string>(r.tags), timestamp: createdAt, createdAt };
      });
    },
    TEAM_FEED_TTL,
  );
}
