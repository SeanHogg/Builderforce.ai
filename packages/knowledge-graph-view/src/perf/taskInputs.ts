/**
 * The inputs the views hand to the compute client, built in ONE place so the wall-clock harness (`workerSteps.ts`) and the
 * deterministic suite (`deterministic/parity.ts`) feed the tasks the same requests. Each builder mirrors the call site named
 * in its comment; none of them computes anything.
 */

import type { KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { Layout2D } from '../graph2d/layout2d';
import type { Layout3D } from '../scene/layout3d';
import type { KindInput } from '../compute/kinds';
import type { StationModel } from '../surface/stations';
import type { LinesModel } from '../surface/lines';

interface Drawn { nodes: readonly KNode[]; edges: readonly KEdge[] }

/** The drawn-graph tasks: `Graph2D` (layout2d, rankEdges, edgePaths) and `GraphScene` (layout3d, edgeBuffers). */
export function sceneInputs(rootId: string, drawn: Drawn) {
    const { nodes, edges } = drawn;
    return {
        layout2d: { rootId, nodes, edges } satisfies KindInput<'layout2d'>,
        layout3d: { rootId, nodes, edges } satisfies KindInput<'layout3d'>,
        rankEdges: { nodes, edges } satisfies KindInput<'rankEdges'>,
        edgePaths: (picked: readonly KEdge[], layout: Layout2D): KindInput<'edgePaths'> => ({ nodes, edges: picked, layout }),
        edgeBuffers: (picked: readonly KEdge[], layout: Layout3D): KindInput<'edgeBuffers'> => ({ nodes, edges: picked, layout, selected: null }),
    };
}

/** The whole-graph tasks, as `KnowledgeGraphView`, `MindCamera`, `useSurface`, `InsightsPanel`, `PartitionMatrix` and `PatternsPanel` ask them. */
export function graphInputs(graph: KnowledgeGraph, maxDrawn: number) {
    return {
        focus: { graph, max: maxDrawn, keep: [] } satisfies KindInput<'focus'>,
        insights: { graph } satisfies KindInput<'insights'>,
        partitionMatrix: { graph } satisfies KindInput<'partitionMatrix'>,
        mindMap: { nodes: graph.nodes.filter((n) => n.kind === 'file'), findings: graph.findings, opts: { focus: null, window: null, files: null } } satisfies KindInput<'mindMap'>,
        surface: (changed: readonly string[]): KindInput<'surface'> => ({ graph, changed }),
        path: (refs: readonly string[], stations: StationModel): KindInput<'path'> => ({ graph, refs, stations }),
        antiPatterns: (layer: string | null, stations: StationModel): KindInput<'antiPatterns'> => ({ graph, layer, stations }),
    };
}

/** The refs of a line's stops, as the pinned path asks for them (`modelSteps.ts`: the first file of each station). */
export function pinnedRefs(lines: LinesModel, stations: StationModel): string[] {
    return (lines.lines[0]?.stops ?? []).map((id) => stations.byId.get(id)?.refs[0]).filter((r): r is string => !!r);
}
