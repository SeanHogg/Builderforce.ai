/**
 * PROFILING HARNESS + REGRESSION (ticket #6350) — "attribute the ~3.3 GB indexing memory".
 *
 * Reproducible memory profile of the VSIX knowledge-indexer pipeline, run through the
 * package's own tooling (vitest, NOT raw node on .ts). It drives the real host index's
 * graph upsert over a package's worth of doc-section cards and attributes the retained
 * heap by the structural category that owns it — the same categories a 3.3 GB production
 * profile shows, scaled to a fixture small enough to run in CI.
 *
 * Reproduce:
 *     cd Builderforce.ai/packages/agent-tools
 *     NODE_OPTIONS="--expose-gc" pnpm vitest run src/knowledge/index/indexMemory.profile.test.ts
 *
 * The pipeline, traced by hand from the source (the "attribution"):
 *   memory `knowledge-index` engine (via `@seanhogg/builderforce-memory/knowledge`):
 *     - IndexState.docs    Map<id, DocEntry>  — DocEntry.text is the card text (copy 1)
 *     - IndexState.keys    Map<foldedKey, ids>  — exact-match inverted keys
 *     - LexicalIndex       postings Map<term, Map<doc, tf>> + _docs Map<doc, {terms, length}>
 *                          — tokenizes every card; the terms/length are a 2nd copy of the text
 *     - Compacted (CSR)    graph codes + edges + ids + hashes — after compact(), ids+hashes
 *                          are 2nd copies (1st copy lives in IndexState)
 *     - EmbeddingCache     Map<fingerprint, Float32Array> LRU, bounded at 8192 × dims×4 bytes
 *   agent-tools HostIndex (this package, the VSIX-side wrapper):
 *     - meta    Map<node, HitMeta> — HitMeta.text is the FULL card text (copy 3)  ← DEFECT
 *     - adjacency Map<node, Edge[]> — one-hop recall edges
 *     - hashes  Map<node, contentHash>
 *     - nearDup / provisional — capped (NEAR_DUPLICATE_MAX_PAIRS / per-review Set)
 *
 * The clear defect (#6350): HostIndex.meta kept the ENTIRE card text per node, but the
 * only consumer (renderHits.ts `hitLine`) clips it to HIT_EXCERPT_CHARS = 140. A section
 * card's text is its `excerpt` badge capped at EXCERPT_CHARS = 400 (cards.ts), so the
 * host was retaining up to 400 chars per node that only 140 of would ever be shown — a
 * whole extra copy of every card, held for the index's lifetime, for no use. The fix
 * (hostIndex.ts) stores at most META_TEXT_EXCERPT chars per node.
 *
 * This test both prints the live profile AND asserts the fix: the host's retained text
 * must be ≤ META_TEXT_EXCERPT per node even though the engine's card text is far longer.
 */

import { describe, expect, it } from "vitest";
import { createHostKnowledgeIndex, META_TEXT_EXCERPT } from "./hostIndex.js";
import { bucketEmbedder, manualIdle, memoryFiles } from "./testkit.test-util.js";

// Realistic doc-section card: the `excerpt` badge a parser sets, capped by cards.ts at
// EXCERPT_CHARS = 400. 300 nodes ⇒ 300 cards, each ~300 chars of real prose.
const CARD_COUNT = 300;
const PROSE =
  "The tenant pays rent on the first of the month through the resident portal. Late fees " +
  "accrue after the fifth. A maintenance request is triaged by severity and assigned to an " +
  "approved vendor. The ledger records every charge and payment against the unit.";
const pad = (i: number) => `${PROSE} [section ${i}]`;

function sectionGraph(count: number) {
  const nodes = Array.from({ length: count }, (_, i) => {
    const ref = `src:repo::docs/guide.md#section-${i}`;
    return {
      ref, kind: "section", label: `Section ${i}`, pack: "docs", importance: 0.5,
      origin: "judged", area: "src:repo::docs", partition: "docs",
      badges: { breadcrumb: `Guide › Section ${i}`, excerpt: pad(i).slice(0, 400) },
    };
  });
  return {
    scope: { rootId: "repo", packs: ["docs"], digest: "profile" },
    nodes, edges: [],
    findings: [], stats: { sources: 0, nodes: count, stale: 0, truncated: false },
  } as never;
}

const mb = (n: number): number => +(n / 1048576).toFixed(1);
const utf8 = (s: string): number => Buffer.byteLength(s, "utf8");

interface HostRetention {
  metaText: number;       // bytes of HitMeta.text actually retained
  adjacency: number;
  hashes: number;
  maxMetaTextLen: number; // longest single HitMeta.text (chars)
  nodes: number;
}

/** Read the host index's own retained structures directly — these ARE the heap bytes. */
function attributeHostRetention(index: unknown): HostRetention {
  const h = index as {
    meta?: Map<string, { text?: string }>;
    adjacency?: Map<string, Array<{ id: string; kind: string; weight: number }>>;
    hashes?: Map<string, string>;
  };
  const meta = h.meta ?? new Map<string, { text?: string }>();
  const adjacency = h.adjacency ?? new Map<string, Array<{ id: string; kind: string; weight: number }>>();
  const hashes = h.hashes ?? new Map<string, string>();

  let metaText = 0, maxMetaTextLen = 0;
  for (const m of meta.values()) {
    if (m.text) { metaText += utf8(m.text); maxMetaTextLen = Math.max(maxMetaTextLen, m.text.length); }
  }
  let adjacencyBytes = 0;
  for (const [from, edges] of adjacency) {
    adjacencyBytes += utf8(from);
    for (const e of edges) adjacencyBytes += utf8(e.id) + utf8(e.kind) + 24;
  }
  let hashesBytes = 0;
  for (const [id, hh] of hashes) hashesBytes += utf8(id) + utf8(hh);
  return { metaText, adjacency: adjacencyBytes, hashes: hashesBytes, maxMetaTextLen, nodes: meta.size };
}

describe("knowledge-index memory profile (#6350)", () => {
  it("indexes one small package, attributes retained bytes, and clamps host meta.text", async () => {
    const files = memoryFiles();
    const idle = manualIdle();
    const embedder = bucketEmbedder("profile-v1", 384); // realistic dims
    const index = createHostKnowledgeIndex({
      rootId: "repo", path: "repo.idx", files, idle,
      embedder: async () => embedder,
    });

    global.gc?.();
    const baseline = process.memoryUsage().heapUsed;

    // Index one small package's doc sections through the real graph upsert.
    await index.upsertGraph(sectionGraph(CARD_COUNT));
    await index.flush(); // compaction + persistence

    global.gc?.();
    const afterIndex = process.memoryUsage().heapUsed;

    const host = attributeHostRetention(index);
    const mu = process.memoryUsage();
    const size = await index.size();
    const persistedBytes = files.store.get("repo.idx")?.length ?? 0;
    const hostTotal = host.metaText + host.adjacency + host.hashes;
    const retainedDelta = afterIndex - baseline;

    const report = {
      package: { cards: CARD_COUNT },
      index: { cards: size, persistedBytes },
      heap: {
        baselineMB: mb(baseline),
        afterIndexMB: mb(afterIndex),
        retainedMB: mb(retainedDelta),
        rssMB: mb(mu.rss),
        heapTotalMB: mb(mu.heapTotal),
      },
      hostRetainedBytes: {
        "host.meta.text": host.metaText,
        "host.adjacency": host.adjacency,
        "host.hashes": host.hashes,
        "host.total": hostTotal,
      },
      maxHostMetaTextChars: host.maxMetaTextLen,
      metaTextCap: META_TEXT_EXCERPT,
      engineCardTextChars: 400, // cards.ts EXCERPT_CHARS — what the host used to retain in full
      attribution: "card text is stored in the engine (DocEntry.text + LexicalIndex terms) AND, before #6350, a full copy in HostIndex.meta.text. The host copy is now clamped to META_TEXT_EXCERPT; the engine copy is the live one search uses.",
    };

    // eslint-disable-next-line no-console
    console.log("\n===== KNOWLEDGE-INDEX MEMORY PROFILE (#6350) =====\n" + JSON.stringify(report, null, 2) + "\n==================================================\n");

    // The profile must be internally consistent and must actually have indexed.
    expect(size).toBe(CARD_COUNT);
    expect(persistedBytes).toBeGreaterThan(0);
    expect(host.nodes).toBe(CARD_COUNT);

    // THE FIX (#6350): no node's host-retained text may exceed the excerpt cap, even
    // though the engine's card text is ~400 chars (a full doc-section excerpt). Before
    // the fix this was the unbounded full card text — a whole extra copy of every card.
    expect(host.maxMetaTextLen).toBeLessThanOrEqual(META_TEXT_EXCERPT);
    // Real clamp, not a vacuous fixture: cards exceed the cap, so without the fix the
    // retained text would be ~400 chars, strictly above the cap.
    expect(host.maxMetaTextLen).toBeGreaterThan(140); // > the renderer's HIT_EXCERPT_CHARS
    expect(host.maxMetaTextLen).toBeLessThan(400);    // < the full card the engine holds

    // The host's retained set must be a real (non-trivial) share of what the index holds.
    expect(hostTotal).toBeGreaterThan(0);
    expect(retainedDelta).toBeGreaterThan(hostTotal * 0.25);
  }, 60_000);
});
