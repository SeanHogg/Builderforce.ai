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
import { and, desc, eq, gt, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { embedMemoryText, memoryEmbeddingText, toVectorLiteral, MEMORY_EMBEDDING_MODEL } from '../memory/memoryEmbedding';
import { annRecallProject } from '../memory/memorySemanticRecall';
import { fuseHybridArms } from '@seanhogg/builderforce-memory/retrieval';
import { agentHostDirectoryFiles, llmTraces, projectFacts } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { isExpired } from '../../domain/memory/memoryScope';
import { queryTerms } from '../../domain/shared/queryTerms';
import { sha256Hex } from '../../domain/shared/hash';
import { clamp01 } from '../../domain/shared/numbers';
import { reportCaughtError } from '../observability/caughtErrorReporter';

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
  /** The fact's file anchors, carried through the cached payload so the stale-anchor
   * check can run outside the loader. Absent means unanchored, and an unanchored
   * fact is never stale. */
  fileAnchors?: Array<{ path: string; line?: number; contentHash?: string }> | null;
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

/** What producing a fact cost — the model and token counts of the turn that wrote it. */
export interface FactOriginCost {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * How much a fact is worth to recall, in the same `0..1` band `agent_memory` uses.
 *
 * Until this existed every project fact carried the column default 0.5, so the
 * recall ordering (`importance DESC, updated_at DESC`) was plain newest-first — the
 * ranking said nothing at all. An explicit weight restores it, and it is derived
 * from WHAT THE FACT SAYS rather than from who wrote it, so the same claim scores
 * the same however it reached the store.
 */
export type FactImportance = 'invariant' | 'convention' | 'decision' | 'default';

/**
 * The four weights, and what earns each.
 *
 * Ordered by how badly a stale instance misleads. An invariant ("auth is enforced in
 * the gateway, never in the client") is worse to replay wrong than a decision that
 * was reversed, which is worse than trivia — because a wrong invariant produces
 * confidently wrong CODE, and the caller acts on it.
 */
const IMPORTANCE_BY_KIND: Record<FactImportance, number> = {
  invariant: 0.85,
  convention: 0.7,
  decision: 0.6,
  // The defensible default, and the same 0.5 the column default used to pin every
  // row to — an unrecognised fact keeps its value rather than being invented one.
  default: 0.5,
};

/**
 * Score a fact by its content. Keyword-based on purpose: this runs on EVERY write, so
 * an embedding-based score would cost a model call per fact and, worse, would rank
 * by similarity to nothing in particular. The patterns are the same ones the 1242
 * backfill uses to rank the historical rows, so a row scored there and a row scored
 * here sit on one scale instead of two.
 *
 * Order matters — the strongest pattern that matches wins, so an invariant that also
 * says "we use" is scored as an invariant.
 */
/**
 * Drop beliefs that have not been recalled within `windowMs` of `now`.
 *
 * Pure and total: a fact with no `lastRecalledAt` has never been recalled, so it is
 * the first thing this drops, and a fact recalled inside the window survives.
 * `sweepUnrecalledFactDecay` is what runs this against the table — recall stamps
 * `last_recalled_at` first, and the sweep only then expires what this filter drops.
 * Calling it before that stamp exists would expire every row. `now` is injectable
 * so a test does not depend on the clock.
 */
export function decayUnrecalled<T extends { lastRecalledAt?: string | null }>(
  facts: readonly T[],
  now: Date,
  windowMs: number,
): T[] {
  if (!(windowMs > 0)) return [...facts];
  const cutoff = now.getTime() - windowMs;
  return facts.filter((fact) => {
    if (!fact.lastRecalledAt) return false;
    const recalled = new Date(fact.lastRecalledAt).getTime();
    return Number.isFinite(recalled) && recalled >= cutoff;
  });
}

export function factImportance(content: string, kind?: FactImportance): number {
  if (kind) return IMPORTANCE_BY_KIND[kind];
  const c = (content ?? '').toLowerCase();
  if (/(invariant|must always|by design|architecture|never )/.test(c)) return IMPORTANCE_BY_KIND.invariant;
  if (/(convention|we use|always |deploy|lint|lives? in|located|version)/.test(c)) return IMPORTANCE_BY_KIND.convention;
  if (/(decision|decided|chose|agreed|rationale|because)/.test(c)) return IMPORTANCE_BY_KIND.decision;
  return IMPORTANCE_BY_KIND.default;
}

/**
 * The digest that decides whether a re-write CORRECTED a fact or merely re-asserted
 * it.
 *
 * Normalised before hashing so a whitespace or case change is not mistaken for a
 * changed belief — the comparison is about whether the CLAIM moved, not how it was
 * typed. Key is mixed in so the same sentence stored under two keys is not treated as
 * the same belief.
 */
export function factContentHash(key: string, content: string): Promise<string> {
  return sha256Hex(`${key}\n${(content ?? '').toLowerCase().replace(/\s+/g, ' ').trim()}`);
}

/** How long a cached Q&A answer stays replayable. The column already exists (0371). */
export const QA_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A fact never returned by recall within this window is expired by the sweep. */
export const UNRECALLED_DECAY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** One file a fact is about. `contentHash` is the file hash at write time. */
export interface FactFileAnchor {
  path: string;
  line?: number;
  contentHash?: string;
}

/**
 * Keep only anchors that name a path. A recorded hash is kept when the caller
 * has one; a missing hash is not invented, and an anchor without one is never
 * treated as stale.
 */
export function normalizeFileAnchors(anchors: readonly FactFileAnchor[] | null | undefined): FactFileAnchor[] | null {
  if (!anchors?.length) return null;
  const out: FactFileAnchor[] = [];
  for (const anchor of anchors) {
    const path = typeof anchor?.path === 'string' ? anchor.path.trim() : '';
    if (!path) continue;
    const contentHash = typeof anchor.contentHash === 'string' && anchor.contentHash.trim()
      ? anchor.contentHash.trim()
      : undefined;
    const line = typeof anchor.line === 'number' && Number.isFinite(anchor.line) ? anchor.line : undefined;
    out.push({ path, ...(line != null ? { line } : {}), ...(contentHash ? { contentHash } : {}) });
  }
  return out.length ? out : null;
}

/** Tool/route payloads are untyped. Keep only object anchors; hashes are filled later. */
export function parseFactFileAnchors(raw: unknown): FactFileAnchor[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const anchors = normalizeFileAnchors(
    raw.filter((item): item is FactFileAnchor => item != null && typeof item === 'object'),
  );
  return anchors ?? undefined;
}

/**
 * A path without a hash cannot go stale later. Fill it from the directory index
 * when the caller named the file but did not hash it. A miss stays unhashed, and
 * an unhashed anchor is never treated as stale.
 */
async function stampAnchorHashes(
  db: Db,
  tenantId: number,
  anchors: FactFileAnchor[] | null,
): Promise<FactFileAnchor[] | null> {
  if (!anchors?.length) return anchors;
  const read = hostDirectoryHashReader(db, tenantId);
  const out: FactFileAnchor[] = [];
  for (const anchor of anchors) {
    if (anchor.contentHash) {
      out.push(anchor);
      continue;
    }
    const hash = await read(anchor.path).catch((err: unknown) => {
      // An anchor with no recorded hash is a real miss, but a FAILED read is not:
      // it leaves the anchor looking unhashed so the next content check re-reads it.
      // Report so a broken reader is distinguishable from an unindexed path.
      reportCaughtError(err, { source: 'project-facts', operation: 'anchor-content-hash-read', level: 'warning', context: { path: anchor.path } });
      return null;
    });
    out.push(hash ? { ...anchor, contentHash: hash } : anchor);
  }
  return out;
}

/**
 * Fill a missing origin triple from the execution's own LLM trace. Returns the
 * caller's triple when it already names a model. Returns null when there is no
 * execution id or no trace — never a guessed model or a guessed token count.
 */
export async function resolveFactOrigin(
  db: Db,
  tenantId: number,
  executionId: number | null | undefined,
  origin: FactOriginCost | null | undefined,
): Promise<FactOriginCost | null> {
  if (origin?.model?.trim()) return origin;
  if (executionId == null || !Number.isInteger(executionId) || executionId <= 0) return origin ?? null;
  const [trace] = await db
    .select({
      model: llmTraces.resolvedModel,
      promptTokens: llmTraces.promptTokens,
      completionTokens: llmTraces.completionTokens,
    })
    .from(llmTraces)
    .where(and(eq(llmTraces.executionId, executionId), eq(llmTraces.tenantId, tenantId)))
    .orderBy(desc(llmTraces.id))
    .limit(1)
    .catch((err: unknown) => {
      // A missing trace is a legitimate "no origin cost", but a FAILED TRACE READ is
      // a database problem the origin columns will silently omit. Report it so the
      // belief is still written — a cost-less fact beats a lost write.
      reportCaughtError(err, { source: 'project-facts', operation: 'resolve-fact-origin', level: 'warning', context: { tenantId, executionId } });
      return [] as Array<{ model: string | null; promptTokens: number; completionTokens: number }>;
    });
  if (!trace?.model?.trim()) return origin ?? null;
  return {
    model: trace.model.trim(),
    promptTokens: trace.promptTokens,
    completionTokens: trace.completionTokens,
  };
}

/**
 * The only file-hash reader this repo already has: the host directory index.
 * A path it does not index returns null, and a null read is not stale.
 */
export function hostDirectoryHashReader(db: Db, tenantId: number): FileContentHashReader {
  return async (path: string) => {
    const rel = path.trim();
    if (!rel) return null;
    const [row] = await db
      .select({ contentHash: agentHostDirectoryFiles.contentHash })
      .from(agentHostDirectoryFiles)
      .where(and(eq(agentHostDirectoryFiles.tenantId, tenantId), eq(agentHostDirectoryFiles.relPath, rel)))
      .orderBy(desc(agentHostDirectoryFiles.updatedAt))
      .limit(1)
      .catch((err: unknown) => {
        // An unindexed path is the normal miss (the reader returns null and the
        // anchor is simply not stale). A FAILED READ is not, and it must not be
        // indistinguishable from one — report it and keep the "not stale" default,
        // which is the safe direction: never drop a belief on a broken index.
        reportCaughtError(err, { source: 'project-facts', operation: 'host-directory-hash-read', level: 'warning', context: { tenantId } });
        return [] as Array<{ contentHash: string }>;
      });
    return row?.contentHash ?? null;
  };
}

/** A fact's content plus its production cost, when known. */
export interface ProjectFactRecord {
  content: string;
  origin: FactOriginCost | null;
  /** Files the cached answer was about, so a replay can drop it when they change. */
  fileAnchors: FactFileAnchor[] | null;
}

/** The origin-cost columns for a write — all three or none, so a half-known cost is
 *  never recorded as if it were a figure. */
function originCostColumns(origin: FactOriginCost | null | undefined): {
  originModel: string | null; originPromptTokens: number | null; originCompletionTokens: number | null;
} {
  const ok = origin && origin.model.trim()
    && Number.isFinite(origin.promptTokens) && origin.promptTokens >= 0
    && Number.isFinite(origin.completionTokens) && origin.completionTokens >= 0;
  return ok
    ? { originModel: origin.model.trim().slice(0, 200), originPromptTokens: Math.round(origin.promptTokens), originCompletionTokens: Math.round(origin.completionTokens) }
    : { originModel: null, originPromptTokens: null, originCompletionTokens: null };
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
   *  application/memory/memoryService, which is the governed write path.
   *
   *  1242 adds the retirement half: `importance` (real weight, not the 0.5 every row
   *  used to carry), the `contentHash` this call computes to decide whether the write
   *  CORRECTED a belief, and `fileAnchors` naming the files it was read out of. */
  opts?: {
    expiresAt?: Date | null;
    originExecutionId?: number | null;
    origin?: FactOriginCost | null;
    /** Explicit weight; scored from the content when omitted. */
    importance?: number;
    kind?: FactImportance;
    /** Files the fact is about. `contentHash` is the file hash at write time. */
    fileAnchors?: FactFileAnchor[];
  },
): Promise<boolean> {
  const k = (key ?? '').trim().slice(0, 255);
  const c = (content ?? '').trim();
  if (!k || !c || !Number.isInteger(projectId) || projectId <= 0) return false;
  const expiresAt = opts?.expiresAt ?? null;
  const originExecutionId = opts?.originExecutionId ?? null;
  // Provenance is the execution id the caller already has, plus the model of that
  // run's own trace when the caller did not pass a triple. A missing id stays null.
  const origin = await resolveFactOrigin(db, tenantId, originExecutionId, opts?.origin);
  const originCost = originCostColumns(origin);
  // Content score, then a small lift from how often recall has already returned
  // this key. A brand-new key has no prior count, so it keeps the content score.
  let prior: Array<{ recallCount: number }> = [];
  try {
    const result = await db
      .select({ recallCount: projectFacts.recallCount })
      .from(projectFacts)
      .where(and(eq(projectFacts.tenantId, tenantId), eq(projectFacts.projectId, projectId), eq(projectFacts.key, k)))
      .limit(1);
    prior = result;
  } catch (err) {
    // A brand-new key has no prior count, which is the normal path here. A FAILED
    // count read is not, and it would flatter the fact: recallCount 0 skips the
    // recall-frequency lift. Report it rather than writing a belief whose
    // importance was computed from a stand-in zero.
    reportCaughtError(err, { source: 'project-facts', operation: 'prior-recall-count', level: 'warning', context: { tenantId, projectId } });
    prior = [] as Array<{ recallCount: number }>;
  }
  const recallCount = prior[0]?.recallCount ?? 0;
  const baseImportance = opts?.importance ?? factImportance(c, opts?.kind);
  const importance = clamp01(baseImportance + Math.min(0.1, recallCount * 0.01));
  // Stamped on every write, on BOTH branches below. This digest is what tells a
  // corrected belief from a re-assertion of the same one.
  const contentHash = await factContentHash(k, c);
  const fileAnchors = await stampAnchorHashes(db, tenantId, normalizeFileAnchors(opts?.fileAnchors));
  // Embed on write so the fact is semantically reachable on the next recall (1134).
  // Best-effort, and now actually so: the `catch` used to be MISSING, so a provider
  // error propagated out of this function and the belief was never written at all —
  // the exact opposite of what the comment below it claimed. Losing a write to an
  // embedding outage is the worse failure of the two; the vector is a cache.
  const now = new Date();
  const vector = toVectorLiteral(
    await embedMemoryText(env, memoryEmbeddingText(k, c)).catch((err: unknown) => {
      reportCaughtError(err, { source: 'project-facts', operation: 'embed-on-write', level: 'warning', context: { tenantId, projectId } });
      return null;
    }) ?? [],
  );
  const embeddingFields = vector
    ? { embedding: vector, embeddingModel: MEMORY_EMBEDDING_MODEL, embeddedAt: now }
    : { embedding: null, embeddingModel: null, embeddedAt: null };

  // Retire what this write CONTRADICTS, and do it BEFORE the new row lands — otherwise
  // both beliefs are live for the window between the two writes, which is the exact
  // replay this fixes. A fact whose content moved under the same anchor is the codebase
  // correcting itself, and the old row must stop being served. It is RETIRED, never
  // deleted, so "why did the agent believe this last month" stays answerable.
  //
  // Scoped to the ANCHOR, not the key, and that is the load-bearing choice: the whole
  // failure is two beliefs about one subject arriving under DIFFERENT keys, so matching
  // on the key would find nothing and leave both live forever. Same key + changed hash
  // is the other half, handled by the ON CONFLICT branch below, which replaces in
  // place rather than leaving a duplicate to retire.
  //
  // Best-effort, like everything else here: if the UPDATE fails the new belief still
  // gets written, and the worst case is the old one lingering — which is the state
  // this code ran in for months — rather than the write being lost.
  if (opts?.fileAnchors?.length) {
    const anchors = opts.fileAnchors.map((a) => a.path.trim().toLowerCase()).filter(Boolean);
    if (anchors.length) {
      await db
        .update(projectFacts)
        .set({ supersededBy: 0 })
        .where(and(
          scopedToTenant(projectFacts, tenantId),
          eq(projectFacts.projectId, projectId),
          isNull(projectFacts.supersededBy),
          ne(projectFacts.contentHash, contentHash),
          // `->0` is the FIRST anchor: one fact asserts one thing about one place, so
          // the first anchor identifies it without an array-containment operator that
          // cannot use an index.
          sql`lower(${projectFacts.fileAnchors}->0->>'path') IN (${sql.join(anchors.map((p) => sql`${p}`), sql`, `)})`,
        ))
        .catch((err: unknown) => {
          reportCaughtError(err, { source: 'project-facts', operation: 'supersede-by-anchor', level: 'warning', context: { tenantId, projectId } });
        });
    }
  }

  await db
    .insert(projectFacts)
    .values({ tenantId, projectId, key: k, content: c, source: source.slice(0, 64), expiresAt, originExecutionId, importance, contentHash, fileAnchors, ...originCost, ...embeddingFields })
    .onConflictDoUpdate({
      target: [projectFacts.tenantId, projectFacts.projectId, projectFacts.key],
      // A re-write REPLACES the governance metadata too: re-remembering a fact without
      // a TTL makes it durable again, which is the only reading of "update == replace"
      // that does not leave a stale expiry silently attached to fresh content. The
      // vector goes with it — an embedding of superseded content ranks the fact by
      // what it used to say.
      //
      // `supersededBy: null` REVIVES a retired row when someone re-asserts the belief:
      // a retirement is "this was contradicted", not "this is forbidden", and a fresh
      // assertion is exactly the evidence that it is live again.
      set: {
        content: c, source: source.slice(0, 64), expiresAt, importance, contentHash, fileAnchors, supersededBy: null, ...embeddingFields, updatedAt: now,
        // A rewrite that does not know its run must not wipe a stamp a previous write
        // recorded. Insert still writes null when nothing is known (values above).
        ...(originExecutionId != null ? { originExecutionId } : {}),
        ...(origin ? originCost : {}),
      },
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
    .catch((err: unknown) => {
      // Returning `false` on a FAILED DELETE would tell the caller the belief is gone
      // when it is still stored and will be recalled again — the one outcome worse
      // than an error. So the rejection is reported as an error (not a warning) and
      // the caller still gets its honest `false`, with the failure now visible.
      reportCaughtError(err, { source: 'project-facts', operation: 'delete-project-fact', level: 'error', context: { tenantId, projectId } });
      return [] as Array<{ id: string }>;
    });
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
    .catch((err: unknown) => {
      // Same contract as deleteProjectFact: a failed purge must not be counted as
      // "nothing to purge", or the caller stops believing the cache needs clearing.
      reportCaughtError(err, { source: 'project-facts', operation: 'purge-project-qa-cache', level: 'error', context: { tenantId, projectId } });
      return [] as Array<{ id: string }>;
    });
  if (removed.length > 0) await bumpCacheVersion(env, versionKey(tenantId, projectId));
  return removed.length;
}

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
/**
 * Reads the CURRENT content hash of one anchored file, so recall can tell a belief
 * whose anchor has since changed from one that still holds.
 *
 * Injected rather than imported: recall runs in the Worker, where there is no
 * filesystem, and the file store differs per surface (R2 canvas, container worktree,
 * on-prem disk). A caller that has a store passes a reader; a caller that does not —
 * including every existing one, and the unit tests — passes nothing, and an
 * unanchored-or-unread file is treated as NOT stale. Staleness is excluded, never
 * guessed.
 */
export type FileContentHashReader = (path: string) => Promise<string | null>;

/** One `{path, line?, contentHash?}` anchor as stored in the `file_anchors` jsonb. */
interface FileAnchor { path?: unknown; contentHash?: unknown }

/**
 * A fact is stale only when an anchor BOTH recorded the file's hash at write time
 * AND that file now hashes differently. No anchor, no recorded hash, or a reader
 * that cannot see the file (null) all mean "not stale" — a missing read must never
 * silently drop a belief.
 */
export async function anchorsAreStale(anchors: unknown, readHash: FileContentHashReader): Promise<boolean> {
  if (!Array.isArray(anchors)) return false;
  for (const anchor of anchors as FileAnchor[]) {
    const recorded = typeof anchor?.contentHash === 'string' ? anchor.contentHash : '';
    const path = typeof anchor?.path === 'string' ? anchor.path : '';
    if (!recorded || !path) continue;
    const current = await readHash(path).catch((err: unknown) => {
      // `null` here means "cannot tell", and the contract above is that not-tell is
      // never stale. Report it anyway: a persistently failing hash reader otherwise
      // looks identical to a project with no anchors, and every anchor in it goes
      // permanently un-checked.
      reportCaughtError(err, { source: 'project-facts', operation: 'anchor-hash-read', level: 'warning', context: { path } });
      return null;
    });
    if (current != null && current !== recorded) return true;
  }
  return false;
}

export async function recallProjectFacts(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  opts?: { query?: string; limit?: number; readFileHash?: FileContentHashReader },
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
        const ranked = fuseHybridArms<SemanticFactRow, SemanticFactRow, SemanticFactRow>({
          vector: semanticRows,
          text: lexicalRows,
          vectorScoreOf: (r) => r.score * (0.5 + r.importance),
          textScoreOf: (r) => (0.5 + r.importance),
          merge: (row) => row,
        });
        // With no query the semantic arm is empty, and a stable sort of a
        // constant-per-arm score preserves the SQL's importance-then-recency order.
        return ranked.slice(0, limit).map((row) => ({
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
    // excluded, so this changes no caller's current behaviour.
    const readHash = opts?.readFileHash;
    const kept: ProjectFact[] = [];
    for (const fact of live) {
      if (readHash && await anchorsAreStale(fact.fileAnchors, readHash)) continue;
      kept.push(fact);
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

/**
 * Expire facts recall has not returned within `windowMs` (1248).
 *
 * Same predicate as `decayUnrecalled`, with one guard that comment names: recall
 * stamps `last_recalled_at` first, and the sweep only then expires a missing
 * stamp. A column that has not been stamped yet is NULL on every row, and
 * treating that as "never recalled" would expire the whole project on the first
 * sweep. The NULL branch therefore requires that SOME row in this scope already
 * has a stamp. A fact recalled inside the window has a timestamp past the cutoff
 * and is not in either branch. Written as an EXPIRY, not a delete. `updated_at`
 * is not touched: a sweep is not a rewrite.
 */
export async function sweepUnrecalledFactDecay(
  db: Db,
  tenantId: number,
  projectId: number,
  opts?: { now?: Date; windowMs?: number },
): Promise<number> {
  const now = opts?.now ?? new Date();
  const windowMs = opts?.windowMs ?? UNRECALLED_DECAY_WINDOW_MS;
  if (!Number.isInteger(projectId) || projectId <= 0) return 0;
  if (!(windowMs > 0)) return 0;
  const cutoff = new Date(now.getTime() - windowMs);
  const expired = await db
    .update(projectFacts)
    .set({ expiresAt: now })
    .where(and(
      scopedToTenant(projectFacts, tenantId),
      eq(projectFacts.projectId, projectId),
      isNull(projectFacts.supersededBy),
      ne(projectFacts.source, QA_CACHE_SOURCE),
      or(
        // Recalled, and outside the window. A timestamp is evidence the column
        // has been stamped, so this branch is safe even on the first sweep.
        lt(projectFacts.lastRecalledAt, cutoff),
        // Never recalled — but only once a stamp exists in this scope. See the
        // comment on `decayUnrecalled`: calling the filter before that stamp
        // exists would expire every row.
        and(
          isNull(projectFacts.lastRecalledAt),
          sql`EXISTS (
            SELECT 1 FROM project_facts AS stamped_recall
            WHERE stamped_recall.tenant_id = ${tenantId}
              AND stamped_recall.project_id = ${projectId}
              AND stamped_recall.last_recalled_at IS NOT NULL
          )`,
        ),
      ),
      or(isNull(projectFacts.expiresAt), gt(projectFacts.expiresAt, now)),
    ))
    .returning({ key: projectFacts.key })
    .catch((err: unknown) => {
      // The sweep RETURNS this count. Zero is indistinguishable from "nothing
      // expired", so a failed delete must be reported — otherwise a systematically
      // failing sweep reports a clean bill of health forever and nothing ever decays.
      reportCaughtError(err, { source: 'project-facts', operation: 'sweep-unrecalled-fact-decay', level: 'error', context: { tenantId, projectId } });
      return [] as Array<{ key: string }>;
    });
  return expired.length;
}

/** Every (tenantId, projectId) that has facts, so a sweep can run without a
 *  caller-supplied project. Used by the cron entrypoint. */
export async function listProjectFactScopes(db: Db): Promise<Array<{ tenantId: number; projectId: number }>> {
  const rows = await db
    .selectDistinct({ tenantId: projectFacts.tenantId, projectId: projectFacts.projectId })
    .from(projectFacts)
    .catch((err: unknown) => {
      // The cron entrypoint decides WHICH SCOPES to sweep from this list. An empty
      // list on failure means the sweep silently does nothing and no fact anywhere in
      // the workspace ever decays, so this is an error, not a warning.
      reportCaughtError(err, { source: 'project-facts', operation: 'list-fact-scopes', level: 'error' });
      return [] as Array<{ tenantId: number; projectId: number }>;
    });
  return rows.filter((r) => Number.isInteger(r.tenantId) && Number.isInteger(r.projectId));
}

/** Decay across every project scope, for the scheduled sweep. */
export async function sweepAllUnrecalledFactDecay(
  db: Db,
  opts?: { now?: Date; windowMs?: number },
): Promise<number> {
  const scopes = await listProjectFactScopes(db);
  let expired = 0;
  for (const scope of scopes) {
    expired += await sweepUnrecalledFactDecay(db, scope.tenantId, scope.projectId, opts).catch((err: unknown) => {
      // The per-scope sweep already reports its own failure; this catch exists so one
      // broken tenant cannot abort the loop and leave every LATER scope undecayed.
      // Reporting keeps the reason visible instead of folding it into the total.
      reportCaughtError(err, { source: 'project-facts', operation: 'sweep-fact-decay-per-scope', level: 'error', context: { tenantId: scope.tenantId, projectId: scope.projectId } });
      return 0;
    });
  }
  return expired;
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
  // is for WRITE-side text. Identical to memoryService.ts:243.
  const vector = toVectorLiteral((await embedMemoryText(env, query)) ?? []);
  if (!vector) return [];
  const hits = await annRecallProject(db, tenantId, projectId, vector, limit, QA_CACHE_SOURCE);
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
  const scoreByKey = new Map(hits.map((h) => [h.key, h.vectorScore]));
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
 * Fetch a single fact's content by EXACT key (read-through cached, version-token
 * keyed like recall). Used by the Q&A cache short-circuit — an O(1) PK lookup that
 * decides "have we answered this exact question before?" without an LLM call.
 * Returns null when absent / pre-migration / invalid project.
 */
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
    const token = await getCacheVersion(env, versionKey(tenantId, projectId));
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
  opts?: { readFileHash?: FileContentHashReader },
): Promise<string> {
  const facts = await recallProjectFacts(env, db, tenantId, projectId, {
    ...(query != null ? { query } : {}),
    // Run-start default: a fact whose anchored files changed is excluded. Callers
    // that already have a reader (tests, a workspace walk) pass their own.
    readFileHash: opts?.readFileHash ?? hostDirectoryHashReader(db, tenantId),
  });
  return formatProjectFactsBlock(facts);
}
