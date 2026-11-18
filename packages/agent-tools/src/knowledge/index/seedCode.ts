/**
 * The workspace repository's root, indexed on first use FROM THE CODE PACK
 * (DONE.md, deterministic knowledge index archive, "Where it runs"): the host's warm
 * definition index (`WorkspaceSymbolIndex.filesUnder()` — paths and symbols, no file read)
 * goes through the code pack's OWN parser (`codeParser().extract`: the file node, its area,
 * its exported symbols as exact keys) → memory's `buildGraph` → `toCards`. No card is
 * derived here.
 *
 * `buildGraph` caps a graph at `MAX_NODES_CAP` (a view's limit), so files are built in
 * chunks of whole areas, in path order — deterministic, and nothing is truncated away. A
 * file gone since the last seed is removed from the index.
 */

import { compareStr, MAX_NODES_CAP, type Extracted, type KnowledgeGraph, type KnowledgePack, type NodeRef, type PartitionRegistry, type StoredFact, type StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import { CONTENT_HASH_FIELD, hashText, type SourceDocument } from '@seanhogg/builderforce-memory/ingest';
import type { CodeSymbol } from '../../symbols.js';
import { buildCodeGraph } from '../codeGraph.js';
import { isCodePath } from '../codePack.js';
import { knowledgePacks } from '../knowledgePacks.js';
import type { HostKnowledgeIndexCore } from './contract.js';

/** Files per graph: headroom under `MAX_NODES_CAP` for the nodes `buildGraph` adds. */
export const SEED_CHUNK_FILES = Math.floor(MAX_NODES_CAP * 0.75);

export interface SymbolFile {
    path: string;
    symbols: readonly CodeSymbol[];
}

/** The code pack's Extracted for each code file, from its indexed symbols. */
export function extractFromSymbols(rootId: string, files: readonly SymbolFile[], partitions?: PartitionRegistry): Extracted[] {
    const byPath = new Map(files.map((f) => [f.path, f.symbols] as const));
    const [codePack] = knowledgePacks({ symbolsOf: (path) => byPath.get(path) ?? [], ...(partitions ? { partitions } : {}) });
    const parser = codePack!.parsers[0]!;
    const ctx = { rootId, knownKeys: new Map<string, NodeRef>(), resolvePath: () => undefined };
    const out: Extracted[] = [];
    for (const f of [...files].sort((a, b) => compareStr(a.path, b.path))) {
        if (!isCodePath(f.path)) continue;
        // The symbols ARE what the card is made of: their hash stands in for the content's.
        const source: SourceDocument = {
            id: f.path, tenantId: 'local', content: { kind: 'text', text: '' },
            metadata: { [CONTENT_HASH_FIELD]: hashText(JSON.stringify(f.symbols.map((s) => [s.name, s.kind, s.exported]))) },
        };
        const ex = parser.extract?.(source, [], ctx);
        if (ex) out.push(ex);
    }
    return out;
}

/** Whole areas per chunk, in order; an area larger than a chunk is split. */
export function chunkByArea(extracted: readonly Extracted[], size: number = SEED_CHUNK_FILES): Extracted[][] {
    const areas = new Map<string, Extracted[]>();
    for (const ex of extracted) {
        const area = ex.nodes[0]?.area ?? '';
        const list = areas.get(area) ?? [];
        list.push(ex);
        areas.set(area, list);
    }
    const chunks: Extracted[][] = [];
    let current: Extracted[] = [];
    for (const area of [...areas.keys()].sort(compareStr)) {
        const members = areas.get(area)!;
        if (current.length > 0 && current.length + members.length > size) {
            chunks.push(current);
            current = [];
        }
        for (const ex of members) {
            if (current.length >= size) {
                chunks.push(current);
                current = [];
            }
            current.push(ex);
        }
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
}

/**
 * A host whose UI is a single event loop (the VS Code extension host, the browser) never
 * lets `seedCodeCards`'s synchronous `buildCodeGraph` run on it: {@link codeGraphSeam}
 * hands the graph to a worker, by default. Tests set the seam to the direct builder.
 */
let codeGraphSeam: ((args: CodeGraphArgs) => KnowledgeGraph) | undefined;
export interface CodeGraphArgs { rootId: string; extracted: Extracted[]; facts: StoredFact[]; relations: StoredRelation[]; packs: KnowledgePack[]; maxNodes: number }
/** Replaces {@link seedCodeCards}'s graph builder (tests; a host that builds in a worker). Returns the restore. */
export function setCodeGraphSeam(seam: (args: CodeGraphArgs) => KnowledgeGraph): () => void {
    const prior = codeGraphSeam;
    codeGraphSeam = seam;
    return () => { codeGraphSeam = prior; };
}

const buildGraph = (args: CodeGraphArgs): KnowledgeGraph =>
    codeGraphSeam ? codeGraphSeam(args) : buildCodeGraph(
        { rootId: args.rootId, extracted: args.extracted, facts: args.facts, relations: args.relations, packs: args.packs },
        { maxNodes: args.maxNodes },
    );

/**
 * Upserts the code cards for `files` and removes the cards of files no longer present
 * (`previous` is the last seed's ids). Returns this seed's ids, for the next one.
 */
export async function seedCodeCards(
    index: HostKnowledgeIndexCore,
    files: readonly SymbolFile[],
    opts: { partitions?: PartitionRegistry; previous?: ReadonlySet<string>; signal?: AbortSignal } = {},
): Promise<Set<string>> {
    const rootId = index.rootId;
    const extracted = extractFromSymbols(rootId, files, opts.partitions);
    const packs = knowledgePacks(opts.partitions ? { partitions: opts.partitions } : {});
    const seen = new Set<string>();
    for (const chunk of chunkByArea(extracted)) {
        if (opts.signal?.aborted) return new Set(opts.previous ?? []);
        const graph = buildGraph({ rootId, extracted: chunk, facts: [], relations: [], packs, maxNodes: MAX_NODES_CAP });
        const keys = new Map<string, string[]>();
        for (const ex of chunk) {
            for (const { ref, key } of ex.keys) keys.set(ref, [...(keys.get(ref) ?? []), key]);
        }
        for (const n of graph.nodes) seen.add(n.ref);
        await index.upsertGraph(graph, keys);
    }
    const gone = [...(opts.previous ?? [])].filter((id) => !seen.has(id));
    if (gone.length > 0) index.remove(gone);
    return seen;
}
