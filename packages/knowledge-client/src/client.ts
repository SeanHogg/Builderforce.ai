/**
 * The knowledge API client (PRD 38 §4.8) — `createKnowledgeClient(opts)`.
 *
 * Every host (web, VS Code, Rovr, on-prem) passes its own authenticated `fetch`; this
 * module owns only paths, payload shapes, bounds and error mapping.
 *
 * The knowledge API:
 *   scopes()          GET  …/knowledge/scopes
 *   facts(root)       GET  …/knowledge/facts?root=  → the root's stored facts, with author
 *                     (`createdBy`) and origin, read in one cached store query
 *   store.relations   GET  …/knowledge-graph?root=  → the stored relations it joined
 *   writeRows(…)      POST …/knowledge/write of rows only; every other write is a pack
 *   judgeEstimate()   GET  …/knowledge/judge/estimate → ≈ USD of one judged section (+ local)
 *   getExtracted      GET  …/knowledge/extracted/:hash (404 → undefined)
 *   preloadExtracted  POST …/knowledge/extracted/bulk in chunks of PRELOAD_CHUNK hashes —
 *                     a best-effort hint: returned entries are cached per hash and
 *                     `getExtracted` then answers without a round trip; it NEVER throws,
 *                     per-file getExtracted stays the fallback
 *   sync*             POST …/knowledge/sync (one BFKP pack or one part), GET/POST …/sync/manifest, POST …/sync/have
 *                     — the replica pump's ONLY upload path (PRD 41 A11); 409/413/422 are typed errors
 *
 * `relations` are read back from the server-built graph (edges whose origin is stored),
 * since the server is the only reader of the tables — what a re-review needs to re-anchor
 * unchanged sections, not a full table dump.
 *
 * Every path sits under `basePath` (default `/api/projects`, the tenant-JWT door); an
 * on-prem host passes `/api/agent/projects`, the agent-host key door, where the same
 * routes are mounted.
 */
import type {
  Extracted,
  IndexHit,
  JudgementRequest,
  JudgementResult,
  KnowledgeGraph,
  Scope,
  StoredRelation,
} from '@seanhogg/builderforce-memory/knowledge';
import { errorOf } from './httpError.js';
import { createSyncClient } from './syncClient.js';
import {
  KnowledgeApiError,
  type AnalysisSnapshotPayload,
  type GraphQuery,
  type JudgeEstimate,
  type KnowledgeFacts,
  type KnowledgeClient,
  type KnowledgeClientStore,
  type KnowledgeClientOptions,
  type KnowledgeScopeRecord,
} from './types.js';

/** The tenant-JWT door; on-prem passes the agent-host door instead. */
export const DEFAULT_KNOWLEDGE_BASE_PATH = '/api/projects';
/** The widest graph the server builds; `relations` read it. */
const STORE_READ_MAX_NODES = 2000;
/** Hashes per `preloadExtracted` bulk call. */
const PRELOAD_CHUNK = 200;
/** Bounded retry on HTTP 429 (rate limited): at most this many retries, delay capped below. */
const MAX_429_RETRIES = 3;
/** Upper bound (ms) for the Retry-After-derived 429 backoff. */
const MAX_RETRY_DELAY_MS = 5000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** `Retry-After` in seconds, from the header or `null` when absent/unusable. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (raw == null) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
}

export function createKnowledgeClient(opts: KnowledgeClientOptions): KnowledgeClient {
  const base = `${(opts.basePath ?? DEFAULT_KNOWLEDGE_BASE_PATH).replace(/\/+$/, '')}/${opts.projectId}`;

  const call = async (path: string, init?: RequestInit): Promise<Response> => {
    let res: Response;
    try {
      res = await opts.fetch(`${base}${path}`, init);
    } catch (error) {
      throw new KnowledgeApiError(0, 'network', error instanceof Error ? error.message : String(error));
    }
    if (!res.ok) throw await errorOf(res);
    return res;
  };

  /**
   * `call` with bounded retry on HTTP 429: honors the `Retry-After` header (seconds, capped
   * at 5s), at most 3 retries. Only for idempotent knowledge/extracted GET and bulk POSTs —
   * never for the judge POST (a retried judgement could double-bill).
   */
  const callRetried = async (path: string, init?: RequestInit): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await opts.fetch(`${base}${path}`, init);
      } catch (error) {
        throw new KnowledgeApiError(0, 'network', error instanceof Error ? error.message : String(error));
      }
      if (res.ok) return res;
      if (res.status === 429 && attempt < MAX_429_RETRIES) {
        await sleep(retryAfterMs(res) ?? 0);
        continue;
      }
      throw await errorOf(res);
    }
  };

  const jsonCall = async <T>(path: string, init?: RequestInit): Promise<T> => (await call(path, init)).json() as Promise<T>;

  /** `jsonCall` over `callRetried` (429-resilient). */
  const jsonCallRetried = async <T>(path: string, init?: RequestInit): Promise<T> => (await callRetried(path, init)).json() as Promise<T>;

  const send = (method: 'POST' | 'PUT', body: unknown): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  /** `null` on 404 (unknown root / hash) — every other failure throws. */
  const orNull = async <T>(p: Promise<T>): Promise<T | null> => {
    try {
      return await p;
    } catch (error) {
      if (error instanceof KnowledgeApiError && error.status === 404) return null;
      throw error;
    }
  };

  const graph = async (rootId: string, q?: GraphQuery): Promise<KnowledgeGraph | null> => {
    const params = new URLSearchParams({ root: rootId });
    for (const f of q?.focus ?? []) params.append('focus', f);
    if (q?.maxNodes != null) params.set('maxNodes', String(q.maxNodes));
    if (q?.at) params.set('at', q.at);
    const out = await orNull(jsonCall<{ graph: KnowledgeGraph }>(`/knowledge-graph?${params.toString()}`));
    return out?.graph ?? null;
  };

  /** The stored relations of a root's graph. */
  const relationsOf = async (scope: Scope): Promise<StoredRelation[]> => {
    const g = await graph(scope.rootId, { maxNodes: STORE_READ_MAX_NODES });
    if (!g) return [];
    return g.edges
      .filter((e) => e.origin !== 'extracted' && e.kind !== 'about')
      .map((e) => ({
        from: e.from, to: e.to, kind: e.kind, weight: e.weight, origin: e.origin as StoredRelation['origin'],
        ...(e.confidence !== undefined ? { confidence: e.confidence } : {}),
      }));
  };

  /** The root's stored facts (author + origin) and the viewer; null for an unknown root. */
  const facts = async (rootId: string): Promise<KnowledgeFacts | null> => {
    const out = await orNull(jsonCall<KnowledgeFacts>(`/knowledge/facts?${new URLSearchParams({ root: rootId }).toString()}`));
    if (!out) return null;
    return {
      facts: (out.facts ?? []).map((f) => ({ ...f, createdBy: f.createdBy ?? null })),
      viewer: { userId: out.viewer?.userId ?? null, canAdmin: out.viewer?.canAdmin === true },
    };
  };

  const scopes = async (): Promise<KnowledgeScopeRecord[]> => (await jsonCall<{ scopes: KnowledgeScopeRecord[] }>('/knowledge/scopes')).scopes;

  const judgeEstimate = async (): Promise<JudgeEstimate> => {
    const out = await jsonCall<Partial<JudgeEstimate>>('/knowledge/judge/estimate');
    return {
      // Shape only: whether a number is a usable price is `reviewCostOf`'s rule, in ONE place.
      perCallUsd: typeof out.perCallUsd === 'number' ? out.perCallUsd : null,
      model: typeof out.model === 'string' ? out.model : null,
      local: out.local === true,
    };
  };

  // ---------------------------------------------------------------------------
  // Extracted cache: `preloadExtracted` fills it from the bulk route; `getExtracted`
  // answers a cached hash (including cached misses) without a round trip.
  // ---------------------------------------------------------------------------
  const extractedCache = new Map<string, Extracted[] | undefined>();

  // The client store is the READ-THROUGH only (relations + the extracted cache); every write goes through a pack or `writeRows`.
  const store: KnowledgeClientStore = {
      relations: relationsOf,
      getExtracted: async (hash) => {
        if (extractedCache.has(hash)) return extractedCache.get(hash);
        const out = await orNull(jsonCallRetried<{ extracted: Extracted[] }>(`/knowledge/extracted/${encodeURIComponent(hash)}`));
        return out?.extracted;
      },
      /**
       * Best-effort bulk hint: POSTs the hashes to `/knowledge/extracted/bulk` in chunks of
       * ~200 and caches every returned entry (including nulls = cache misses) by hash. NEVER
       * throws — on any failure the cache simply stays empty for those hashes and per-file
       * `getExtracted` remains the fallback.
       */
      preloadExtracted: async (hashes: readonly string[]) => {
        try {
          const distinct = [...new Set(hashes)];
          for (let i = 0; i < distinct.length; i += PRELOAD_CHUNK) {
            const chunk = distinct.slice(i, i + PRELOAD_CHUNK);
            const out = await orNull(jsonCallRetried<{ extracted: Array<{ hash: string; entries: Extracted[] | null }> }>(
              '/knowledge/extracted/bulk',
              send('POST', { hashes: chunk }),
            ));
            for (const row of out?.extracted ?? []) {
              extractedCache.set(row.hash, row.entries ?? undefined);
            }
          }
        } catch {
          // Best-effort by contract: a failed preload must not abort the review.
        }
      },
  };

  return {
    store,
    judgement: {
      judge: (req: JudgementRequest): Promise<JudgementResult> => {
        const post = (clientResult?: unknown) =>
          jsonCall<JudgementResult>('/knowledge/judge', {
            ...send('POST', { kind: req.kind, items: req.items, ...(clientResult ? { clientResult } : {}) }),
            ...(req.signal ? { signal: req.signal } : {}),
          });
        return opts.judgeClientFirst ? opts.judgeClientFirst(req, post) : post();
      },
    },
    scopes,
    judgeEstimate,
    graph,
    facts,
    async search(rootId, q, k) {
      const params = new URLSearchParams({ root: rootId, q });
      if (k != null) params.set('k', String(k));
      const out = await orNull(jsonCall<{ hits: IndexHit[] }>(`/knowledge/search?${params.toString()}`));
      return out?.hits ?? [];
    },
    async writeRows(rootId, rows) {
      await call('/knowledge/write', send('POST', { root: rootId, facts: rows.facts, relations: rows.relations }));
    },
    ...createSyncClient(base, (url, init) => opts.fetch(url, init)),
    async putAnalysis(sha: string, snapshot: AnalysisSnapshotPayload) {
      await call(`/code-analysis/${encodeURIComponent(sha)}`, send('PUT', snapshot));
    },
    async deleteFact(key: string) {
      await call(`/facts/${encodeURIComponent(key)}`, { method: 'DELETE' });
    },
    async deleteRoot(rootId: string) {
      await call(`/knowledge/scopes/${encodeURIComponent(rootId)}`, { method: 'DELETE' });
    },
  };
}
