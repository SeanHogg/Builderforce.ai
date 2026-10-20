/**
 * projectFacts STORE primitives — the shared, per-PROJECT write-through FACTS store
 * (migration 0276): the row shapes, the per-(tenant,project) version token every
 * cached read keys on, the importance / content-hash scoring, file anchors and the
 * origin-cost provenance a write stamps.
 *
 * This is the "knowledge tier" half of Evermind ([[evermind-learning-architecture]]):
 * durable BELIEFS that every surface reads AND writes in the SAME place. The store is
 * split along its seams — this module (primitives), `projectFactsWrite` (upsert /
 * delete), `projectFactsRecall` (recall + the prompt block), `projectFactsAnswerCache`
 * (the memory-first Q&A cache rows) and `projectFactsDecay` (the unrecalled-decay
 * sweep). All governed by application/memory/memoryService (scope chain, provenance,
 * TTL): an agent write goes through that service, never directly here.
 */
import { and, desc, eq } from 'drizzle-orm';
import { agentHostDirectoryFiles, llmTraces } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { sha256Hex } from '../../domain/shared/hash';
import { reportCaughtError } from '../observability/caughtErrorReporter';

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

/** Bump this project's fact-store version — every write calls it, so no cached read
 *  (recall, the exact-key Q&A replay, memoryService's union) serves a stale set. */
export async function bumpProjectFactsVersion(env: Env, tenantId: number, projectId: number): Promise<void> {
  await bumpCacheVersion(env, versionKey(tenantId, projectId));
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
export async function stampAnchorHashes(
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

/** The origin-cost columns for a write — all three or none, so a half-known cost is
 *  never recorded as if it were a figure. */
export function originCostColumns(origin: FactOriginCost | null | undefined): {
  originModel: string | null; originPromptTokens: number | null; originCompletionTokens: number | null;
} {
  const ok = origin && origin.model.trim()
    && Number.isFinite(origin.promptTokens) && origin.promptTokens >= 0
    && Number.isFinite(origin.completionTokens) && origin.completionTokens >= 0;
  return ok
    ? { originModel: origin.model.trim().slice(0, 200), originPromptTokens: Math.round(origin.promptTokens), originCompletionTokens: Math.round(origin.completionTokens) }
    : { originModel: null, originPromptTokens: null, originCompletionTokens: null };
}
