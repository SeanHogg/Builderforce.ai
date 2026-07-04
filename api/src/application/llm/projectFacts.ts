/**
 * projectFacts — the shared, per-PROJECT write-through FACTS store (migration 0276).
 *
 * This is the "knowledge tier" half of Evermind ([[evermind-learning-architecture]]):
 * durable BELIEFS (decisions, conventions, locations, repo/lib versions) that every
 * surface — VS Code, web Brain, cloud agent, on-prem — reads AND writes to the SAME
 * place, so a fact one run learns is recalled by all others on that project. It is the
 * project-scoped twin of the tenant `agent_memory` (cloudMemory.ts).
 *
 * Write-through per the Evermind law: `upsertProjectFact` replaces by stable key
 * (update == replace, never accumulate). Recall is a read served through the canonical
 * read-through cache, keyed by a per-(tenant,project) VERSION token bumped on every
 * write, so a recall never serves a stale fact set.
 */
import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { projectFacts } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';

const RECALL_DEFAULT = 6;
const RECALL_MAX = 20;

export interface ProjectFact {
  key: string;
  content: string;
}

function versionKey(tenantId: number, projectId: number): string {
  return `project_facts:${tenantId}:${projectId}`;
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
): Promise<boolean> {
  const k = (key ?? '').trim().slice(0, 255);
  const c = (content ?? '').trim();
  if (!k || !c || !Number.isInteger(projectId) || projectId <= 0) return false;
  await db
    .insert(projectFacts)
    .values({ tenantId, projectId, key: k, content: c, source: source.slice(0, 64) })
    .onConflictDoUpdate({
      target: [projectFacts.tenantId, projectFacts.projectId, projectFacts.key],
      set: { content: c, source: source.slice(0, 64), updatedAt: new Date() },
    });
  await bumpCacheVersion(env, versionKey(tenantId, projectId));
  return true;
}

/**
 * Recall project facts (read-through cached). With a `query`, ranks by lexical
 * overlap (ILIKE, same graceful fallback as cloudMemory); without one, returns the
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
    return await getOrSetCached(
      env,
      `project_facts:recall:${tenantId}:${projectId}:v:${token}:${limit}:${query}`,
      async () => {
        const base = and(eq(projectFacts.tenantId, tenantId), eq(projectFacts.projectId, projectId));
        const words = tokenize(query);
        const where: SQL | undefined = words.length > 0 ? and(base, or(...words.map((w) => ilike(projectFacts.content, `%${w}%`)))) : base;
        return db
          .select({ key: projectFacts.key, content: projectFacts.content })
          .from(projectFacts)
          .where(where)
          .orderBy(desc(projectFacts.importance), desc(projectFacts.updatedAt))
          .limit(limit);
      },
      { kvTtlSeconds: 60 },
    );
  } catch {
    return [];
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
