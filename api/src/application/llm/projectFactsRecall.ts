/**
 * projectFacts RECALL — the hybrid (lexical + semantic) read-through-cached recall, the
 * recall stamp the decay sweep relies on, and the ONE system-prompt block formatter
 * every surface injects. Primitives live in `projectFactsStore`.
 */
import { and, desc, eq, gt, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { memoryEmbeddingText } from '../memory/memoryEmbedding';
import { memoryQueryVectors } from '../memory/memoryEmbeddingPolicy';
import { annRecallProject } from '../memory/memorySemanticRecall';
import { cutRecall } from './retrievalK';
import { fuseHybridArms } from '@seanhogg/builderforce-memory/retrieval';
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
 *   2. SEMANTIC — the same `annRecallProject` + `memoryEmbeddingText` path `memoryService`
 *      uses for `agent_memory`: same model, same 1536 dims, same cosine distance, same
 *      `fuseHybridArms` weighting. Not reinvention — the one implementation.
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
    /** The caller is FUSING these as one arm of a wider recall (`memoryService`), so
     *  return the first `limit` fused rows and leave the rerank / adaptive cut (C6/C4)
     *  to the caller's single cut over the union. */
    candidatesOnly?: boolean;
  },
): Promise<ProjectFact[]> {
  if (!Number.isInteger(projectId) || projectId <= 0) return [];
  const limit = Math.min(Math.max(1, Math.trunc(opts?.limit ?? RECALL_DEFAULT)), RECALL_MAX);
  const query = (opts?.query ?? '').trim();
  const candidatesOnly = opts?.candidatesOnly === true;
  try {
    const token = await projectFactsVersion(env, tenantId, projectId);
    const cached = await getOrSetCached(
      env,
      // Keyed on the REQUESTED limit, never the adaptive K a cut chose, so C4 cannot
      // fragment the cache; a candidate-arm read is its own entry (it is not cut).
      `project_facts:recall:${tenantId}:${projectId}:v:${token}:${limit}${candidatesOnly ? ':c' : ''}:${query}`,
      async () => {
        // Durable beliefs only — Q&A cache rows (source=qa-cache) are retrieved by
        // exact question key (projectMemory), never surfaced as ambient RAG facts.
        // An EXPIRED fact is already gone as far as recall is concerned (0371) — the
        // read is the authority, the retention sweep is only housekeeping. Without
        // this a lapsed belief keeps riding the prompt until a cron happens to run.
        // And a RETIRED fact is gone the same way (1242): a belief the codebase has
        // contradicted must stop reaching the prompt, or the fix that retired it is
        // undone by the next recall.
        const base = and(
          eq(projectFacts.tenantId, tenantId),
          eq(projectFacts.projectId, projectId),
          ne(projectFacts.source, QA_CACHE_SOURCE),
          isNull(projectFacts.supersededBy),
          or(isNull(projectFacts.expiresAt), gt(projectFacts.expiresAt, new Date())),
        );
        // No lexical hit is not a dead end any more — the semantic arm runs regardless,
        // and the caller's query is what gets embedded.
        const words = queryTerms(query);
        const lexicalWhere: SQL | undefined = words.length > 0
          ? and(base, or(...words.map((w) => ilike(projectFacts.content, `%${w}%`))))
          : base;
        const pull = Math.min(limit * RECALL_CANDIDATE_MULTIPLIER, 100);

        const lexicalRows: SemanticFactRow[] = (
          await db
            .select({ key: projectFacts.key, content: projectFacts.content, expiresAt: projectFacts.expiresAt, importance: projectFacts.importance, fileAnchors: projectFacts.fileAnchors })
            .from(projectFacts)
            .where(scopedToTenant(projectFacts, tenantId, lexicalWhere))
            .orderBy(desc(projectFacts.importance), desc(projectFacts.updatedAt))
            .limit(pull)
        ).map((row) => ({
          // The KEY is the fusion id, matching the semantic arm's — so a fact found by
          // both is scored on both rather than counted twice.
          id: row.key,
          key: row.key,
          content: row.content,
          expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
          // `?? 0.5` is the column default, restated so a caller (or a test double)
          // that omits the field still ranks at neutral instead of poisoning the fused
          // score with NaN.
          importance: Number.isFinite(Number(row.importance)) ? Number(row.importance) : 0.5,
          score: 1, // a lexical match is a full-text hit, so it scores 1 by construction
          fileAnchors: normalizeFileAnchors(row.fileAnchors as FactFileAnchor[] | null),
        }));

        const semanticRows = await recallProjectFactsSemantically(
          env,
          db,
          tenantId,
          projectId,
          query,
          pull,
        ).catch((err: unknown): SemanticFactRow[] => {
          reportCaughtError(err, { source: 'project-facts', operation: 'semantic-recall', level: 'warning', context: { tenantId, projectId } });
          return [];
        });

        // Fused ranking, identical weights to `memoryService`'s union recall (0.7
        // semantic / 0.3 lexical) so a fact means the same score wherever it is read.
        //
        // `importance` enters as a MULTIPLIER on both arms rather than as a third
        // weighted term, because it is not another way of matching the query — it is a
        // property of the fact itself. As a term it would double-count against the
        // lexical score (which is 1 for every row in the arm, so it would be a constant
        // shift); as a multiplier it does what "this fact matters more" means, and it
        // keeps a retired-and-replaced belief from outranking a live one that merely
        // reads more fluently. Rows at the neutral 0.5 are untouched.
        const ranked = fuseHybridArms<SemanticFactRow, SemanticFactRow, { row: SemanticFactRow; score: number }>({
          vector: semanticRows,
          text: lexicalRows,
          vectorScoreOf: (r) => r.score * (0.5 + r.importance),
          textScoreOf: (r) => (0.5 + r.importance),
          merge: (row, score) => ({ row, score }),
        });
        // With no query the semantic arm is empty, and a stable sort of a
        // constant-per-arm score preserves the SQL's importance-then-recency order.
        // The cut: `limit` as before, or reranked (C6) / adaptively sized (C4) when on.
        const kept = candidatesOnly
          ? ranked.slice(0, limit).map((c) => c.row)
          : await cutRecall<SemanticFactRow>({ env, tenantId, query, ranked, requested: limit, textOf: (row) => memoryEmbeddingText(row.key, row.content) });
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
    ));
}

/** One recalled fact plus the semantic similarity that found it. */
interface SemanticFactRow {
  /** The fact's key — the unique identity within (tenant, project), and therefore the
   *  fusion id. Both arms return the same row for the same belief, so they agree. */
  id: string;
  key: string;
  content: string;
  expiresAt: Date | null;
  importance: number;
  /** Cosine SIMILARITY in [0,1] (already floored at 0 by `memorySemanticRecall`), so it
   *  is directly comparable with the lexical arm's 1. Higher is better, both arms. */
  score: number;
  /** The fact's anchors (1248), carried so the stale-anchor check sees them. */
  fileAnchors?: Array<{ path: string; line?: number; contentHash?: string }> | null;
}

/**
 * The semantic arm of {@link recallProjectFacts}, by way of the SHARED ANN path.
 *
 * `annRecallProject` is the same read `memoryService` uses for project-scoped recall:
 * same `pgvector` cosine operator, same `MEMORY_EMBEDDING_MODEL` pin, same 1536-dim
 * column, same nearest-N ordering by distance. Reused as-is rather than reimplemented —
 * that is the whole point of it living in its own module.
 *
 * Its result is then re-joined against `project_facts` BY KEY, and that join is not
 * redundant. `annRecallProject` filters the qa-cache source and expiry but predates
 * the 1242 retirement columns, so it will happily return a row that has since been
 * superseded. Hydrating re-applies every live predicate in SQL — `superseded_by IS
 * NULL` included — against the table that actually owns those columns, so the
 * semantic arm can never widen what recall may return. It is also what turns the
 * composite `project:<key>` identity back into a full row.
 *
 * Returns [] when there is nothing to compare (no query, or no query embedding because
 * no provider), which is the caller's signal to fall back to lexical alone.
 */
async function recallProjectFactsSemantically(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  query: string,
  limit: number,
): Promise<SemanticFactRow[]> {
  if (!query) return [];
  // The RAW query is what gets embedded, not `memoryEmbeddingText(key, …)` — that one
  // is for WRITE-side text. One vector per vector space the tenant reads (E3 dual-read),
  // the same policy `memoryService.recall` uses.
  const vectors = await memoryQueryVectors(env, tenantId, query, ['project_facts']);
  if (!vectors.length) return [];
  const hits = (
    await Promise.all(
      vectors.map((v) =>
        annRecallProject(db, tenantId, projectId, v.literal, limit, QA_CACHE_SOURCE, {
          space: v.space,
          ...(v.onlyRowsLacking ? { onlyRowsLacking: v.onlyRowsLacking } : {}),
        }),
      ),
    )
  ).flat();
  if (!hits.length) return [];

  const keys = hits.map((h) => h.key).filter(Boolean);
  if (!keys.length) return [];
  const rows = await db
    .select({ key: projectFacts.key, content: projectFacts.content, expiresAt: projectFacts.expiresAt, importance: projectFacts.importance, fileAnchors: projectFacts.fileAnchors })
    .from(projectFacts)
    .where(and(
      scopedToTenant(projectFacts, tenantId),
      eq(projectFacts.projectId, projectId),
      inArray(projectFacts.key, keys),
      ne(projectFacts.source, QA_CACHE_SOURCE),
      isNull(projectFacts.supersededBy),
      or(isNull(projectFacts.expiresAt), gt(projectFacts.expiresAt, new Date())),
    ));
  // A key can only be found in one space (the fallback arm excludes rows the other
  // space covers), but take the best score defensively rather than the last one.
  const scoreByKey = new Map<string, number>();
  for (const h of hits) scoreByKey.set(h.key, Math.max(scoreByKey.get(h.key) ?? 0, h.vectorScore));
  return rows.map((row) => ({
    id: row.key,
    key: row.key,
    content: row.content,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    importance: Number.isFinite(Number(row.importance)) ? Number(row.importance) : 0.5,
    score: scoreByKey.get(row.key) ?? 0,
    fileAnchors: normalizeFileAnchors(row.fileAnchors as FactFileAnchor[] | null),
  }));
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
