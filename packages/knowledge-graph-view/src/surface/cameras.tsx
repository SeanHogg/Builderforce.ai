/**
 * The camera registry: every way the surface draws the graph, as rows. The order here is the
 * order of the switcher. A later camera (System, Heat, Sequence) is one row plus its id in
 * `ViewMode`; `ViewSurface` and the switcher read this array and know no camera by name.
 */

import { lazy, Suspense, useMemo, type ComponentType } from 'react';
import { fillTemplate } from '../labels';
import { Graph2D } from '../graph2d/Graph2D';
import { ListFallback } from '../ListFallback';
import { MindMap } from '../map/MindMap';
import { MAX_PIPES, nodeChannels, pipeWidthOf } from '../scene/channels';
import { cssVar } from '../scene/themeColors';
import { questionDef } from './questions';
import type { CameraDef, SceneProps } from './registry';
import type { Station } from './stations';
import { HeatGrid } from './HeatGrid';
import { SequenceDiagram } from './SequenceDiagram';
import { SystemTiers } from './SystemTiers';
import { TransitMap } from './TransitMap';
import { ScaleZoom } from './zoom';

/**
 * The cameras made of HTML (System, Heat, Sequence, List) register their zoom through CSS scale;
 * the SVG ones (Map, Graph, Mind map) register their viewBox pan/zoom themselves. The 3D tower
 * registers none (its orbit controls own the wheel), so the overlay disables +, − and Fit there.
 * Wrapped once at module level, so a camera keeps its identity (and its state) across renders.
 */
function scaled(Camera: ComponentType<SceneProps>): ComponentType<SceneProps> {
    function Scaled(p: SceneProps) { return <ScaleZoom><Camera {...p} /></ScaleZoom>; }
    Scaled.displayName = `Scaled(${Camera.displayName ?? Camera.name})`;
    return Scaled;
}

const GraphScene = lazy(() => import('../scene/GraphScene'));

function GraphCamera({ graph, drawn, lens, labels, selected, onSelect }: SceneProps) {
    return (
        <Graph2D
            rootId={graph.scope.rootId} nodes={drawn.nodes} edges={drawn.edges} lens={lens} selected={selected}
            onSelect={onSelect} planeLabel={(partition) => partition || labels.partitionNone} labels={labels} label={labels.regionLabel}
        />
    );
}

function TowerCamera(p: SceneProps) {
    const { graph, drawn, lens, labels, selected, surface } = p;
    // The overlay channels: height = size, fill band = ring, wireframe = untested, pipe width = width.
    const channels = useMemo(
        () => ({ nodes: nodeChannels(drawn.nodes, surface.stations, surface.overlay), pipeWidth: pipeWidthOf(surface.stations, surface.overlay) }),
        [drawn.nodes, surface.stations, surface.overlay],
    );
    // Pipes past the cap are not drawn; say so rather than silently showing fewer.
    const capped = channels.pipeWidth !== undefined && drawn.edges.length > MAX_PIPES;
    return (
        <>
            <Suspense fallback={<GraphCamera {...p} />}>
                <GraphScene
                    rootId={graph.scope.rootId} nodes={drawn.nodes} edges={drawn.edges} lens={lens} selected={selected}
                    focus={p.focus} onSelect={p.onSelect} label={labels.regionLabel} planeLabel={(partition) => partition || labels.partitionNone}
                    reducedMotion={p.reducedMotion} channels={channels}
                />
            </Suspense>
            {capped && (
                <p data-testid="kg-pipes-capped" style={{ position: 'absolute', insetInlineStart: 8, bottom: 8, margin: 0, padding: '2px 8px', borderRadius: 6, fontSize: 11, background: cssVar('panel'), color: cssVar('muted') }}>
                    {fillTemplate(labels.surface.pipesCapped, { count: MAX_PIPES })}
                </p>
            )}
        </>
    );
}

function MindCamera({ drawn, graph, labels, rootTitle, selected, onSelect, onShow }: SceneProps) {
    return (
        <MindMap
            nodes={drawn.nodes} findings={graph.findings} rootTitle={rootTitle} selected={selected}
            onSelect={onSelect} onShow={onShow} labels={labels} label={labels.regionLabel}
        />
    );
}

function ListCamera(p: SceneProps) {
    return (
        <ListFallback
            graph={p.graph} nodes={p.drawn.nodes} lens={p.lens} labels={p.labels} selected={p.selected}
            onSelect={p.onSelect} onShow={p.onShow} onCompose={p.onCompose} evidence={p.evidence} onOpenSource={p.onOpenSource}
        />
    );
}

function TransitCamera({ surface, labels, reducedMotion }: SceneProps) {
    const q = questionDef(surface.question);
    const noteOf = (st: Station): string | null => {
        if (surface.lit && !surface.lit.has(st.id)) return null;
        const note = q.note(st);
        if (!note) return null;
        const value = note.key === 'layers' ? labels.surface.layers[note.value as keyof typeof labels.surface.layers] ?? note.value : note.value;
        return fillTemplate(labels.surface.notes[note.key], { value });
    };
    return (
        <TransitMap
            stations={surface.stations} lines={surface.lines} overlay={surface.overlay} labels={labels} lit={surface.lit}
            lineId={surface.line?.id ?? null} selectedStation={surface.station?.id ?? null} pins={surface.pins} noteOf={noteOf}
            reducedMotion={reducedMotion} onSelectStation={surface.selectStation} onSelectLine={surface.selectLine} label={labels.regionLabel}
        />
    );
}

const SystemCamera = scaled(SystemTiers);
const HeatCamera = scaled(HeatGrid);
const SequenceCamera = scaled(SequenceDiagram);
const ListScaled = scaled(ListCamera);

/**
 * `switcher: false` keeps a camera registered (the path strip's Sequence toggle draws it, a host
 * may still ask for it by id) without a button in the scene overlay's View group.
 */
export const CAMERAS: readonly CameraDef[] = [
    { id: 'transit', labelKey: 'viewTransit', component: TransitCamera, available: (_graph, env) => env.hasLines },
    { id: 'system', labelKey: 'viewSystem', component: SystemCamera, available: () => true },
    { id: 'graph', labelKey: 'viewGraph', component: GraphCamera, available: () => true },
    { id: 'map', labelKey: 'viewMap', component: MindCamera, available: () => true },
    { id: '3d', labelKey: 'view3d', component: TowerCamera, available: (_graph, env) => env.webgl },
    { id: 'heat', labelKey: 'viewHeat', component: HeatCamera, available: () => true },
    { id: 'sequence', labelKey: 'viewSequence', component: SequenceCamera, available: (_graph, env) => env.hasLines, switcher: false },
    { id: 'list', labelKey: 'viewList', component: ListScaled, available: () => true },
];
