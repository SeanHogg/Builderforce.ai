/**
 * projectFacts RECALL — the hybrid (lexical + semantic) read-through-cached recall, the
 * recall stamp the decay sweep relies on, and the ONE system-prompt block formatter
 * every surface injects. Primitives live in `projectFactsStore`.
 */
import { and, desc, eq, gt, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { memoryEmbeddingText } from '../memory/memoryEmbedding';
import { memoryQueryVectors, type MemoryQueryVector } from '../memory/memoryEmbeddingPolicy';
import { annAcrossSpaces, annRecallProject } from '../memory/memorySemanticRecall';
import { cutRecall } from './retrievalK';
import { rankMemoryArms } from '../memory/memoryRecallRanking';
import { projectFacts } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { isExpired } from '../../domain/memory/memoryScope';
import { queryTerms } from '../../domain/shared/queryTerms';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { withCurrentAnchors } from './projectFactsCodemap';
import { recallAreaCodemaps } from './projectFactsAreaRecall';
import {
  QA_CACHE_SOURCE,
  hostDirectoryHashReader,
  normalizeFileAnchors,
  projectFactsVersion,
  type FactFileAnchor,
  type FileContentHashReader,
  type ProjectFact,
} from './projectFactsStore';

const RECALL_DEFAULT = 6;
const RECALL_MAX = 20;
/**
 * Candidates pulled per arm before fusion, as a multiple of the caller's limit — the
 * same widening `memoryService` applies, and for the same reason: fusion can only
 * choose between candidates it was given, so a narrow pull makes the semantic arm
 * re-order the rows the lexical arm already picked rather than reach a relevant fact
 * outside that window.
 */
const RECALL_CANDIDATE_MULTIPLIER = 4;

/**
 * Recall project facts (read-through cached).
 *
 * A `query` runs TWO arms and fuses them — this used to be a single `ILIKE` substring
 * match, which could only ever find a fact that literally contained the query's words,
 * so "how do we prevent duplicate invoices?" missed every fact that said "an invoice
 * may be raised once per order" and the run simply started without it.
 *   1. LEXICAL (the original `ILIKE` arm) — kept, because an exact identifier ("QA_CACHE_SOURCE",
 *      "project_facts") is a lookup, not a similarity, and embeddings are worse at it.
 *   2. SEMANTIC � the project ANN read over the active embedding spaces.
 *
 * Governed recall consumes the same candidate arms and ranking policy.
 *
 * Without a `query`, returns the most important/recent. Degrades to [] on any error
 * (e.g. pre-migration table).
 */
export async function recallProjectFacts(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  opts?: {
    query?: string;
    limit?: number;
    readFileHash?: FileContentHashReader;
  },
): Promise<ProjectFact[]> {
  if (!Number.isInteger(projectId) || projectId <= 0) return [];
  const limit = Math.min(Math.max(1, Math.trunc(opts?.limit ?? RECALL_DEFAULT)), RECALL_MAX);
  const query = (opts?.query ?? '').trim();
  try {
    const token = await projectFactsVersion(env, tenantId, projectId);
    const cached = await getOrSetCached(
      env,
      `project_facts:recall:${tenantId}:${projectId}:v:${token}:${limit}:${query}`,
      async () => {
        const vectors = memoryQueryVectors(env, tenantId, query, ['project_facts']);
        const pull = Math.min(limit * RECALL_CANDIDATE_MULTIPLIER, 100);
        const { vector, text } = await loadProjectFactRecallArms(db, tenantId, projectId, query, pull, vectors);
        const kept = await cutRecall({ env, tenantId, query, ranked: rankMemoryArms(vector, text), requested: limit, textOf: (row) => memoryEmbeddingText(row.key, row.content) });
        return kept.map((row) => ({
          key: row.key,
          content: row.content,
          expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
          // The anchors MUST survive the cache: the stale-anchor check below runs on
          // whatever this returns, so a payload without them would make every
          // anchored fact look unanchored and nothing would ever be flagged stale.
          ...(row.fileAnchors?.length ? { fileAnchors: row.fileAnchors } : {}),
        }));
      },
      { kvTtlSeconds: 60 },
    );
    const now = new Date();
    const live = cached.filter((fact) => !isExpired(fact.expiresAt, now));
    // Stale-anchor exclusion runs OUTSIDE the cached loader on purpose (ticket 5301).
    // The cache key is the fact-table version token, so a file changing does not bust
    // it — a check folded inside the loader would keep serving a belief about a file
    // for up to the 60s TTL after the file changed. With no reader nothing is
    // excluded, so this changes no caller's current behaviour. A CODE MAP is not
    // excluded for one changed file: that file's line is dropped and the map stays.
    const readHash = opts?.readFileHash;
    const kept: ProjectFact[] = [];
    for (const fact of live) {
      const current = readHash ? await withCurrentAnchors(fact, readHash) : fact;
      if (current) kept.push(current);
    }
    // Stamp what recall actually RETURNED (1248) — the kept facts, so a fact dropped
    // as stale is not counted as recalled and cannot be rescued by the decay sweep.
    // Best-effort: a failed stamp must not lose the recall itself.
    if (kept.length) {
      await stampFactRecall(db, tenantId, projectId, kept.map((f) => f.key)).catch((err: unknown) => {
        reportCaughtError(err, { source: 'project-facts', operation: 'stamp-recall', level: 'warning', context: { tenantId, projectId } });
      });
    }
    return kept;
  } catch {
    return [];
  }
}

/**
 * Record that these keys were just recalled: bump `recall_count` and move
 * `last_recalled_at`. Scoped to (tenant, project, key) and to live rows only, so
 * it can never revive or touch a retired fact. Best-effort by contract.
 */
export async function stampFactRecall(
  db: Db,
  tenantId: number,
  projectId: number,
  keys: readonly string[],
): Promise<void> {
  const wanted = [...new Set(keys.map((k) => (k ?? '').trim()).filter(Boolean))];
  if (!wanted.length || !Number.isInteger(projectId) || projectId <= 0) return;
  await db
    .update(projectFacts)
    .set({
      lastRecalledAt: new Date(),
      recallCount: sql`${projectFacts.recallCount} + 1`,
    })
    .where(and(
      scopedToTenant(projectFacts, tenantId),
      eq(projectFacts.projectId, projectId),
      inArray(projectFacts.key, wanted),
      isNull(projectFacts.supersededBy),
      or(isNull(projectFacts.expiresAt), gt(projectFacts.expiresAt, new Date())),
    ));
}

function activeProjectFacts(tenantId: number, projectId: number) {
  return scopedToTenant(
    projectFacts,
    tenantId,
    eq(projectFacts.projectId, projectId),
    ne(projectFacts.source, QA_CACHE_SOURCE),
    isNull(projectFacts.supersededBy),
    or(isNull(projectFacts.expiresAt), gt(projectFacts.expiresAt, new Date())),
  );
}

interface SemanticFactRow {
  id: string;
  key: string;
  content: string;
  scopeKind: 'project';
  origin: 'agent';
  expiresAt: Date | null;
  importance: number;
  vectorScore: number;
  fileAnchors: FactFileAnchor[] | null;
}

const projectFactCandidateColumns = {
  key: projectFacts.key,
  content: projectFacts.content,
  expiresAt: projectFacts.expiresAt,
  importance: projectFacts.importance,
  fileAnchors: projectFacts.fileAnchors,
};

function projectFactCandidate(
  row: Pick<typeof projectFacts.$inferSelect, keyof typeof projectFactCandidateColumns>,
  vectorScore: number,
): SemanticFactRow {
  return {
    id: `project:${row.key}`,
    key: row.key,
    content: row.content,
    scopeKind: 'project',
    origin: 'agent',
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    importance: Number(row.importance ?? 0.5),
    vectorScore,
    fileAnchors: normalizeFileAnchors(row.fileAnchors as FactFileAnchor[] | null),
  };
}

/** Project candidates used by both project-only and governed memory recall. */
export async function loadProjectFactRecallArms(
  db: Db,
  tenantId: number,
  projectId: number,
  query: string,
  pull: number,
  vectors: Promise<MemoryQueryVector[]>,
): Promise<{ vector: SemanticFactRow[]; text: SemanticFactRow[] }> {
  const matchers = queryTerms(query).map((word) => ilike(projectFacts.content, `%${word}%`));
  const lexical = matchers.length > 0 ? or(...matchers) : undefined;

  const semantic = vectors
    .then((ready) => recallProjectFactsSemantically(db, tenantId, projectId, ready, pull))
    .catch((err: unknown): SemanticFactRow[] => {
      reportCaughtError(err, { source: 'project-facts', operation: 'semantic-recall', level: 'warning', context: { tenantId, projectId } });
      return [];
    });
  const lexicalRows: SemanticFactRow[] = (
    await db
      .select(projectFactCandidateColumns)
      .from(projectFacts)
      .where(and(activeProjectFacts(tenantId, projectId), lexical))
      .orderBy(desc(projectFacts.importance), desc(projectFacts.updatedAt))
      .limit(pull)
  ).map((row) => projectFactCandidate(row, 0));

  return { vector: await semantic, text: lexicalRows };
}

/** Hydrate the ANN nominations with anchors and reapply active-fact predicates. */
async function recallProjectFactsSemantically(
  db: Db,
  tenantId: number,
  projectId: number,
  vectors: readonly MemoryQueryVector[],
  limit: number,
): Promise<SemanticFactRow[]> {
  const hits = await annAcrossSpaces(vectors, (literal, opts) =>
    annRecallProject(db, tenantId, projectId, literal, limit, QA_CACHE_SOURCE, opts),
  );
  if (!hits.length) return [];

  const keys = hits.map((h) => h.key).filter(Boolean);
  if (!keys.length) return [];
  const rows = await db
    .select(projectFactCandidateColumns)
    .from(projectFacts)
    .where(and(
      activeProjectFacts(tenantId, projectId),
      inArray(projectFacts.key, keys),
    ));
  // A key can only be found in one space (the fallback arm excludes rows the other
  // space covers), but take the best score defensively rather than the last one.
  const scoreByKey = new Map<string, number>();
  for (const h of hits) scoreByKey.set(h.key, Math.max(scoreByKey.get(h.key) ?? 0, h.vectorScore));
  return rows.map((row) => projectFactCandidate(row, scoreByKey.get(row.key) ?? 0));
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

/**
 * Recall + format in one call — the shared server-side prompt injector (the run-context
 * source's memory block, for cloud and on-prem alike).
 *
 * Alongside the semantic recall, the code maps for the AREAS the query names
 * (`recallAreaCodemaps`) — a map is "open these files first", and similarity to the
 * request text is a poor way to find the one for the area the request is about. Maps
 * lead the block; a map both arms found appears once.
 */
export async function buildProjectFactsBlock(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  query?: string,
  opts?: { readFileHash?: FileContentHashReader },
): Promise<string> {
  // Run-start default: a fact whose anchored files changed is excluded (a map drops
  // just those files). Callers that already have a reader (tests, a workspace walk)
  // pass their own.
  const readFileHash = opts?.readFileHash ?? hostDirectoryHashReader(db, tenantId);
  const [facts, maps] = await Promise.all([
    recallProjectFacts(env, db, tenantId, projectId, { ...(query != null ? { query } : {}), readFileHash }),
    query?.trim()
      ? recallAreaCodemaps(env, db, tenantId, projectId, query, { readFileHash }).catch((err: unknown): ProjectFact[] => {
          reportCaughtError(err, { source: 'project-facts', operation: 'area-codemap-recall', level: 'warning', context: { tenantId, projectId } });
          return [];
        })
      : Promise.resolve([] as ProjectFact[]),
  ]);
  const mapped = new Set(maps.map((m) => m.key));
  // Recall stamped what IT returned; a map only the area arm found is stamped here, so
  // the decay sweep keeps a map that runs are actually handed.
  const recalled = new Set(facts.map((f) => f.key));
  const onlyMapped = maps.map((m) => m.key).filter((k) => !recalled.has(k));
  if (onlyMapped.length) {
    await stampFactRecall(db, tenantId, projectId, onlyMapped).catch((err: unknown) => {
      reportCaughtError(err, { source: 'project-facts', operation: 'stamp-area-codemap-recall', level: 'warning', context: { tenantId, projectId } });
    });
  }
  return formatProjectFactsBlock([...maps, ...facts.filter((f) => !mapped.has(f.key))]);
}
