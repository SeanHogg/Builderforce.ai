/**
 * The camera registry: every way the surface draws the graph, as rows. The order here is the
 * order of the switcher. A later camera (System, Heat, Sequence) is one row plus its id in
 * `ViewMode`; `ViewSurface` and the switcher read this array and know no camera by name.
 */

import { lazy, Suspense, useCallback, useMemo, type ComponentType, type ReactNode } from 'react';
import { fillTemplate } from '../labels';
import { counted } from './plural';
import { Graph2D } from '../graph2d/Graph2D';
import { ListFallback } from '../ListFallback';
import { MindMap } from '../map/MindMap';
import { placementLabel } from '../placement';
import { MAX_PIPES, nodeChannels, pipeWidthOf } from '../scene/channels';
import { edgeCaption } from '../scene/edgeBudget';
import { cssVar } from '../scene/themeColors';
import { makeOverlay } from './overlays';
import { litStations, questionDef } from './questions';
import type { CameraDef, SceneProps } from './registry';
import { stationRolesOf } from './towerHighlight';
import type { Station } from './stations';
import { Segmented } from './ui';
import { TYPE } from './ui/type';
import { ArchitectureStyleCamera } from './ArchitectureStyleCamera';
import { FourPlusOneCamera } from './FourPlusOneCamera';
import { HeatGrid } from './HeatGrid';
import { KeyFeaturesCamera } from './KeyFeaturesCamera';
import { hasSourceFiles } from './sourceFiles';
import { hasLayeredCode } from './style/signals';
import { SequenceDiagram } from './SequenceDiagram';
import { SystemTiers } from './SystemTiers';
import { TransitMap } from './TransitMap';
import { ScaleZoom } from './zoom';

/**
 * The cameras made of HTML (System, Heat, Sequence, List) register their zoom through CSS scale;
 * the SVG ones (Map, flat or towers; Graph; Mind map) register their viewBox pan/zoom themselves. The WebGL
 * 3D view registers none (its orbit controls own the wheel), so the overlay disables +, − and Fit there.
 * Wrapped once at module level, so a camera keeps its identity (and its state) across renders.
 */
function scaled(Camera: ComponentType<SceneProps>): ComponentType<SceneProps> {
    function Scaled(p: SceneProps) { return <ScaleZoom><Camera {...p} /></ScaleZoom>; }
    Scaled.displayName = `Scaled(${Camera.displayName ?? Camera.name})`;
    return Scaled;
}

const GraphScene = lazy(() => import('../scene/GraphScene'));

/** "Showing 15,000 of 113,975 links": said whenever the link budget leaves some out, so fewer lines are never a silent change. */
export function CapNote({ testId, children }: { testId: string; children: ReactNode }) {
    return (
        <p data-testid={testId} style={{ position: 'absolute', insetInlineStart: 8, bottom: 8, margin: 0, padding: '2px 8px', borderRadius: 6, ...TYPE.meta, background: cssVar('panel') }}>
            {children}
        </p>
    );
}

export function EdgesCapped({ total, labels }: { total: number; labels: SceneProps['labels'] }) {
    const note = edgeCaption(total);
    if (!note.capped) return null;
    return (
        <CapNote testId="kg-edges-capped">
            {fillTemplate(labels.surface.scene.edgesCapped, { shown: note.shown.toLocaleString(), total: note.total.toLocaleString() })}
        </CapNote>
    );
}

/** The SVG graph alone: what the 3D view shows while its chunk loads (it carries no caption, the 3D camera has its own). */
function GraphView({ graph, drawn, lens, labels, selected, onSelect }: SceneProps) {
    return (
        <Graph2D
            rootId={graph.scope.rootId} nodes={drawn.nodes} edges={drawn.edges} lens={lens} selected={selected}
            onSelect={onSelect} planeLabel={(key) => placementLabel(key, graph, labels)} labels={labels} label={labels.regionLabel}
        />
    );
}

function GraphCamera(p: SceneProps) {
    return (
        <>
            <GraphView {...p} />
            <EdgesCapped total={p.drawn.edges.length} labels={p.labels} />
        </>
    );
}

/** The WebGL 3D view: towers on planes, orbit controls. Its own camera beside the Map's 2.5D towers look. */
function Scene3DCamera(p: SceneProps) {
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
            <Suspense fallback={<GraphView {...p} />}>
                <GraphScene
                    rootId={graph.scope.rootId} nodes={drawn.nodes} edges={drawn.edges} lens={lens} selected={selected}
                    focus={p.focus} onSelect={p.onSelect} label={labels.regionLabel} planeLabel={(key) => placementLabel(key, graph, labels)}
                    reducedMotion={p.reducedMotion} channels={channels} roles={surface.highlight?.roles}
                />
            </Suspense>
            {/* Lines past the edge budget are not drawn either (pipes have their own cap above). */}
            {channels.pipeWidth === undefined && <EdgesCapped total={drawn.edges.length} labels={labels} />}
            {capped && <CapNote testId="kg-pipes-capped">{counted(labels, 'pipesCapped', MAX_PIPES)}</CapNote>}
        </>
    );
}

function MindCamera({ graph, labels, rootTitle, selected, focus, onSelect, onShow }: SceneProps) {
    // The map counts and lists the folders of the WHOLE reviewed graph, not the capped set the node views draw (2,000, or 60 on a phone).
    const files = useMemo(() => graph.nodes.filter((n) => n.kind === 'file'), [graph.nodes]);
    return (
        <MindMap
            nodes={files} findings={graph.findings} rootTitle={rootTitle} selected={selected} focus={focus}
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

const NO_PINS: readonly never[] = [];
const noop = (): void => undefined;

/**
 * The Map's look: flat, or the same stations, lines and ends as towers and pipes (2.5D). One camera, one layout:
 * the toggle only changes how the marks are drawn, so switching never lays the map out again.
 */
function MapLook({ towers, labels, onChange }: { towers: boolean; labels: SceneProps['labels']; onChange(on: boolean): void }) {
    const look = labels.surface.map.look;
    return (
        <div data-testid="kg-map-look" style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 12px 0', minWidth: 0 }}>
            <Segmented
                label={look.label} value={towers ? 'towers' : 'flat'} onChange={(id) => onChange(id === 'towers')}
                items={[{ id: 'flat', label: look.flat, title: look.flatTip }, { id: 'towers', label: look.towers, title: look.towersTip }]}
            />
        </div>
    );
}

/** The Map camera: the transit scene, flat or (the look toggle) with towers for stations and pipes for lines. */
function TransitCamera({ surface, labels, reducedMotion, graph }: SceneProps) {
    const variant = surface.towers ? 'tower' : 'map';
    const q = questionDef(surface.question);
    // Inside a drilled level the map draws that level's own stations and lines, with the bindings unchanged,
    // and the active question and lens are asked of THAT level's stations and lines.
    const { drill } = surface, view = drill.view;
    const overlay = useMemo(() => (view ? makeOverlay(surface.overlay.bindings, view.stations.stations) : surface.overlay), [view, surface.overlay]);
    const stationId = view ? drill.selected : surface.station?.id ?? null;
    const lit = useMemo(() => {
        if (!view) return surface.lit;
        const line = view.lines.lines[0] ?? null;
        return litStations(surface.question, view.stations.stations, { lines: view.lines, line, selected: stationId ? view.stations.byId.get(stationId) ?? null : null, family: surface.family });
    }, [view, surface.lit, surface.question, surface.family, stationId]);
    // Stable, so the map's label placement is only redone when what it says changes.
    const noteOf = useCallback((st: Station): string | null => {
        if (lit && !lit.has(st.id)) return null;
        const note = q.note(st);
        if (!note) return null;
        const value = note.key === 'layers' ? labels.surface.layers[note.value as keyof typeof labels.surface.layers] ?? note.value : note.value;
        return fillTemplate(labels.surface.notes[note.key], { value });
    }, [lit, q, labels]);
    const levelNote = drill.notice ? fillTemplate(labels.surface.map.drillReset, { name: drill.notice }) : view?.noSymbols ? labels.surface.map.noSymbolsNote : null;
    const highlight = variant === 'tower' ? surface.highlight : null;
    const stationModel = view?.stations ?? surface.stations;
    const roles = useMemo(() => (highlight ? stationRolesOf(highlight.roles, stationModel) : undefined), [highlight, stationModel]);
    return (
        <>
        <MapLook towers={surface.towers} labels={labels} onChange={surface.setTowers} />
        <TransitMap
            roles={roles} types={view ? undefined : surface.types}
            stations={view?.stations ?? surface.stations} lines={view?.lines ?? surface.lines} overlay={overlay} labels={labels} lit={lit}
            lineId={view ? view.lines.lines[0]?.id ?? null : surface.line?.id ?? null} selectedStation={stationId}
            pins={view ? NO_PINS : surface.pins} noteOf={noteOf} reducedMotion={reducedMotion}
            onSelectStation={view ? drill.select : surface.selectStation} onSelectLine={view ? noop : surface.selectLine} label={labels.regionLabel}
            graph={graph} order={view?.order} leaves={view?.leaves} levelNote={levelNote} question={surface.question} loading={drill.loading}
            canEnter={drill.canEnter} onEnter={drill.enter} onQuestion={surface.setQuestion} onOpenPanel={surface.openPanel} variant={variant}
        />
        </>
    );
}

const SystemCamera = scaled(SystemTiers);
const HeatCamera = scaled(HeatGrid);
const SequenceCamera = scaled(SequenceDiagram);
const ListScaled = scaled(ListCamera);
const StyleCamera = scaled(ArchitectureStyleCamera);
const FeaturesCamera = scaled(KeyFeaturesCamera);

/**
 * `switcher: false` keeps a camera registered (the path strip's Sequence toggle draws it, a host
 * may still ask for it by id) without a button in the scene overlay's View group.
 */
export const CAMERAS: readonly CameraDef[] = [
    { id: 'transit', labelKey: 'viewTransit', component: TransitCamera, available: (_graph, env) => env.hasLines },
    { id: 'system', labelKey: 'viewSystem', component: SystemCamera, available: () => true },
    { id: 'graph', labelKey: 'viewGraph', component: GraphCamera, available: () => true },
    { id: 'map', labelKey: 'viewMap', component: MindCamera, available: () => true },
    { id: '3d', labelKey: 'view3d', component: Scene3DCamera, available: (_graph, env) => env.webgl },
    { id: 'heat', labelKey: 'viewHeat', component: HeatCamera, available: () => true },
    // The architecture cameras read the source files only: a graph with none (docs, nothing reviewed) hides them.
    { id: '4plus1', labelKey: 'viewFourPlusOne', component: FourPlusOneCamera, available: (graph) => hasSourceFiles(graph) },
    { id: 'style', labelKey: 'viewStyle', component: StyleCamera, available: (graph) => hasLayeredCode(graph) },
    { id: 'features', labelKey: 'viewFeatures', component: FeaturesCamera, available: (graph) => hasSourceFiles(graph) },
    { id: 'sequence', labelKey: 'viewSequence', component: SequenceCamera, available: (_graph, env) => env.hasLines, switcher: false },
    { id: 'list', labelKey: 'viewList', component: ListScaled, available: () => true },
];
