/**
 * Cloud (Worker/DO) `memory` capability — the Worker-safe backing for the shared
 * `@builderforce/agent-tools` `memory_recall` / `memory_remember` tools, the durable
 * twin of the on-prem SSM `MemoryStore`. Same tool contract (Dependency Inversion);
 * only the backing differs:
 *   - on-prem (Node)  → SSM MemoryStore, semantic recall (on-device embeddings)
 *   - cloud (Worker)  → Postgres `agent_memory`, lexical recall (ILIKE) — no WebGPU
 *
 * Scoped per tenant. `remember()` upserts on `(tenant_id, key)`. `recall()` is a read,
 * so it is served through the canonical read-through cache (`getOrSetCached`, L1 Map +
 * L2 KV) keyed by a per-tenant VERSION token (the query keyspace is unbounded), and the
 * version is bumped on every write so a recall never serves a stale fact set.
 */

import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { MemoryCapability, MemoryRecallResult, MemoryRememberResult } from '@builderforce/agent-tools';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { agentMemory } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { recallProjectFacts, upsertProjectFact } from '../llm/projectFacts';

const RECALL_DEFAULT = 5;
const RECALL_MAX = 20;
const RECALL_L1_TTL_MS = 30_000;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Significant lowercase words (drop 1-char noise) — each becomes an ILIKE matcher. */
function tokenize(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length > 1))].slice(0, 12);
}

const verKvKey = (tenantId: number): string => `am:ver:${tenantId}`;

/** Per-tenant cache-version token (KV). Absent KV (unit tests / unbound) → 0, which
 *  also makes `getOrSetCached` fall through to the loader, so recall stays correct. */
async function readVersion(env: Env, tenantId: number): Promise<number> {
  const kv = env?.AUTH_CACHE_KV;
  if (!kv) return 0;
  try {
    const raw = await kv.get(verKvKey(tenantId));
    const n = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Invalidate a tenant's cached recalls by bumping the version token. Best-effort. */
async function bumpVersion(env: Env, tenantId: number): Promise<void> {
  const kv = env?.AUTH_CACHE_KV;
  if (!kv) return;
  try {
    const next = (await readVersion(env, tenantId)) + 1;
    await kv.put(verKvKey(tenantId), String(next));
  } catch {
    // A failed bump only risks a brief stale recall (≤ L1 TTL) — never fail the write.
  }
}

/**
 * Build the cloud `memory` capability for one tenant. All errors degrade to
 * `{ ok: false, error }` (never throw) so a missing table (pre-migration) or a transient
 * DB blip reports "unavailable" to the model instead of breaking the run.
 */
export function buildCloudMemoryCapability(args: { db: Db; env: Env; tenantId: number; projectId?: number | null }): MemoryCapability {
  const { db, env, tenantId } = args;
  const projectId = Number.isInteger(args.projectId) && (args.projectId as number) > 0 ? (args.projectId as number) : null;

  // Project-scoped runs back their memory with the SHARED `project_facts` store
  // (the SAME one VS Code + on-prem + web Brain read/write), so a belief the cloud
  // agent forms is recalled by every surface on that project — one project memory.
  // Un-scoped runs keep the tenant-wide `agent_memory` twin below.
  if (projectId) {
    return {
      async remember(key, content): Promise<MemoryRememberResult> {
        try {
          await upsertProjectFact(env, db, tenantId, projectId, key, content, 'cloud');
          return { ok: true, key };
        } catch (e) {
          return { ok: false, error: errMessage(e) };
        }
      },
      async recall(query, limit): Promise<MemoryRecallResult> {
        try {
          const entries = await recallProjectFacts(env, db, tenantId, projectId, { query, ...(limit != null ? { limit } : {}) });
          return { ok: true, query, entries };
        } catch (e) {
          return { ok: false, error: errMessage(e) };
        }
      },
    };
  }

  return {
    async remember(key, content, opts): Promise<MemoryRememberResult> {
      try {
        const tags = JSON.stringify(opts?.tags ?? []);
        const importance = clamp01(opts?.importance ?? 0.5);
        await db
          .insert(agentMemory)
          .values({ tenantId, key, content, tags, importance })
          .onConflictDoUpdate({
            target: [agentMemory.tenantId, agentMemory.key],
            set: { content, tags, importance, updatedAt: new Date() },
          });
        await bumpVersion(env, tenantId);
        return { ok: true, key };
      } catch (e) {
        return { ok: false, error: errMessage(e) };
      }
    },

    async recall(query, limit): Promise<MemoryRecallResult> {
      try {
        const n = Math.min(Math.max(1, Math.trunc(limit ?? RECALL_DEFAULT)), RECALL_MAX);
        const ver = await readVersion(env, tenantId);
        const cacheKey = `am:recall:${tenantId}:${ver}:${n}:${query}`;
        const entries = await getOrSetCached(
          env,
          cacheKey,
          async () => {
            const words = tokenize(query);
            const matchers = words.map((w) => ilike(agentMemory.content, `%${w}%`));
            const where: SQL | undefined =
              matchers.length > 0 ? and(eq(agentMemory.tenantId, tenantId), or(...matchers)) : eq(agentMemory.tenantId, tenantId);
            return db
              .select({ key: agentMemory.key, content: agentMemory.content })
              .from(agentMemory)
              .where(where)
              .orderBy(desc(agentMemory.importance), desc(agentMemory.updatedAt))
              .limit(n);
          },
          { l1TtlMs: RECALL_L1_TTL_MS },
        );
        return { ok: true, query, entries };
      } catch (e) {
        return { ok: false, error: errMessage(e) };
      }
    },
  };
}
