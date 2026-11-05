/**
 * knowledge/codeGraph.ts — THE way every host builds a graph that contains the code pack
 * (PRD 38, Option B+ Contract 2): memory's `buildGraph` plus layer resolution.
 *
 * Memory places a node by globbing its path against the pack's partitions, so the import
 * direction rule — which needs the whole file graph — cannot be a glob. Placement is
 * therefore a pure function of the Extracted, done here, BEFORE the graph is built:
 *
 *   • every code file gets its layer as `partition` directly (and a `layerRule` badge) — no
 *     per-file pattern is compiled or cached;
 *   • the pack's registry becomes the same layers with empty globs ({@link placedLayerRegistry}),
 *     so memory still derives verdicts (`allowed` / `skips` / `upward`) and findings from the
 *     partitions the nodes carry — one registry, the one the nodes were placed in;
 *   • entry points come from the `entry` badge the review recorded, never from a file read.
 *
 * A project's own registry (`.builderforce/partitions.json`) is not the default and is left
 * to memory untouched. Signals for a file the review never extracted (an ignored or oversize
 * file) are dropped. Used by `buildStoredGraph`, the API's graph builder, the web's analysis
 * view, the index seed and the PreFetch code actions — so the same Extracted gives the same
 * partitions everywhere. Pure.
 */

import {
    buildGraph, type BuildGraphInput, type BuildGraphOptions, type Extracted, type KNode, type KnowledgeGraph, type NodeRef,
} from '@seanhogg/builderforce-memory/knowledge';
import { isDefaultLayers, placeLayers, placedLayerRegistry, type LayerPlacement } from './codeLayers.js';
import { CODE_BADGES, CODE_PACK_ID, ROOT_OUTPUT_HASH_PREFIX, ROOT_SIGNALS_REF } from './codeNodes.js';
import { sourcePathOf } from './rootId.js';

const isCodeFile = (n: KNode): boolean => n.pack === CODE_PACK_ID && n.kind === 'file';

/** Drops root-signal nodes of files no per-file parser extracted (their ref has no parser node). */
function withoutOrphanSignals(extracted: readonly Extracted[]): Extracted[] {
    const extractedRefs = new Set<NodeRef>();
    for (const e of extracted) {
        if (e.sourceRef === ROOT_SIGNALS_REF || e.sourceHash.startsWith(ROOT_OUTPUT_HASH_PREFIX)) continue;
        for (const n of e.nodes) if (isCodeFile(n)) extractedRefs.add(n.ref);
    }
    return extracted.flatMap((e) => {
        if (e.sourceRef !== ROOT_SIGNALS_REF) return [e];
        const nodes = e.nodes.filter((n) => extractedRefs.has(n.ref));
        return nodes.length > 0 ? [{ ...e, nodes }] : [];
    });
}

/** What placement needs from the Extracted: the code files, their imports, entry points and barrels. */
function placementInput(rootId: string, extracted: readonly Extracted[]): Parameters<typeof placeLayers>[0] {
    const paths = new Set<string>();
    const entryPaths = new Set<string>();
    const barrels = new Set<string>();
    const imports: Array<[string, string]> = [];
    for (const e of extracted) {
        for (const n of e.nodes) {
            const path = isCodeFile(n) ? sourcePathOf(n.ref, rootId) : undefined;
            if (!path) continue;
            paths.add(path);
            if (n.badges?.[CODE_BADGES.entry] !== undefined) entryPaths.add(path);
            // A barrel (`index.*` defining nothing) only re-exports: its imports are not a layer's use of them.
            if (/^index\./.test(path.slice(path.lastIndexOf('/') + 1)) && n.badges?.[CODE_BADGES.symbols] === 0) barrels.add(path);
        }
        for (const edge of e.edges) {
            if (edge.kind !== 'references') continue;
            const from = sourcePathOf(edge.from, rootId), to = sourcePathOf(edge.to, rootId);
            if (from && to) imports.push([from, to]);
        }
    }
    return { paths: [...paths], imports, entryPaths, barrels };
}

/** The Extracted with every placed code file carrying its `partition` and `layerRule`. */
function placeExtracted(rootId: string, extracted: readonly Extracted[], placed: ReadonlyMap<string, LayerPlacement>): Extracted[] {
    return extracted.map((e) => {
        if (!e.nodes.some(isCodeFile)) return e;
        const nodes = e.nodes.map((n) => {
            const placement = isCodeFile(n) ? placed.get(sourcePathOf(n.ref, rootId) ?? '') : undefined;
            return placement
                ? { ...n, partition: placement.layer, badges: { ...n.badges, [CODE_BADGES.layerRule]: placement.rule } }
                : n;
        });
        return { ...e, nodes };
    });
}

export function buildCodeGraph(input: BuildGraphInput, opts?: BuildGraphOptions): KnowledgeGraph {
    const code = input.packs.find((p) => p.id === CODE_PACK_ID);
    if (!code) return buildGraph(input, opts);
    const extracted = withoutOrphanSignals(input.extracted);
    if (!isDefaultLayers(code.partitions)) return buildGraph({ ...input, extracted }, opts);
    const placed = placeLayers(placementInput(input.rootId, extracted));
    return buildGraph(
        {
            ...input,
            extracted: placeExtracted(input.rootId, extracted, placed),
            packs: input.packs.map((p) => (p === code ? { ...p, partitions: placedLayerRegistry(code.partitions!) } : p)),
        },
        opts,
    );
}
