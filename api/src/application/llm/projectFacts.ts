/**
 * projectFacts — the shared, per-PROJECT write-through FACTS store (migration 0276).
 *
 * This is the "knowledge tier" half of Evermind ([[evermind-learning-architecture]]):
 * durable BELIEFS (decisions, conventions, locations, repo/lib versions) that every
 * surface — VS Code, web Brain, cloud agent, on-prem — reads AND writes to the SAME
 * place, so a fact one run learns is recalled by all others on that project. It is the
 * project-scoped twin of the tenant/ticket `agent_memory` store. BOTH are governed by
 * application/memory/memoryService (scope chain, provenance, TTL) — an agent write goes
 * through that service, never directly here, so a fact's visibility and expiry are
 * decided in exactly one place.
 *
 * Write-through per the Evermind law: `upsertProjectFact` replaces by stable key
 * (update == replace, never accumulate). Recall is a read served through the canonical
 * read-through cache, keyed by a per-(tenant,project) VERSION token bumped on every
 * write, so a recall never serves a stale fact set.
 */
import { and, desc, eq, gt, ilike, isNull, ne, or, type SQL } from 'drizzle-orm';
import { projectFacts } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { isExpired } from '../../domain/memory/memoryScope';

const RECALL_DEFAULT = 6;
const RECALL_MAX = 20;

/**
 * `source` marking a row as a memory-first Q&A CACHE entry (a question→answer pair
 * the short-circuit replays to skip the LLM), not a durable belief. These rows live
 * in the SAME table (one builderforce-memory store) but are EXCLUDED from the RAG
 * facts block — a cached answer is retrieved by exact question key, never injected as
 * ambient "knowledge". The single source of this constant is here so recall + the
 * memory module agree. See projectMemory.ts.
 */
export const QA_CACHE_SOURCE = 'qa-cache';

export interface ProjectFact {
  key: string;
  content: string;
  /** Included so a cached row can be revalidated against wall-clock time on every
   * recall; time passing does not bump the cache's version token. */
  expiresAt?: string | null;
}

function versionKey(tenantId: number, projectId: number): string {
  return `project_facts:${tenantId}:${projectId}`;
}

/**
 * This project's fact-store version token, for callers that CACHE over project facts
 * without going through `recallProjectFacts`.
 *
 * Exported because `application/memory/memoryService` caches a recall that UNIONS this
 * store with `agent_memory`, and every write here bumps only the token above. Without
 * folding this token into that key, a fact written by the Brain / VS Code / the MCP
 * tool / `projectFactsRoutes` would be invisible to an agent's `memory_recall` for the
 * whole cache TTL — a stale-read window measured in minutes, on the exact path whose
 * job is "recall what we already know".
 */
export function projectFactsVersion(env: Env, tenantId: number, projectId: number): Promise<string> {
  return getCacheVersion(env, versionKey(tenantId, projectId));
}

/** Significant lowercase words (drop 1-char noise) — each becomes an ILIKE matcher. */
function tokenize(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length > 1))].slice(0, 12);
}

/**
 * Write-through upsert a fact under a stable `key` (replace-on-write). Bumps the
 * recall cache so the next read reflects it. No-op on an invalid project / empty
 * key or content.
 */
export async function upsertProjectFact(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  key: string,
  content: string,
  source = 'agent',
  /** Governance metadata (0371): which run formed the belief, and when it lapses.
   *  Optional so the six existing callers are unchanged; supplied by
   *  application/memory/memoryService, which is the governed write path. */
  opts?: { expiresAt?: Date | null; originExecutionId?: number | null },
): Promise<boolean> {
  const k = (key ?? '').trim().slice(0, 255);
  const c = (content ?? '').trim();
  if (!k || !c || !Number.isInteger(projectId) || projectId <= 0) return false;
  const expiresAt = opts?.expiresAt ?? null;
  const originExecutionId = opts?.originExecutionId ?? null;
  await db
    .insert(projectFacts)
    .values({ tenantId, projectId, key: k, content: c, source: source.slice(0, 64), expiresAt, originExecutionId })
    .onConflictDoUpdate({
      target: [projectFacts.tenantId, projectFacts.projectId, projectFacts.key],
      // A re-write REPLACES the governance metadata too: re-remembering a fact without
      // a TTL makes it durable again, which is the only reading of "update == replace"
      // that does not leave a stale expiry silently attached to fresh content.
      set: { content: c, source: source.slice(0, 64), expiresAt, originExecutionId, updatedAt: new Date() },
    });
  await bumpCacheVersion(env, versionKey(tenantId, projectId));
  return true;
}

/**
 * Delete one project fact by key. The project-scope half of memory_forget; the
 * tenant/ticket half lives in application/memory/memoryService against `agent_memory`.
 */
export async function deleteProjectFact(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  key: string,
): Promise<boolean> {
  const k = (key ?? '').trim().slice(0, 255);
  if (!k || !Number.isInteger(projectId) || projectId <= 0) return false;
  const removed = await db
    .delete(projectFacts)
    .where(and(eq(projectFacts.tenantId, tenantId), eq(projectFacts.projectId, projectId), eq(projectFacts.key, k)))
    .returning({ id: projectFacts.id })
    .catch(() => [] as Array<{ id: string }>);
  if (removed.length > 0) await bumpCacheVersion(env, versionKey(tenantId, projectId));
  return removed.length > 0;
}

/**
 * Purge this project's memory-first Q&A CACHE rows (source {@link QA_CACHE_SOURCE}),
 * leaving durable beliefs untouched. Returns how many were removed.
 *
 * The cache replays a previous answer verbatim on an exact-repeat question, which is
 * precisely what you must be able to clear after the underlying knowledge changes (or
 * after a bad answer got pinned before the coherence gate could reject it). Durable
 * facts are deliberately NOT touched — that is knowledge, not a cached reply.
 */
export async function purgeProjectQaCache(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
): Promise<number> {
  if (!Number.isInteger(projectId) || projectId <= 0) return 0;
  const removed = await db
    .delete(projectFacts)
    .where(and(
      eq(projectFacts.tenantId, tenantId),
      eq(projectFacts.projectId, projectId),
      eq(projectFacts.source, QA_CACHE_SOURCE),
    ))
    .returning({ id: projectFacts.id })
    .catch(() => [] as Array<{ id: string }>);
  if (removed.length > 0) await bumpCacheVersion(env, versionKey(tenantId, projectId));
  return removed.length;
}

/**
 * Recall project facts (read-through cached). With a `query`, ranks by lexical
 * overlap (ILIKE, with a graceful no-match fallback); without one, returns the
 * most important/recent. Degrades to [] on any error (e.g. pre-migration table).
 */
export async function recallProjectFacts(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  opts?: { query?: string; limit?: number },
): Promise<ProjectFact[]> {
  if (!Number.isInteger(projectId) || projectId <= 0) return [];
  const limit = Math.min(Math.max(1, Math.trunc(opts?.limit ?? RECALL_DEFAULT)), RECALL_MAX);
  const query = (opts?.query ?? '').trim();
  try {
    const token = await getCacheVersion(env, versionKey(tenantId, projectId));
    const cached = await getOrSetCached(
      env,
      `project_facts:recall:${tenantId}:${projectId}:v:${token}:${limit}:${query}`,
      async () => {
        // Durable beliefs only — Q&A cache rows (source=qa-cache) are retrieved by
        // exact question key (projectMemory), never surfaced as ambient RAG facts.
        // An EXPIRED fact is already gone as far as recall is concerned (0371) — the
        // read is the authority, the retention sweep is only housekeeping. Without
        // this a lapsed belief keeps riding the prompt until a cron happens to run.
        const base = and(
          eq(projectFacts.tenantId, tenantId),
          eq(projectFacts.projectId, projectId),
          ne(projectFacts.source, QA_CACHE_SOURCE),
          or(isNull(projectFacts.expiresAt), gt(projectFacts.expiresAt, new Date())),
        );
        const words = tokenize(query);
        const where: SQL | undefined = words.length > 0 ? and(base, or(...words.map((w) => ilike(projectFacts.content, `%${w}%`)))) : base;
        const rows = await db
          .select({ key: projectFacts.key, content: projectFacts.content, expiresAt: projectFacts.expiresAt })
          .from(projectFacts)
          .where(scopedToTenant(projectFacts, tenantId, where))
          .orderBy(desc(projectFacts.importance), desc(projectFacts.updatedAt))
          .limit(limit);
        return rows.map((row) => ({
          key: row.key,
          content: row.content,
          expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
        }));
      },
      { kvTtlSeconds: 60 },
    );
    const now = new Date();
    return cached.filter((fact) => !isExpired(fact.expiresAt, now));
  } catch {
    return [];
  }
}

/**
 * Fetch a single fact's content by EXACT key (read-through cached, version-token
 * keyed like recall). Used by the Q&A cache short-circuit — an O(1) PK lookup that
 * decides "have we answered this exact question before?" without an LLM call.
 * Returns null when absent / pre-migration / invalid project.
 */
export async function getProjectFactByKey(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  key: string,
): Promise<string | null> {
  const k = (key ?? '').trim().slice(0, 255);
  if (!k || !Number.isInteger(projectId) || projectId <= 0) return null;
  try {
    const token = await getCacheVersion(env, versionKey(tenantId, projectId));
    return await getOrSetCached(
      env,
      `project_facts:key:${tenantId}:${projectId}:v:${token}:${k}`,
      async () => {
        const [row] = await db
          .select({ content: projectFacts.content })
          .from(projectFacts)
          .where(and(
            eq(projectFacts.tenantId, tenantId),
            eq(projectFacts.projectId, projectId),
            eq(projectFacts.key, k),
            or(isNull(projectFacts.expiresAt), gt(projectFacts.expiresAt, new Date())),
          ))
          .limit(1);
        return row?.content ?? null;
      },
      { kvTtlSeconds: 60 },
    );
  } catch {
    return null;
  }
}

/**
 * Format recalled facts as a system-prompt block. The ONE formatter every surface
 * uses (cloud/on-prem/IDE) so the injected memory reads identically everywhere.
 * Empty string when there are no facts (caller appends nothing).
 */
export function formatProjectFactsBlock(facts: ProjectFact[]): string {
  if (facts.length === 0) return '';
  return `[Project memory — durable facts recalled for this project]\n${facts.map((f) => `- ${f.content}`).join('\n')}`;
}

/** Recall + format in one call — the shared server-side prompt injector. */
export async function buildProjectFactsBlock(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  query?: string,
): Promise<string> {
  const facts = await recallProjectFacts(env, db, tenantId, projectId, query != null ? { query } : undefined);
  return formatProjectFactsBlock(facts);
}
