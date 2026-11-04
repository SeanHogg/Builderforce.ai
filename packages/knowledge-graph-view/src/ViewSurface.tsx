/**
 * The main surface of the view: the ONE renderer for the active view mode — the 2D graph
 * (default), the lazy 3D scene (a chunk loaded only when WebGL exists), the folder mind
 * map, or the list (the accessible text alternative to all of them).
 */

import { lazy, Suspense } from 'react';
import type { Finding, KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from './labels';
import type { LensDef } from './lenses';
import { Graph2D } from './graph2d/Graph2D';
import { MindMap } from './map/MindMap';
import { ListFallback } from './ListFallback';
import type { FindingEvidence, SourceLocation, ViewMode } from './types';

const GraphScene = lazy(() => import('./scene/GraphScene'));

export interface ViewSurfaceProps {
    mode: ViewMode;
    graph: KnowledgeGraph;
    /** What is drawn: the focused nodes and the lens's edges. */
    drawn: { nodes: KNode[]; edges: KEdge[] };
    lens: LensDef;
    labels: KnowledgeGraphLabels;
    rootTitle: string;
    selected: string | null;
    focus: readonly string[];
    reducedMotion: boolean;
    onSelect(ref: string): void;
    onShow(refs: string[]): void;
    onCompose?: ((text: string) => void) | undefined;
    evidence?: ((f: Finding) => FindingEvidence[]) | undefined;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
}

export function ViewSurface(p: ViewSurfaceProps) {
    const { graph, drawn, lens, labels, selected } = p;
    const planeLabel = (partition: string) => partition || labels.partitionNone;
    const graph2d = (
        <Graph2D
            rootId={graph.scope.rootId} nodes={drawn.nodes} edges={drawn.edges} lens={lens} selected={selected}
            onSelect={p.onSelect} planeLabel={planeLabel} labels={labels} label={labels.regionLabel}
        />
    );
    if (p.mode === '3d') {
        return (
            <Suspense fallback={graph2d}>
                <GraphScene
                    rootId={graph.scope.rootId} nodes={drawn.nodes} edges={drawn.edges} lens={lens} selected={selected}
                    focus={p.focus} onSelect={p.onSelect} label={labels.regionLabel} planeLabel={planeLabel} reducedMotion={p.reducedMotion}
                />
            </Suspense>
        );
    }
    if (p.mode === 'map') {
        return (
            <MindMap
                nodes={drawn.nodes} findings={graph.findings} rootTitle={p.rootTitle} selected={selected}
                onSelect={p.onSelect} onShow={p.onShow} labels={labels} label={labels.regionLabel}
            />
        );
    }
    if (p.mode === 'list') {
        return (
            <ListFallback
                graph={graph} nodes={drawn.nodes} lens={lens} labels={labels} selected={selected}
                onSelect={p.onSelect} onShow={p.onShow} onCompose={p.onCompose} evidence={p.evidence} onOpenSource={p.onOpenSource}
            />
        );
    }
    return graph2d;
}
