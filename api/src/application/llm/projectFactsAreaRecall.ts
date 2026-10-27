/**
 * Area-targeted code-map recall — the server half of "open the files an earlier run
 * found for this area first", used by the run-context memory block every cloud and
 * on-prem run receives (`buildProjectFactsBlock` → `runContextSource`).
 *
 * The generic recall ranks facts by similarity to the request, which is a poor way to
 * find the map for the AREA a request is about: a map is a list of paths. So the areas
 * are read off the request instead, by the same pure rules the editor uses
 * (`@seanhogg/builderforce-memory/working`): the paths it names, and the stored areas it
 * names by word. Every stored map is a candidate (one cheap keyed read, cached on the
 * fact-store version token), and the same live / stale-anchor rules as recall apply.
 */
import { and, desc, eq, gt, isNull, like, or } from 'drizzle-orm';
import {
  CONSOLIDATED_KEY_PREFIX,
  MAX_RECALLED_MAPS,
  areasNamedIn,
  areasOfPathsIn,
  consolidatedArea,
  consolidatedFactsFor,
} from '@seanhogg/builderforce-memory/working';
import { projectFacts } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { isExpired } from '../../domain/memory/memoryScope';
import { withCurrentAnchors } from './projectFactsCodemap';
import {
  normalizeFileAnchors,
  projectFactsVersion,
  type FactFileAnchor,
  type FileContentHashReader,
  type ProjectFact,
} from './projectFactsStore';

/** Stored maps considered, at most — one per area, so this is the project's area count. */
const MAX_STORED_MAPS = 200;

/** The project's live code maps, newest first (read-through cached on the version token). */
async function storedCodemaps(env: Env, db: Db, tenantId: number, projectId: number): Promise<ProjectFact[]> {
  const token = await projectFactsVersion(env, tenantId, projectId);
  return getOrSetCached(
    env,
    `project_facts:codemaps:${tenantId}:${projectId}:v:${token}`,
    async () => {
      const rows = await db
        .select({ key: projectFacts.key, content: projectFacts.content, expiresAt: projectFacts.expiresAt, fileAnchors: projectFacts.fileAnchors })
        .from(projectFacts)
        .where(scopedToTenant(projectFacts, tenantId, and(
          eq(projectFacts.projectId, projectId),
          like(projectFacts.key, `${CONSOLIDATED_KEY_PREFIX}%`),
          isNull(projectFacts.supersededBy),
          or(isNull(projectFacts.expiresAt), gt(projectFacts.expiresAt, new Date())),
        )))
        .orderBy(desc(projectFacts.updatedAt))
        .limit(MAX_STORED_MAPS);
      return rows.map((row) => {
        const fileAnchors = normalizeFileAnchors(row.fileAnchors as FactFileAnchor[] | null);
        return {
          key: row.key,
          content: row.content,
          expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
          ...(fileAnchors?.length ? { fileAnchors } : {}),
        };
      });
    },
    { kvTtlSeconds: 60 },
  );
}

/** The areas `query` is about, read against the areas that have a stored map. */
export function areasForQuery(query: string, storedAreas: readonly string[]): string[] {
  return [...new Set([...areasOfPathsIn(query), ...areasNamedIn(query, storedAreas)])];
}

/**
 * The stored code maps for the areas `query` names, most specific first. A map whose
 * listed files changed is served without them (`withCurrentAnchors`); an expired one is
 * not served. `[]` when the query names no area that has a map. Not stamped as recalled
 * here: the caller that SERVES the maps stamps them (`buildProjectFactsBlock`).
 */
export async function recallAreaCodemaps(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  query: string,
  opts?: { readFileHash?: FileContentHashReader; max?: number },
): Promise<ProjectFact[]> {
  const q = query.trim();
  if (!q || !Number.isInteger(projectId) || projectId <= 0) return [];
  const now = new Date();
  const stored = (await storedCodemaps(env, db, tenantId, projectId)).filter((f) => !isExpired(f.expiresAt, now));
  if (stored.length === 0) return [];
  const areas = areasForQuery(q, stored.map((f) => consolidatedArea(f.key)).filter((a): a is string => a !== undefined));
  const picked = consolidatedFactsFor(stored, areas, opts?.max ?? MAX_RECALLED_MAPS);
  const readHash = opts?.readFileHash;
  const kept: ProjectFact[] = [];
  for (const fact of picked) {
    const current = readHash ? await withCurrentAnchors(fact, readHash) : fact;
    if (current) kept.push(current);
  }
  return kept;
}
