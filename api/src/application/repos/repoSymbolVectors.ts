/**
 * Dense vectors for the cloud repo map's definitions — the embedding arm of durable
 * `semantic_search` (operator decision 2026-10-23: dense search on durable runs, at the
 * cheapest cost that serves it).
 *
 * What keeps it nearly free:
 *   • the model is bge-m3 on Workers AI (`MEMORY_VECTOR_SPACES.bge_m3`, the account's free
 *     quota). No Workers AI credential → no index, and search stays keyword-only;
 *   • nothing is embedded on a commit. The first `semantic_search` that needs vectors
 *     embeds what is missing, so a repository nobody searches costs nothing;
 *   • a definition is embedded once per TEXT (path + signature line), and the vectors are
 *     stored per repository, not per commit — a new commit re-embeds only the definitions
 *     it changed;
 *   • the index covers the {@link MAX_DENSE_DEFINITIONS} definitions in the files the rest
 *     of the code depends on most (file PageRank), top-level ones first, stored as int8.
 *
 * One embedding pass is bounded by {@link EMBED_BUDGET_MS}; what it did not reach is
 * embedded by the next search, and the vectors written so far are kept.
 *
 * SEARCH is not here. The definitions with a vector are indexed by the ONE cloud vector
 * engine, {@link KnowledgeIndexPort} (memory's deterministic knowledge index: int8 graph
 * traversal, float rerank, one total order), as the repository root's documents. The
 * stored vectors above are that index's embedding cache, so building it costs no Workers
 * AI call; only the query is embedded.
 */

import type { MapSymbol, RepoGraph } from '@builderforce/repo-map';
import { sha256Hex, type IndexDoc } from '@seanhogg/builderforce-memory/knowledge';
import type { Env } from '../../env';
import { fnv1a32 } from '../../domain/shared/strings';
import { MEMORY_VECTOR_SPACES, embedMemoryTexts, type EmbeddingEnv } from '../memory/memoryEmbedding';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { bgeM3Embedder } from '../knowledge/knowledgeEmbedder';
import { r2KnowledgeIndexPort } from '../knowledge/knowledgeIndexPort';
import { repoVectorsObjectKey, type RepoMapKeyParts } from './repoMapStore';

const SOURCE = 'application/repos/repoSymbolVectors.ts';
const SPACE = MEMORY_VECTOR_SPACES.bge_m3;
const VECTORS_VERSION = 1;

/** Definitions the dense arm covers — 6k × 1024 int8 ≈ 6 MB per repository. */
export const MAX_DENSE_DEFINITIONS = 6_000;
/** Texts per Workers AI call. */
const EMBED_BATCH = 96;
/** Calls in flight at once during one pass. */
const EMBED_CONCURRENCY = 4;
/** Wall clock one search may spend embedding before it answers with what it has. */
export const EMBED_BUDGET_MS = 8_000;
/** Decoded repositories kept per isolate. */
const L1_MAX_ENTRIES = 2;

export type RepoVectorsEnv = Pick<Env, 'UPLOADS'> & EmbeddingEnv;

/** The stored object: definition-text hash → base64 int8 vector (unit length × 127). */
interface StoredVectors {
  version: typeof VECTORS_VERSION;
  model: string;
  dims: number;
  entries: Record<string, string>;
}

/** A definition's document id in the repository index — the same identity `fuseDefinitionHits` uses. */
export function definitionId(s: MapSymbol): string {
  return `${s.path}:${s.line}:${s.name}`;
}

/** The text a definition is embedded as — the path carries meaning the signature assumes. */
export function definitionText(s: MapSymbol): string {
  return `${s.path}\n${s.signature}`;
}

/** 64-bit content id of a definition text (two independent FNV-1a lanes). */
export function definitionHash(text: string): string {
  return `${fnv1a32(text).toString(36)}.${fnv1a32(text, 0x9747b28c).toString(36)}`;
}

/** Unit-normalise and quantise to int8, so a dot product of two is cosine × 127². */
export function quantize(vector: readonly number[]): Int8Array {
  let norm = 0;
  for (const x of vector) norm += x * x;
  const scale = norm > 0 ? 127 / Math.sqrt(norm) : 0;
  const out = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = Math.max(-127, Math.min(127, Math.round(vector[i]! * scale)));
  return out;
}

function toBase64(bytes: Int8Array): string {
  const u = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!);
  return btoa(s);
}

function fromBase64(text: string): Int8Array {
  const s = atob(text);
  const out = new Int8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = (s.charCodeAt(i) << 24) >> 24;
  return out;
}

/** The definitions the dense arm covers: top-level before nested, then by file rank. */
export function denseCandidates(graph: RepoGraph, cap: number = MAX_DENSE_DEFINITIONS): MapSymbol[] {
  const rank = graph.graph.pagerank(new Array<number>(graph.graph.length).fill(1));
  const rankOf = (s: MapSymbol): number => rank[graph.graph.indexOf(s.path) ?? -1] ?? 0;
  return [...graph.symbols]
    .sort((a, b) => Number(a.nested) - Number(b.nested) || rankOf(b) - rankOf(a) || a.path.localeCompare(b.path) || a.line - b.line)
    .slice(0, cap);
}

const l1 = new Map<string, Map<string, Int8Array>>();
const inFlight = new Map<string, Promise<RepoSymbolIndex | null>>();

function rememberL1(key: string, vectors: Map<string, Int8Array>): void {
  l1.delete(key);
  l1.set(key, vectors);
  while (l1.size > L1_MAX_ENTRIES) {
    const oldest = l1.keys().next().value;
    if (oldest === undefined) break;
    l1.delete(oldest);
  }
}

/** Test seam: forget every decoded repository. */
export function clearRepoVectorsL1(): void {
  l1.clear();
  inFlight.clear();
}

async function readStored(bucket: R2Bucket, key: string): Promise<Map<string, Int8Array>> {
  try {
    const obj = await bucket.get(key);
    if (!obj) return new Map();
    const parsed = (await obj.json()) as StoredVectors;
    if (parsed?.version !== VECTORS_VERSION || parsed.model !== SPACE.model || parsed.dims !== SPACE.dims) return new Map();
    return new Map(Object.entries(parsed.entries).map(([hash, b64]) => [hash, fromBase64(b64)]));
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'readStored', level: 'warning', context: { key } });
    return new Map();
  }
}

async function writeStored(bucket: R2Bucket, key: string, vectors: Map<string, Int8Array>): Promise<void> {
  const entries: Record<string, string> = {};
  for (const [hash, v] of vectors) entries[hash] = toBase64(v);
  const body: StoredVectors = { version: VECTORS_VERSION, model: SPACE.model, dims: SPACE.dims, entries };
  try {
    await bucket.put(key, JSON.stringify(body), { httpMetadata: { contentType: 'application/json' } });
  } catch (error) {
    // Still served from L1; the next cold isolate re-embeds what was lost.
    reportCaughtError(error, { source: SOURCE, operation: 'writeStored', level: 'warning', context: { key } });
  }
}

/** Embed `texts` (hash → text) in bounded, concurrent batches until `deadline`. */
async function embedMissing(env: EmbeddingEnv, missing: Array<[string, string]>, into: Map<string, Int8Array>, deadline: number, now: () => number): Promise<number> {
  const batches: Array<Array<[string, string]>> = [];
  for (let i = 0; i < missing.length; i += EMBED_BATCH) batches.push(missing.slice(i, i + EMBED_BATCH));
  let next = 0;
  let added = 0;
  const worker = async (): Promise<void> => {
    while (next < batches.length && now() < deadline) {
      const batch = batches[next++]!;
      const vectors = await embedMemoryTexts(env, batch.map(([, text]) => text), SPACE);
      // A failed batch ends this worker; its rows are embedded by a later search.
      if (!vectors) return;
      batch.forEach(([hash], i) => {
        const v = vectors[i];
        if (v) {
          into.set(hash, quantize(v));
          added += 1;
        }
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(EMBED_CONCURRENCY, batches.length) }, worker));
  return added;
}

/** A repository commit's dense index over its covered definitions. */
export interface RepoSymbolIndex {
  /** Definitions embedded / covered — partial until a later search fills the rest. */
  readonly embedded: number;
  readonly covered: number;
  search(query: string, opts: { limit: number; scope?: string | null }): Promise<Array<{ symbol: MapSymbol; score: number }>>;
}

export interface RepoSymbolIndexDeps {
  env: RepoVectorsEnv;
  /** The repository and the commit `graph` was built from. */
  repo: RepoMapKeyParts;
  graph: RepoGraph;
  now?: () => number;
}

async function buildIndex(deps: RepoSymbolIndexDeps, key: string): Promise<RepoSymbolIndex | null> {
  const bucket = deps.env.UPLOADS!;
  const now = deps.now ?? Date.now;
  const candidates = denseCandidates(deps.graph);
  const hashes = candidates.map((s) => definitionHash(definitionText(s)));
  const stored = l1.get(key) ?? (await readStored(bucket, key));
  const missing: Array<[string, string]> = [];
  const queued = new Set<string>();
  hashes.forEach((hash, i) => {
    if (stored.has(hash) || queued.has(hash)) return;
    queued.add(hash);
    missing.push([hash, definitionText(candidates[i]!)]);
  });
  const added = missing.length ? await embedMissing(deps.env, missing, stored, now() + EMBED_BUDGET_MS, now) : 0;
  if (added > 0) {
    // Keep this commit's vectors plus earlier ones up to the cap, so a run on another
    // branch of the same repository still finds most of its definitions embedded.
    const current = new Set(hashes);
    const kept = new Map<string, Int8Array>();
    for (const hash of current) {
      const v = stored.get(hash);
      if (v) kept.set(hash, v);
    }
    for (const [hash, v] of stored) {
      if (kept.size >= MAX_DENSE_DEFINITIONS * 1.5) break;
      if (!kept.has(hash)) kept.set(hash, v);
    }
    await writeStored(bucket, key, kept);
    rememberL1(key, kept);
  } else {
    rememberL1(key, stored);
  }
  const vectors = l1.get(key)!;
  const rows = candidates
    .map((symbol, i) => ({ symbol, hash: hashes[i]!, vector: vectors.get(hashes[i]!) }))
    .filter((r): r is { symbol: MapSymbol; hash: string; vector: Int8Array } => r.vector !== undefined);
  if (rows.length === 0) return null;

  // The repository root's documents: one per embedded definition, its text the embedded text.
  const bySymbolId = new Map<string, MapSymbol>();
  const docs: IndexDoc[] = [];
  for (const r of rows) {
    const id = definitionId(r.symbol);
    if (bySymbolId.has(id)) continue;
    bySymbolId.set(id, r.symbol);
    docs.push({ id, text: definitionText(r.symbol), hash: r.hash });
  }
  // The stored vectors answer every definition text; only a query reaches Workers AI.
  const embedder = bgeM3Embedder(deps.env, (text) => {
    const v = vectors.get(definitionHash(text));
    return v ? Float32Array.from(v, (x) => x / 127) : undefined;
  });
  const digest = sha256Hex(docs.map((d) => `${d.id}\t${d.hash}`).sort().join('\n'));
  const index = await r2KnowledgeIndexPort(deps.env, embedder).load(
    { namespace: `repo/${key.split('/').slice(2, 6).join('/')}`, rootId: 'definitions', digest },
    async () => docs,
  );
  if (!index) return null;
  return {
    embedded: rows.length,
    covered: candidates.length,
    async search(query, opts) {
      const scope = (opts.scope ?? '').replace(/^\.\//, '').replace(/\\/g, '/').replace(/\/+$/, '');
      const inScope = (s: MapSymbol) => !scope || s.path === scope || s.path.startsWith(`${scope}/`);
      const limit = Math.max(1, opts.limit);
      let hits: Awaited<ReturnType<typeof index.search>>;
      try {
        // A scoped search ranks the whole set first, then keeps the scope — the order is the
        // index's total order either way.
        hits = await index.search(query, { k: scope ? index.size() : limit, tiers: ['dense'] });
      } catch (error) {
        // The query could not be embedded (vendor down): the dense arm is empty, the
        // keyword arm still answers.
        reportCaughtError(error, { source: SOURCE, operation: 'search', level: 'warning', context: { key } });
        return [];
      }
      return hits
        .map((h) => ({ symbol: bySymbolId.get(h.id), score: h.score }))
        .filter((h): h is { symbol: MapSymbol; score: number } => h.symbol !== undefined && inScope(h.symbol))
        .slice(0, limit);
    },
  };
}

/**
 * The dense index for a loaded repo graph, or null when there can be none (no R2, no
 * Workers AI credential, nothing embedded). Concurrent callers for one repository share
 * one embedding pass. Never throws.
 */
export async function loadRepoSymbolIndex(deps: RepoSymbolIndexDeps): Promise<RepoSymbolIndex | null> {
  if (!deps.env.UPLOADS || !SPACE.available(deps.env)) return null;
  const key = repoVectorsObjectKey(deps.repo, SPACE.id, VECTORS_VERSION);
  // One pass per COMMIT: two runs on different commits share the stored vectors, not an index.
  const flight = `${key}@${deps.repo.sha}`;
  const pending = inFlight.get(flight);
  if (pending) return pending;
  const work = buildIndex(deps, key).catch((error) => {
    reportCaughtError(error, { source: SOURCE, operation: 'loadRepoSymbolIndex', level: 'warning', context: { key } });
    return null;
  }).finally(() => inFlight.delete(flight));
  inFlight.set(flight, work);
  return work;
}
