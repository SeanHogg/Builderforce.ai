/**
 * The knowledge API client (PRD 38 §4.8) — `createKnowledgeClient(opts)`.
 *
 * Every host (web, VS Code, Rovr, on-prem) passes its own authenticated `fetch`; this
 * module owns only paths, payload shapes, bounds and error mapping.
 *
 * KnowledgeStore over the API:
 *   scopes()          GET  …/knowledge/scopes
 *   facts(scope)      GET  …/knowledge/facts?root=  → the root's stored facts, with author
 *                     (`createdBy`) and origin, read in one cached store query
 *   relations(scope)  GET  …/knowledge-graph?root=  → the stored relations it joined
 *   write(batch)      POST …/knowledge/write, chunked into ≤ 500 rows per call; the scope
 *                     row (and its digest) rides on the LAST chunk only, so a failed
 *                     upload never records a digest for a half-written review
 *   markStale(…)      POST …/knowledge/write { stale: [{ sourceRef, currentHash }] } —
 *                     server-side, in the single writer: model relations judged from another
 *                     hash get `stale_at`, and the source's own object records its current hash
 *                     ('' = removed). Model FACTS are not marked: their staleness is derived
 *                     at graph build from the anchor hash vs the source's current hash.
 *   judgeEstimate()   GET  …/knowledge/judge/estimate → ≈ USD of one judged section (+ local)
 *   getExtracted      GET  …/knowledge/extracted/:hash (404 → undefined)
 *   putExtracted      PUT  …/knowledge/extracted/:hash — a 413 (payload_too_large) is SKIPPED
 *                     and listed on `store.skipped` ({path, bytes, reason}), never thrown; a 400
 *                     source_hash_mismatch still throws
 *   preloadExtracted  POST …/knowledge/extracted/bulk in chunks of PRELOAD_CHUNK hashes —
 *                     a best-effort hint: returned entries are cached per hash and
 *                     `getExtracted` then answers without a round trip; it NEVER throws,
 *                     per-file getExtracted stays the fallback
 *   batched(work)     identity — the server is the single writer and `write()` already puts
 *                     the scope on the last chunk, so there is nothing to flush locally
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
  KnowledgeStore,
  NodeRef,
  Scope,
  ScopeRecord,
  StoredFact,
  StoredRelation,
} from '@seanhogg/builderforce-memory/knowledge';
import {
  KnowledgeApiError,
  type AnalysisSnapshotPayload,
  type GraphQuery,
  type JudgeEstimate,
  type KnowledgeFacts,
  type KnowledgeClient,
  type KnowledgeClientOptions,
  type KnowledgeScopeRecord,
  type SkippedUpload,
} from './types.js';

/** Rows (facts + relations + stale marks) one write call carries — the server's bound. */
export const MAX_WRITE_ROWS = 500;
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

type Row =
  | { t: 'fact'; v: StoredFact }
  | { t: 'relation'; v: StoredRelation };

async function errorOf(res: Response): Promise<KnowledgeApiError> {
  let code = `http_${res.status}`;
  let message = `knowledge API ${res.status}`;
  try {
    const body = (await res.json()) as { error?: unknown; code?: unknown };
    if (typeof body?.code === 'string') code = body.code;
    if (typeof body?.error === 'string') message = body.error;
  } catch {
    // A non-JSON error body keeps the status-derived code and message.
  }
  return new KnowledgeApiError(res.status, code, message);
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
   * at 5s), at most 3 retries. Only for idempotent knowledge/extracted GET/PUT and bulk POSTs —
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

  const write = async (batch: { scope?: ScopeRecord; facts?: readonly StoredFact[]; relations?: readonly StoredRelation[] }): Promise<void> => {
    const rows: Row[] = [
      ...(batch.facts ?? []).map((v): Row => ({ t: 'fact', v })),
      ...(batch.relations ?? []).map((v): Row => ({ t: 'relation', v })),
    ];
    const chunks: Row[][] = [];
    for (let i = 0; i < rows.length; i += MAX_WRITE_ROWS) chunks.push(rows.slice(i, i + MAX_WRITE_ROWS));
    if (chunks.length === 0) chunks.push([]);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const last = i === chunks.length - 1;
      await call('/knowledge/write', send('POST', {
        // The root rides EVERY chunk (the scope only the last): it is what a pack upload is
        // stamped and fenced by on the server.
        ...(batch.scope ? { root: batch.scope.rootId } : {}),
        ...(last && batch.scope ? { scope: batch.scope } : {}),
        facts: chunk.filter((r) => r.t === 'fact').map((r) => r.v),
        relations: chunk.filter((r) => r.t === 'relation').map((r) => r.v),
      }));
    }
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

  const putExtracted = async (hash: string, extracted: Extracted[]): Promise<void> => {
    try {
      await callRetried(`/knowledge/extracted/${encodeURIComponent(hash)}`, send('PUT', extracted));
    } catch (error) {
      // payload_too_large: the file's extracted output exceeds the server's 1MB bound. Skip and
      // count — the review keeps going and the file's facts are still written. Anything else
      // (e.g. 400 source_hash_mismatch) still throws.
      if (error instanceof KnowledgeApiError && error.status === 413) {
        // Named by the file's source ref (the extracted entries carry it), sized in encoded bytes.
        skipped.push({
          path: extracted[0]?.sourceRef ?? `extracted/${hash}`,
          bytes: new TextEncoder().encode(JSON.stringify(extracted)).length,
          reason: 'too-large',
        });
        return;
      }
      throw error;
    }
  };

  // ---------------------------------------------------------------------------
  // Extracted cache: `preloadExtracted` fills it from the bulk route; `getExtracted`
  // answers a cached hash (including cached misses) without a round trip.
  // ---------------------------------------------------------------------------
  const extractedCache = new Map<string, Extracted[] | undefined>();
  const skipped: SkippedUpload[] = [];

  // The client store exposes KnowledgeStore plus the skipped-upload list (not part of the
  // interface — a host reads it for progress/reporting and sync status).
  const store: KnowledgeStore & {
    readonly skipped: readonly SkippedUpload[];
    readonly preloadExtracted: (hashes: readonly string[]) => Promise<void>;
    batched: <T>(work: (flush: () => Promise<void>) => Promise<T>) => Promise<T>;
  } = {
    scopes,
      facts: async (scope) => (await facts(scope.rootId))?.facts ?? [],
      relations: relationsOf,
      write: (batch) => write(batch),
      markStale: async (_scope: Scope, sourceRef: NodeRef, currentHash: string) => {
        await call('/knowledge/write', send('POST', { facts: [], relations: [], stale: [{ sourceRef, currentHash }] }));
      },
      getExtracted: async (hash) => {
        if (extractedCache.has(hash)) return extractedCache.get(hash);
        const out = await orNull(jsonCallRetried<{ extracted: Extracted[] }>(`/knowledge/extracted/${encodeURIComponent(hash)}`));
        return out?.extracted;
      },
      putExtracted,
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
      /**
       * Identity: the server is the single writer and `write()` already rides the scope on the
       * last chunk, so there is nothing to flush or bound locally — `work` runs as-is.
       */
      batched: async <T>(work: (flush: () => Promise<void>) => Promise<T>): Promise<T> => work(async () => {}),
      /** `putExtracted` calls skipped, with path, size and reason (413 => 'too-large'). */
      get skipped(): readonly SkippedUpload[] {
        return skipped;
      },
  };

  return {
    store,
    get skipped(): readonly SkippedUpload[] {
      return skipped;
    },
    judgement: {
      judge: (req: JudgementRequest): Promise<JudgementResult> =>
        jsonCall<JudgementResult>('/knowledge/judge', {
          ...send('POST', { kind: req.kind, items: req.items }),
          ...(req.signal ? { signal: req.signal } : {}),
        }),
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
    async putAnalysis(sha: string, snapshot: AnalysisSnapshotPayload) {
      await call(`/code-analysis/${encodeURIComponent(sha)}`, send('PUT', snapshot));
    },
    putExtracted,
    async deleteFact(key: string) {
      await call(`/facts/${encodeURIComponent(key)}`, { method: 'DELETE' });
    },
    async deleteRoot(rootId: string) {
      await call(`/knowledge/scopes/${encodeURIComponent(rootId)}`, { method: 'DELETE' });
    },
  };
}
