/**
 * The main thread's side of every task kind: what a component hands in (`input`, real nodes and graphs) and what it gets back
 * (`result`, real objects again). The wire shapes between them are in `protocol.ts`; the codecs in `codecs/` translate.
 */

import type { Finding, KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { Layout2D } from '../graph2d/layout2d';
import type { EdgePath } from '../graph2d/edgePaths';
import type { VisibleGraph, PartitionCell } from '../graphModel';
import type { Insights } from '../insights/insightsModel';
import type { MindMap, MindOptions } from '../map/mindMapModel';
import type { EdgeBuffer } from '../scene/buffers';
import type { RankedEdges } from '../scene/edgeBudget';
import type { Layout3D } from '../scene/layout3d';
import type { AntiPatternGroup } from '../surface/drawers/antiPatternGroups';
import type { LinesModel } from '../surface/lines';
import type { PathModel } from '../surface/path';
import type { StationModel } from '../surface/stations';

export interface SurfaceResult { stations: StationModel; lines: LinesModel }

export interface Kinds {
    layout2d: { input: { rootId: string; nodes: readonly KNode[]; edges: readonly KEdge[] }; result: Layout2D };
    layout3d: { input: { rootId: string; nodes: readonly KNode[]; edges: readonly KEdge[] }; result: Layout3D };
    rankEdges: { input: { nodes: readonly Pick<KNode, 'ref' | 'importance'>[]; edges: readonly KEdge[] }; result: RankedEdges };
    edgePaths: { input: { nodes: readonly KNode[]; edges: readonly KEdge[]; layout: Layout2D }; result: EdgePath[] };
    edgeBuffers: { input: { nodes: readonly KNode[]; edges: readonly KEdge[]; layout: Layout3D; selected: string | null }; result: EdgeBuffer[] };
    mindMap: { input: { nodes: readonly KNode[]; findings: readonly Finding[]; opts: MindOptions }; result: MindMap };
    surface: { input: { graph: KnowledgeGraph; changed: readonly string[]; repoConfigName?: string | undefined }; result: SurfaceResult };
    path: { input: { graph: KnowledgeGraph; refs: readonly string[]; stations: StationModel }; result: PathModel };
    insights: { input: { graph: KnowledgeGraph }; result: Insights };
    partitionMatrix: { input: { graph: KnowledgeGraph }; result: { partitions: string[]; cells: Map<string, PartitionCell> } };
    focus: { input: { graph: KnowledgeGraph; max: number; keep: readonly string[] }; result: VisibleGraph };
    antiPatterns: { input: { graph: KnowledgeGraph; layer: string | null; stations: StationModel }; result: AntiPatternGroup[] };
}

export type KindInput<K extends keyof Kinds> = Kinds[K]['input'];
export type KindResult<K extends keyof Kinds> = Kinds[K]['result'];
