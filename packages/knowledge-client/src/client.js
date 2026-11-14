import { errorOf } from './httpError.js';
import { createSyncClient } from './syncClient.js';
import { KnowledgeApiError, } from './types.js';
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** `Retry-After` in seconds, from the header or `null` when absent/unusable. */
function retryAfterMs(res) {
    const raw = res.headers.get('retry-after');
    if (raw == null)
        return null;
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds < 0)
        return null;
    return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
}
export function createKnowledgeClient(opts) {
    const base = `${(opts.basePath ?? DEFAULT_KNOWLEDGE_BASE_PATH).replace(/\/+$/, '')}/${opts.projectId}`;
    const call = async (path, init) => {
        let res;
        try {
            res = await opts.fetch(`${base}${path}`, init);
        }
        catch (error) {
            throw new KnowledgeApiError(0, 'network', error instanceof Error ? error.message : String(error));
        }
        if (!res.ok)
            throw await errorOf(res);
        return res;
    };
    /**
     * `call` with bounded retry on HTTP 429: honors the `Retry-After` header (seconds, capped
     * at 5s), at most 3 retries. Only for idempotent knowledge/extracted GET and bulk POSTs —
     * never for the judge POST (a retried judgement could double-bill).
     */
    const callRetried = async (path, init) => {
        for (let attempt = 0;; attempt++) {
            let res;
            try {
                res = await opts.fetch(`${base}${path}`, init);
            }
            catch (error) {
                throw new KnowledgeApiError(0, 'network', error instanceof Error ? error.message : String(error));
            }
            if (res.ok)
                return res;
            if (res.status === 429 && attempt < MAX_429_RETRIES) {
                await sleep(retryAfterMs(res) ?? 0);
                continue;
            }
            throw await errorOf(res);
        }
    };
    const jsonCall = async (path, init) => (await call(path, init)).json();
    /** `jsonCall` over `callRetried` (429-resilient). */
    const jsonCallRetried = async (path, init) => (await callRetried(path, init)).json();
    const send = (method, body) => ({
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    /** `null` on 404 (unknown root / hash) — every other failure throws. */
    const orNull = async (p) => {
        try {
            return await p;
        }
        catch (error) {
            if (error instanceof KnowledgeApiError && error.status === 404)
                return null;
            throw error;
        }
    };
    const graph = async (rootId, q) => {
        const params = new URLSearchParams({ root: rootId });
        for (const f of q?.focus ?? [])
            params.append('focus', f);
        if (q?.maxNodes != null)
            params.set('maxNodes', String(q.maxNodes));
        if (q?.at)
            params.set('at', q.at);
        const out = await orNull(jsonCall(`/knowledge-graph?${params.toString()}`));
        return out?.graph ?? null;
    };
    /** The stored relations of a root's graph. */
    const relationsOf = async (scope) => {
        const g = await graph(scope.rootId, { maxNodes: STORE_READ_MAX_NODES });
        if (!g)
            return [];
        return g.edges
            .filter((e) => e.origin !== 'extracted' && e.kind !== 'about')
            .map((e) => ({
            from: e.from, to: e.to, kind: e.kind, weight: e.weight, origin: e.origin,
            ...(e.confidence !== undefined ? { confidence: e.confidence } : {}),
        }));
    };
    /** The root's stored facts (author + origin) and the viewer; null for an unknown root. */
    const facts = async (rootId) => {
        const out = await orNull(jsonCall(`/knowledge/facts?${new URLSearchParams({ root: rootId }).toString()}`));
        if (!out)
            return null;
        return {
            facts: (out.facts ?? []).map((f) => ({ ...f, createdBy: f.createdBy ?? null })),
            viewer: { userId: out.viewer?.userId ?? null, canAdmin: out.viewer?.canAdmin === true },
        };
    };
    const scopes = async () => (await jsonCall('/knowledge/scopes')).scopes;
    const judgeEstimate = async () => {
        const out = await jsonCall('/knowledge/judge/estimate');
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
    const extractedCache = new Map();
    // The client store is the READ-THROUGH only (relations + the extracted cache); every write goes through a pack or `writeRows`.
    const store = {
        relations: relationsOf,
        getExtracted: async (hash) => {
            if (extractedCache.has(hash))
                return extractedCache.get(hash);
            const out = await orNull(jsonCallRetried(`/knowledge/extracted/${encodeURIComponent(hash)}`));
            return out?.extracted;
        },
        /**
         * Best-effort bulk hint: POSTs the hashes to `/knowledge/extracted/bulk` in chunks of
         * ~200 and caches every returned entry (including nulls = cache misses) by hash. NEVER
         * throws — on any failure the cache simply stays empty for those hashes and per-file
         * `getExtracted` remains the fallback.
         */
        preloadExtracted: async (hashes) => {
            try {
                const distinct = [...new Set(hashes)];
                for (let i = 0; i < distinct.length; i += PRELOAD_CHUNK) {
                    const chunk = distinct.slice(i, i + PRELOAD_CHUNK);
                    const out = await orNull(jsonCallRetried('/knowledge/extracted/bulk', send('POST', { hashes: chunk })));
                    for (const row of out?.extracted ?? []) {
                        extractedCache.set(row.hash, row.entries ?? undefined);
                    }
                }
            }
            catch {
                // Best-effort by contract: a failed preload must not abort the review.
            }
        },
    };
    return {
        store,
        judgement: {
            judge: (req) => {
                const post = (clientResult) => jsonCall('/knowledge/judge', {
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
            if (k != null)
                params.set('k', String(k));
            const out = await orNull(jsonCall(`/knowledge/search?${params.toString()}`));
            return out?.hits ?? [];
        },
        async writeRows(rootId, rows) {
            await call('/knowledge/write', send('POST', { root: rootId, facts: rows.facts, relations: rows.relations }));
        },
        ...createSyncClient(base, (url, init) => opts.fetch(url, init)),
        async putAnalysis(sha, snapshot) {
            await call(`/code-analysis/${encodeURIComponent(sha)}`, send('PUT', snapshot));
        },
        async deleteFact(key) {
            await call(`/facts/${encodeURIComponent(key)}`, { method: 'DELETE' });
        },
        async deleteRoot(rootId) {
            await call(`/knowledge/scopes/${encodeURIComponent(rootId)}`, { method: 'DELETE' });
        },
    };
}
//# sourceMappingURL=client.js.map