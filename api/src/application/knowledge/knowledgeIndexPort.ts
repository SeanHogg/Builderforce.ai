/**
 * KnowledgeIndexPort — the ONE cloud vector engine (design: deterministic-knowledge-index.md,
 * WS4). Every cloud search — the project graph's `GET …/knowledge/search` and the durable
 * run's `semantic_search` over the repository — runs on memory's deterministic knowledge
 * index; the brute-force cosine loop `repoSymbolVectors.ts` used to carry is gone.
 *
 * An index is named by its scope and DIGEST of the document set, so it is immutable:
 *
 *   L1   `getOrSetCached` (in-isolate only — the blob is megabytes, KV is for small values)
 *   R2   knowledge-index/{namespace}/{rootId}/{digest}.bin   (`serialize()` bytes)
 *   miss build from the caller's documents → `upsert` → `compact()` → store in R2
 *
 * The project graph's namespace is `{tenant}/{project}`; the repository's is
 * `repo/{provider}/{host}/{owner}/{repo}` — tenant-free like the repo map itself, safe for
 * the same reason (a caller reaches it only after resolving the commit with its own token).
 */
import {
  createKnowledgeIndex, loadKnowledgeIndex, toCards, type EmbedderPort, type IndexDoc, type IndexHit,
  type IndexParams, type IndexTier, type KnowledgeIndex,
} from '@seanhogg/builderforce-memory/knowledge';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { getKnowledgeGraph, type KnowledgeGraphDeps } from './getKnowledgeGraph';

const SOURCE = 'application/knowledge/knowledgeIndexPort.ts';
/** A decoded index stays warm in the isolate this long. */
const INDEX_L1_TTL_MS = 10 * 60_000;

export interface KnowledgeIndexScope {
  namespace: string;
  rootId: string;
  /** Digest of the document set (and the embedder fingerprint) the index is built from. */
  digest: string;
}

export interface KnowledgeIndexPort {
  /** The index for `scope`, built from `docs()` on a cold miss. Null when there is nothing to index. */
  load(scope: KnowledgeIndexScope, docs: () => Promise<IndexDoc[]>): Promise<KnowledgeIndex | null>;
}

export function knowledgeIndexObjectKey(scope: KnowledgeIndexScope): string {
  const seg = (s: string) => encodeURIComponent(s);
  return `knowledge-index/${scope.namespace}/${seg(scope.rootId)}/${seg(scope.digest)}.bin`;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function readBlob(bucket: R2Bucket | undefined, key: string): Promise<Uint8Array | null> {
  if (!bucket) return null;
  try {
    const obj = await bucket.get(key);
    return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
  } catch (error) {
    // An unreadable blob is a cold miss: the index is rebuilt and stored again.
    reportCaughtError(error, { source: SOURCE, operation: 'readBlob', level: 'warning', context: { key } });
    return null;
  }
}

/**
 * `params` reach `createKnowledgeIndex` untouched, and no caller sets any today: the
 * engine's defaults govern — in particular `exactBelow` (2026.10.30: below it no graph is
 * built and dense search is an exact int8 scan, which keeps a Worker's compact cheap) and
 * `efConstruction`. Pass one only to change what the engine decides, never to restate it.
 */
export function r2KnowledgeIndexPort(
  env: Pick<Env, 'UPLOADS'>,
  embedder?: EmbedderPort,
  params?: Partial<IndexParams>,
): KnowledgeIndexPort {
  return {
    async load(scope, docs) {
      // Vectors of two fingerprints are never mixed: the embedder is part of the name.
      const tag = embedder ? embedder.fingerprint.replace(/[^\w.-]+/g, '_') : 'lexical';
      const key = knowledgeIndexObjectKey({ ...scope, digest: `${scope.digest}.${tag}` });
      const blob = await getOrSetCached<string | null>(undefined, `kidx:${key}`, async () => {
        const stored = await readBlob(env.UPLOADS, key);
        if (stored) return toBase64(stored);
        const cards = await docs();
        if (cards.length === 0) return null;
        const index = createKnowledgeIndex({ ...(embedder ? { embedder } : {}), ...(params ? { params } : {}) });
        await index.upsert(cards);
        await index.compact();
        const bytes = index.serialize();
        if (env.UPLOADS) {
          await env.UPLOADS.put(key, bytes).catch((error: unknown) => {
            // Still served from L1; a cold isolate rebuilds it.
            reportCaughtError(error, { source: SOURCE, operation: 'writeBlob', level: 'warning', context: { key } });
          });
        }
        return toBase64(bytes);
      }, { l1TtlMs: INDEX_L1_TTL_MS });
      return blob ? loadKnowledgeIndex(fromBase64(blob), embedder) : null;
    },
  };
}

export interface KnowledgeSearchResult {
  hits: IndexHit[];
  tiers: IndexTier[];
  digest: string;
}

/** Search one root's knowledge (the search route): the graph's cards, indexed per graph digest. */
export async function searchKnowledge(
  deps: { graph: KnowledgeGraphDeps; index: KnowledgeIndexPort },
  q: { rootId: string; query: string; k: number },
): Promise<KnowledgeSearchResult | null> {
  // The widest graph the server builds: search reaches every node it renders and more.
  const graph = await getKnowledgeGraph(deps.graph, { rootId: q.rootId, maxNodes: Number.MAX_SAFE_INTEGER });
  if (!graph) return null;
  const index = await deps.index.load(
    { namespace: `${deps.graph.tenantId}/${deps.graph.projectId}`, rootId: q.rootId, digest: graph.scope.digest },
    async () => toCards(graph),
  );
  if (!index) return { hits: [], tiers: [], digest: graph.scope.digest };
  return { hits: await index.search(q.query, { k: q.k }), tiers: index.tiers(), digest: index.digest() };
}
