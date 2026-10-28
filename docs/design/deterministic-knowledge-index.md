# Deterministic knowledge index (LEANN-style) — end state

Status: APPROVED 2026-10-28, in implementation. The open decisions below were taken as
proposed.
Companions: [deterministic-prefetch.md](deterministic-prefetch.md) (the gate that consumes it) and
[PRD 38 rev 3](../specs/38-prd-knowledge-graph.md) (the knowledge graph whose cards it indexes:
any reviewed directory, with code and docs packs first).
Inspiration: [LEANN](https://github.com/StarTrail-org/LEANN) (MIT). It uses a graph-based
index with high-degree-preserving pruning and CSR storage, and recomputes embeddings on the
search path instead of storing them all. LEANN is Python-only, so we port the technique into
builderforce-memory's TypeScript retrieval; we do not take on a Python dependency.

## Goal

Memory answers meta questions about any reviewed directory fast, and **the same answer every
time**. In code:

- "where is billing handled"
- "which area owns webhooks"
- "what is similar to `retryPolicy.ts`"
- "which layer is this file in"

In docs:

- "what does the lease say about termination"
- "which specs mention SSO"

The targets:
- p50 ≤ 20 ms locally on 50k cards;
- byte-identical results for the same index digest and query, on any machine, CPU or GPU;
- storage at most 30% of today's float vectors.

## What exists, and what is wrong with it

| Today | Where | Problem |
|---|---|---|
| Pure-TS HNSW (M=16, efC=200, efS=50), seeded RNG `0x5eed` | `builderforce-memory/packages/memory/src/retrieval/hnsw.ts` | Each node's level comes from a *sequential* RNG, so the graph depends on insertion order. |
| `denseSearch`, `bm25`, `fusion` (RRF), `weightedFusion`, `SemanticRecall`, `MemoryVectorStore` | `retrieval/*`, `memory/SemanticRecall.ts`, `vectorstore/MemoryVectorStore.ts` | **Six rankers sort by score only** (`hnsw.ts:209`, `denseSearch:236`, `fusion.ts:50`, `bm25.ts:139`, `SemanticRecall.ts:83`, `MemoryVectorStore.ts:195`). Ties fall back to input order. Only `mmr.ts` breaks ties. |
| Evermind CPU embedder (mean-pool + L2), with a fingerprinted cache | `memory-mcp/src/embedding/evermind-embedder.ts` | Float32 cosine differs in the last bits between CPU and WebGPU, so near-ties can flip. With no checkpoint loaded, ranking silently goes lexical. |
| Cloud `semantic_search`: bge-m3 on Workers AI, brute-force cosine | `api/src/application/repos/repoSymbolVectors.ts` | A second vector engine. O(n) per query. |
| Desktop `bf-index`: bge-small 384-d, SQLite, brute-force cosine | `builderforce-inference/crates/bf-index/src/index.rs:290` | A third. `partial_cmp`, with no tie-break. |
| contextPack / preSearch | `clients/vscode/src/contextPack/*`, `agent-tools/preSearch.ts` | Uses the definition index and ripgrep only, with no semantic recall and no repo-map. |
| Repository and directory meta | `project_facts`, `codemap:<area>` | Flat text, recalled by text. There is no per-node card (path, partition, area, symbols or headings, neighbours). Recall cannot follow relations, and non-code folders have nothing at all. |

## Contract

### Engine: builderforce-memory `retrieval/knowledge-index`, exported from `/knowledge`

The engine is generic: it indexes documents. Cards come from the knowledge graph's
`toCards(graph)` (PRD 38 §4.1), one per node of every pack, in the same memory package.

```ts
export interface IndexDoc {
  id: string;                 // stable, e.g. `${repoId}::${path}` or `…#${symbol}`
  text: string;               // card text, deterministic (see Cards)
  keys?: string[];            // exact-match keys: path, basename, symbols, area
  hash?: string;              // content hash; computed from text when absent
}
export interface EmbedderPort {
  fingerprint: string;        // model id + version + dims; vectors with another fingerprint are never compared
  dims: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
export interface IndexHit { id: string; score: number; tier: 'exact' | 'lexical' | 'dense'; }
export interface KnowledgeIndex {
  upsert(docs: IndexDoc[]): Promise<void>;          // skips unchanged hashes
  remove(ids: string[]): void;
  search(q: string, opts?: { k?: number; tiers?: Array<IndexHit['tier']> }): Promise<IndexHit[]>;
  expand(hits: IndexHit[], graph: GraphNeighbours, opts?: { hops?: 1 | 2; edgeKinds?: string[] }): IndexHit[];  // recall + neighbours
  similarPairs(opts: { minSimilarity: number; maxPairs: number; kinds?: string[] }): Array<{ a: string; b: string; similarity: number }>;
  compact(): Promise<void>;                          // canonical rebuild (see Determinism)
  digest(): string;                                  // sha-256 over the canonical state
  serialize(): Uint8Array;
}
export function createKnowledgeIndex(opts: { embedder?: EmbedderPort; params?: Partial<IndexParams> }): KnowledgeIndex;
export function loadKnowledgeIndex(bytes: Uint8Array, embedder?: EmbedderPort): KnowledgeIndex;
```

### Determinism rules (all of retrieval, not only the new index)

1. **One total order.** `compareHits(a, b)` returns score descending, then id ascending.
   - Scores are quantized before the comparison: dense to 1e-4, BM25 and RRF to 1e-6.
   - It is exported from `retrieval/order.ts`, and **all six rankers above, plus `mmr`,
     migrate to it** in the same pass. No ranker keeps its own sort.
2. **Insertion-order-free graph.** A node's HNSW level is `levelOf(hash(id))`: a geometric
   draw from the id's hash, not from a sequential RNG. `compact()` rebuilds by inserting in
   id order. So **the same document set and the same fingerprint give the same graph**, byte
   for byte, whatever order the upserts arrived in.
3. **Integer similarity for traversal.** Vectors are stored as int8 codes, with a per-index
   symmetric scale fixed at first compaction.
   - Traversal scores are int8 dot products in exact integer arithmetic, so they are
     **bit-identical on every platform**.
   - Float math is used only in the final rerank, and rule 1's quantization absorbs its noise.
4. **The digest names the state.** `digest()` hashes sorted `(id, hash)` pairs, the
   fingerprint, the params, the int8 scale and the CSR graph.
   - Every result is a pure function of `(digest, query, opts)`.
   - The digest is logged on every `prefetch.decision` trace, so a disputed answer can be
     replayed.
5. **No silent fallback.** With no embedder, or a fingerprint mismatch, the dense tier is
   *absent*: hits carry `tier`, and the caller sees `tiers: ['exact', 'lexical']`. Vectors
   from two fingerprints are never mixed. A mismatch triggers a background re-embed.

### Search: a cascade, cheapest tier first (the same shape as the prefetch gate)

1. **Exact** (<1 ms). The `keys` map covers path, basename, symbol and area, and is
   case-folded. An exact hit scores 1.0. When the hits fill `k`, the search returns without
   touching other tiers.
2. **Lexical** (~ms). BM25 over the card text, with the code-aware tokenizer: it splits
   camelCase, snake_case and paths.
3. **Dense** (~ms):
   - Graph search over the int8 codes (efS=64) gives `4k` candidates.
   - The search then **recomputes** float embeddings for those candidates, from card text
     through the embedder's LRU cache (keyed by hash), and reranks.
   - This is LEANN's selective recompute, applied only where precision matters.
4. **Fuse.** RRF (k=60) across the tiers that ran, ordered by `compareHits`.
5. **Expand** (opt-in, ~µs). Add the hits' graph neighbours (1–2 hops over chosen edge
   kinds, from the knowledge graph), each scored as the hit's score × edge weight × 0.5 per
   hop, then ordered by `compareHits` again.
   - This is what makes recall return *knowledge*, not isolated facts. Asked about a claim,
     recall also returns its source section, the claims that contradict it, and the entity
     it is about.

### Storage (LEANN technique, sized for repositories)

- **Graph.** The base layer is pruned with **high-degree-preserving pruning**:
  - hubs (the top 2% by in-degree) keep M=16 edges;
  - every other node keeps M/2;
  - upper layers stay unpruned.

  The graph is stored as **CSR**: a `Uint32Array` of offsets plus a `Uint32Array` of
  neighbours.
- **Vectors.** int8 codes by default (`dims` bytes per doc).
  - **Lean mode** (opt-in, for repositories over 200k cards) drops the codes of non-hub
    nodes and recomputes them on the search path, as LEANN does.
  - It is off by default, because our CPU embedder makes full recompute too slow for the
    p50 target.
- **Exact mode below 20k cards (`exactBelow`).** A graph only pays off at scale. Below the
  threshold, `compact()` builds no graph: the dense tier is an exact integer scan over every
  int8 code (ties by id), followed by the same float rerank.
  - It has no construction cost, which matters in a Worker, and it is trivially
    deterministic.
  - `similarPairs` scores every pair up to about 700 cards. Above that it uses fixed
    sign-bucket blocking (8 tables × 10 dims, the next 32 in each bucket), capped at 250k
    evaluations, in a deterministic order.
  - The mode is part of the digest. The format is v2, and v1 blobs still load, as graph mode.
- **Budget at 50k cards, 384 dims:**
  - float32 today: ≈ 77 MB;
  - int8 + CSR: ≈ 19 MB + ≈ 2.4 MB, which is ≈ 28%;
  - lean mode: ≈ 6 MB.

### Cards (memory `/knowledge` `toCards`)

There is one card per graph node (PRD 38 §4.1). The text is built deterministically from the
node and its pack:

| Node kind | Card text | `keys` |
|---|---|---|
| code file | path · area · partition (layer) · exported symbols (sorted) · first doc-comment line · top-5 neighbours by weight | path, basename, symbols, area |
| doc section | file · heading breadcrumb · first 400 characters of the body · outgoing link targets | file path, heading slug, front-matter keys |
| entity (`ent:`) | name · type · the sources that mention it (top 5 by importance) | the normalized name and its aliases |
| claim (`claim:`) | subject · predicate · object · quote · source section | subject and object entity keys |
| area | path · partition · top-10 members by importance | path |

The `hash` is computed over the text, so a node whose card did not change is never
re-embedded.

## Where it runs

| Host | Embedder port | Index lives | Built from |
|---|---|---|---|
| VS Code | Synapse `bfi-node` embed, then the Evermind CPU embed (a local checkpoint, loaded on idle), then a resident Ollama embedding model (`/api/ps` + `/api/embed`); lexical only when none is warm | `.builderforce/knowledge/<rootId>.idx`, keyed by digest; loaded at activation | `buildGraph` → `toCards` for every reviewed root (the workspace repository is reviewed by the code pack on first use); incremental on save and on review |
| On-prem agent | the same ports | the same path | the same |
| Cloud (API) | **bge-m3 on Workers AI** behind `EmbedderPort` | R2 `knowledge-index/{tenant}/{project}/{rootId}/{scopeDigest}.bin`, read through `getOrSetCached` by digest | the server-built graph → cards. **`repoSymbolVectors.ts`'s brute-force loop is deleted.** Its `semantic_search` calls `KnowledgeIndexPort.search` over the repository's root, and its existing tests run unchanged as the parity oracle. |
| Web / Rovr | none (they call the API) | — | `GET /api/projects/:id/knowledge/search` |
| Desktop `bf-index` (Rust) | — | — | Gets the same total order: score desc, then id asc, with the same quantization, in the same pass. The graph index port is open decision 2. |

## Consumers

- **Prefetch.**
  - `context.pre-search` adds knowledge-index hits to the context pack, in the volatile tail.
    The hits are exact + lexical, with dense only when warm, and are expanded by one hop.
  - The ANSWER row `knowledge.ask` (PRD 38 §4.9) covers "where is X handled", "which file
    owns Y" and "what does <doc> say about Z". It settles when the exact tier hits, or when
    the top fused hit clears its learned threshold, and records `skippedLlm` and a savings
    row. Otherwise the hits ride in as PREFETCH context.
- **Memory recall.** `memory_recall` with a project or root scope, and `answerFromMemory`,
  consult the index with expansion before text recall.
- **The knowledge graph** (PRD 38):
  - the search box (every node is reachable, not only rendered nodes);
  - the Duplication lens's near-duplicates (`similarPairs`, minSimilarity 0.92 by default,
    deterministic pair order);
  - review-time entity resolution, where near-duplicate entities become "possible-same"
    findings;
  - the claim pairs sent for contradiction judgement.

## Sequence

```
save / review / run end / new sha ─▶ toCards(graph) ─▶ index.upsert(changed cards only)
                                                   └─ idle: compact() when churn > 10% ─▶ new digest ─▶ persist
query ─▶ exact ─(k filled?)─▶ return
          └▶ lexical ─▶ dense(int8 graph → recompute rerank) ─▶ RRF ─▶ compareHits ─▶ hits(tier, digest)
```

## Code map

`builderforce-memory/packages/memory/src/`:

| File | Responsibility |
|---|---|
| `retrieval/order.ts` | `compareHits` + quantization; migrate hnsw, denseSearch, bm25, fusion, weightedFusion, mmr, SemanticRecall, MemoryVectorStore |
| `retrieval/hnsw.ts` | hash-derived levels, `canonicalBuild(ids sorted)`, a pruning hook. It does not grow: CSR and pruning go in their own files. |
| `retrieval/knowledge-index/{index.ts,csr.ts,prune.ts,quantize.ts,cascade.ts,expand.ts,tokenize.ts,digest.ts,serialize.ts}` | each under 200 lines; re-exported from `/knowledge` |
| `knowledge/cards.ts` | `toCards` (PRD 38 §4.1), with one card shape per node kind |
| `package.json` | `exports["./knowledge"]`, published via tag (CI release) |

`Builderforce.ai`:

| File | Responsibility |
|---|---|
| `clients/vscode/src/knowledge/{hostKnowledgeIndex.ts,embedderPort.ts}` | load, incremental update, persist per root; the contextPack and prefetch sources |
| `agent-runtime/src/agents/knowledge/onPremKnowledgeIndex.ts` | the same, on-prem |
| `api/src/application/knowledge/knowledgeIndexPort.ts` | the use case behind the `semantic_search` tool and the search route; `repoSymbolVectors.ts` folds into it and is deleted |

`builderforce-inference/crates/bf-index/src/index.rs` gets the total-order comparator.

## Done-checks

1. **Order-free:**
   - Build the same 5k cards in 3 shuffled orders, then `compact()`.
   - Identical digest, and identical results for 200 fixed queries.
2. **Cross-platform:**
   - Int8 traversal gives identical candidates for CPU and WebGPU embeddings of the same text.
   - The final lists are identical after quantization (a fixture test with recorded
     embeddings).
3. **Tie-break:** every migrated ranker returns id-ascending order on equal scores. Existing
   retrieval tests run **unchanged**. A test that relied on input-order ties is a named
   behaviour change, recorded in DONE.md.
4. **Fast:** p50 ≤ 20 ms and p95 ≤ 60 ms on 50k cards, measured on CPU with the warm
   embedder cache. The exact tier answers in under 1 ms.
5. **Lean:** int8 + CSR is ≤ 30% of float32 on the fixture. In lean mode, recall@10 stays
   within 2 points of full mode.
6. **Better:**
   - On code, recall@10 on a labelled set mined from our own runs (the files actually
     opened after a question) beats today's ripgrep + definition preSearch.
   - On docs, recall@10 with `expand` beats recall@10 without it on a fixture of linked
     specs.
   - Prefetch shows fewer exploration turns on the savings ledger.
7. **One engine:** cloud `semantic_search` runs through the index, the brute-force loop is
   gone, and its tests pass unchanged.
8. **Explicit tiers:** with no embedder, results carry only `exact` / `lexical` tiers, never
   mislabelled.

## Workstreams

| WS | Scope |
|---|---|
| WS1 | `retrieval/order.ts` and the migration of every ranker; `hnsw.ts` hash-derived levels and canonical build; the `bf-index` comparator. Release builderforce-memory via tag. |
| WS2 | Knowledge-index engine: CSR, pruning, int8, cascade, `expand`, digest, serialize, lean mode; `toCards`. Release. |
| WS3 | Builderforce: the VS Code and on-prem host index per root; the contextPack/preSearch source; the `knowledge.ask` executor; the graph-view search and `similarPairs` ports. |
| WS4 | API: `KnowledgeIndexPort`; the R2 index per scope digest; `repoSymbolVectors.ts` folded in and deleted; the search route. |

The order is WS1, then WS2, then WS3 and WS4 in parallel. WS1–2 run beside PRD 38 WS1, in the
same memory release train. Sonnet verifies each with targeted test files only.

## Open decisions for the operator

1. **The cloud embedder.** Keep bge-m3 on Workers AI (proposed: it is already paid for and
   multilingual), or use the Evermind embedder in the container, so that cloud and local
   share a fingerprint and an index built locally can be uploaded and reused.
2. **Desktop `bf-index`.**
   - Option (a), proposed: in this program, it gets the shared comparator and its search
     stays brute force; full parity is a follow-up register entry.
   - Option (b): port the graph index to Rust now.
3. **Symbol-level cards.** Index exported symbols as their own cards from day one (about 3×
   the cards, sharper "where is X" answers), or code files and areas only, with symbols left
   to the exact `keys` map (proposed). Doc sections are always cards.
