/**
 * knowledge/codeGraphFindings.ts — the code pack's `buildGraph(...).findings` over
 * `knowledgePacks()` (PRD 38 §4.5), answering ONLY what the PreFetch code actions read:
 * the graph's findings and the layer each file was placed in.
 *
 * One build serves every code action while the tree is unchanged: {@link buildCodeGraph}
 * places each code file's layer directly on the node (`partition`) and swaps the pack's
 * default partitions for {@link placedLayerRegistry}, so `graph.findings` are judged against
 * the SAME layers the nodes carry — one registry, not two. {@link codeGraphFindings} runs
 * that build over `knowledgePacks()` and reads back:
 *
 *   • `findings` — the built graph's findings (memory's generic rules plus the code pack's
 *     own {@link CODE_FINDING_RULES}), exactly what the knowledge-graph view shows;
 *   • `placed`   — root-relative file path → the layer the graph placed it in, so a verdict
 *     can be reported against the layer the build used (default layers: the node's own
 *     `partition`; a project registry: memory's {@link partitionOf} over that registry).
 *
 * Pure: no I/O, worker-safe. Used by the PreFetch code actions in this thread, and handed
 * to the host's graph worker (the VS Code extension's) when it binds one.
 */

import { partitionOf, type Extracted, type Finding, type PartitionRegistry } from '@seanhogg/builderforce-memory/knowledge';
import { buildCodeGraph } from './codeGraph.js';
import { isDefaultLayers } from './codeLayers.js';
import { CODE_PACK_ID } from './codeNodes.js';
import { knowledgePacks } from './knowledgePacks.js';
import { sourcePathOf } from './rootId.js';

/** What a code-pack graph build answers: its findings and the layer each file was placed in. */
export interface CodeGraphFindings {
    findings: Finding[];
    /** Root-relative file path → the layer the graph placed it in. */
    placed: ReadonlyMap<string, string>;
}

/**
 * The code pack's findings for one workspace analysis: `buildCodeGraph` over `knowledgePacks()`,
 * with the per-file layer placement read back off the placed code-file nodes.
 */
export function codeGraphFindings(rootId: string, extracted: readonly Extracted[], partitions: PartitionRegistry): CodeGraphFindings {
    const graph = buildCodeGraph({ rootId, extracted: [...extracted], facts: [], relations: [], packs: knowledgePacks() });
    const defaultLayers = isDefaultLayers(partitions);
    const placed = new Map<string, string>();
    for (const node of graph.nodes) {
        if (node.pack !== CODE_PACK_ID || node.kind !== 'file') continue;
        const path = sourcePathOf(node.ref, rootId);
        if (!path) continue;
        let layer: string;
        if (defaultLayers) {
            layer = node.partition ?? '';
        } else {
            const custom: string = partitionOf(path, partitions) ?? '';
            layer = custom;
        }
        placed.set(path, layer);
    }
    return { findings: graph.findings, placed };
}
