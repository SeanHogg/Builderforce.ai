/**
 * projectFacts ANSWER CACHE — the memory-first Q&A cache rows (source
 * {@link QA_CACHE_SOURCE}) living in the same table as durable beliefs: the exact-key
 * read a replay is priced from, and the purge that clears pinned answers. Primitives
 * live in `projectFactsStore`; the replay itself is `projectMemory`.
 */
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { projectFacts } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  QA_CACHE_SOURCE,
  bumpProjectFactsVersion,
  normalizeFileAnchors,
  projectFactsVersion,
  type FactFileAnchor,
  type FactOriginCost,
} from './projectFactsStore';

/** A fact's content plus its production cost, when known. */
export interface ProjectFactRecord {
  content: string;
  origin: FactOriginCost | null;
  /** Files the cached answer was about, so a replay can drop it when they change. */
  fileAnchors: FactFileAnchor[] | null;
}

/**
 * One live fact by key WITH what producing it cost — the read the Q&A cache replay
 * prices its saving from. One cached PK lookup per key, invalidated with the project's
 * fact version on any write.
 */
export async function getProjectFactRecordByKey(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  key: string,
): Promise<ProjectFactRecord | null> {
  const k = (key ?? '').trim().slice(0, 255);
  if (!k || !Number.isInteger(projectId) || projectId <= 0) return null;
  try {
    const token = await projectFactsVersion(env, tenantId, projectId);
    return await getOrSetCached(
      env,
      `project_facts:keyrec:${tenantId}:${projectId}:v:${token}:${k}`,
      async () => {
        const [row] = await db
          .select({
            content: projectFacts.content,
            originModel: projectFacts.originModel,
            originPromptTokens: projectFacts.originPromptTokens,
            originCompletionTokens: projectFacts.originCompletionTokens,
            fileAnchors: projectFacts.fileAnchors,
          })
          .from(projectFacts)
          .where(and(
            eq(projectFacts.tenantId, tenantId),
            eq(projectFacts.projectId, projectId),
            eq(projectFacts.key, k),
            // A RETIRED fact is a miss here exactly as it is in ambient recall (1242).
            // This is the read that re-serves a cached answer verbatim, so a row
            // retired because it was contradicted must return null — otherwise the
            // retirement column would gate ambient recall while leaving the exact-key
            // replay, which is the path the "8/16 step cap" answer actually came from,
            // still serving it.
            isNull(projectFacts.supersededBy),
            or(isNull(projectFacts.expiresAt), gt(projectFacts.expiresAt, new Date())),
          ))
          .limit(1);
        if (!row) return null;
        const origin = row.originModel != null && row.originPromptTokens != null && row.originCompletionTokens != null
          ? { model: row.originModel, promptTokens: row.originPromptTokens, completionTokens: row.originCompletionTokens }
          : null;
        return { content: row.content, origin, fileAnchors: normalizeFileAnchors(row.fileAnchors as FactFileAnchor[] | null) };
      },
      { kvTtlSeconds: 60 },
    );
  } catch {
    return null;
  }
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
    .catch((err: unknown) => {
      // Same contract as deleteProjectFact: a failed purge must not be counted as
      // "nothing to purge", or the caller stops believing the cache needs clearing.
      reportCaughtError(err, { source: 'project-facts', operation: 'purge-project-qa-cache', level: 'error', context: { tenantId, projectId } });
      return [] as Array<{ id: string }>;
    });
  if (removed.length > 0) await bumpProjectFactsVersion(env, tenantId, projectId);
  return removed.length;
}
