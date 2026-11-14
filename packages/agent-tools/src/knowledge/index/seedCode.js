/**
 * The workspace repository's root, indexed on first use FROM THE CODE PACK
 * (docs/design/deterministic-knowledge-index.md, "Where it runs"): the host's warm
 * definition index (`WorkspaceSymbolIndex.filesUnder()` — paths and symbols, no file read)
 * goes through the code pack's OWN parser (`codeParser().extract`: the file node, its area,
 * its exported symbols as exact keys) → memory's `buildGraph` → `toCards`. No card is
 * derived here.
 *
 * `buildGraph` caps a graph at `MAX_NODES_CAP` (a view's limit), so files are built in
 * chunks of whole areas, in path order — deterministic, and nothing is truncated away. A
 * file gone since the last seed is removed from the index.
 */
import { compareStr, MAX_NODES_CAP } from '@seanhogg/builderforce-memory/knowledge';
import { CONTENT_HASH_FIELD, hashText } from '@seanhogg/builderforce-memory/ingest';
import { buildCodeGraph } from '../codeGraph.js';
import { isCodePath } from '../codePack.js';
import { knowledgePacks } from '../knowledgePacks.js';
/** Files per graph: headroom under `MAX_NODES_CAP` for the nodes `buildGraph` adds. */
export const SEED_CHUNK_FILES = Math.floor(MAX_NODES_CAP * 0.75);
/** The code pack's Extracted for each code file, from its indexed symbols. */
export function extractFromSymbols(rootId, files, partitions) {
    const byPath = new Map(files.map((f) => [f.path, f.symbols]));
    const [codePack] = knowledgePacks({ symbolsOf: (path) => byPath.get(path) ?? [], ...(partitions ? { partitions } : {}) });
    const parser = codePack.parsers[0];
    const ctx = { rootId, knownKeys: new Map(), resolvePath: () => undefined };
    const out = [];
    for (const f of [...files].sort((a, b) => compareStr(a.path, b.path))) {
        if (!isCodePath(f.path))
            continue;
        // The symbols ARE what the card is made of: their hash stands in for the content's.
        const source = {
            id: f.path, tenantId: 'local', content: { kind: 'text', text: '' },
            metadata: { [CONTENT_HASH_FIELD]: hashText(JSON.stringify(f.symbols.map((s) => [s.name, s.kind, s.exported]))) },
        };
        const ex = parser.extract?.(source, [], ctx);
        if (ex)
            out.push(ex);
    }
    return out;
}
/** Whole areas per chunk, in order; an area larger than a chunk is split. */
export function chunkByArea(extracted, size = SEED_CHUNK_FILES) {
    const areas = new Map();
    for (const ex of extracted) {
        const area = ex.nodes[0]?.area ?? '';
        const list = areas.get(area) ?? [];
        list.push(ex);
        areas.set(area, list);
    }
    const chunks = [];
    let current = [];
    for (const area of [...areas.keys()].sort(compareStr)) {
        const members = areas.get(area);
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
    if (current.length > 0)
        chunks.push(current);
    return chunks;
}
/**
 * Upserts the code cards for `files` and removes the cards of files no longer present
 * (`previous` is the last seed's ids). Returns this seed's ids, for the next one.
 */
export async function seedCodeCards(index, files, opts = {}) {
    const rootId = index.rootId;
    const extracted = extractFromSymbols(rootId, files, opts.partitions);
    const packs = knowledgePacks(opts.partitions ? { partitions: opts.partitions } : {});
    const seen = new Set();
    for (const chunk of chunkByArea(extracted)) {
        if (opts.signal?.aborted)
            return new Set(opts.previous ?? []);
        const graph = buildCodeGraph({ rootId, extracted: chunk, facts: [], relations: [], packs }, { maxNodes: MAX_NODES_CAP });
        const keys = new Map();
        for (const ex of chunk) {
            for (const { ref, key } of ex.keys)
                keys.set(ref, [...(keys.get(ref) ?? []), key]);
        }
        for (const n of graph.nodes)
            seen.add(n.ref);
        await index.upsertGraph(graph, keys);
    }
    const gone = [...(opts.previous ?? [])].filter((id) => !seen.has(id));
    if (gone.length > 0)
        index.remove(gone);
    return seen;
}
//# sourceMappingURL=seedCode.js.map