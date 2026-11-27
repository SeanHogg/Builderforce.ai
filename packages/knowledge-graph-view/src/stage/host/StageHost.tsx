/**
 * The production stage host (PRD 43 P1 make-default, B1a): the ONE stage every placement camera draws on. `ViewSurface`
 * mounts it for each `CAMERAS` row that names a `placement`, at the same place in the tree, so a camera switch keeps the
 * renderer, the MarkSet and its meshes — a switch is a cached placement swap + tween, never a new mesh (rule 1, 6).
 *
 * Everything it draws comes from the surface (`useSurface`): the graph, the lens and overlay bindings (`markPaint`),
 * the question, its lit set and the anti-pattern roles of Show in towers, the selected line (the path highlight and the
 * Sequence's entry), the drill (`useStageWiring`) and the findings pins. The camera chrome is the surface's own (the
 * overlay's camera switcher and zoom buttons, the stage's depth control, the Sequence's band control); none is the
 * stage's own. Cards and `onOpenSource` go through `useStageWiring`.
 *
 * The code pane (`wiring.code`, PRD 43 Part C1) is docked on the left of a box wide enough to split (the outline of the
 * level; a file once one is read, and then the map sits under its zoom-path bar, `CodeTrail`); the stage, its cards and
 * its pins are laid out in the map's own box, so every projection into it starts at its origin. A box too narrow to
 * split shows ONE of the code and the picture of the same location, under a Code | Picture switch. A hidden pane leaves a
 * tab on the left edge to bring it back.
 *
 * No WebGL, or a context lost for good: the List (the registry's `fallback` row) instead (B8).
 */

import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { fillTemplate } from '../../labels';
import { useComputed } from '../../compute/useComputed';
import { viewportBandOf } from '../../compute/tasks/placement/request';
import { useContainerSize } from '../../environment';
import { cssVar, useThemeColors } from '../../scene/themeColors';
import { EdgesCapped } from '../../surface/CapNote';
import { LayingOut } from '../../surface/LayingOut';
import { ScaleFoot } from '../../surface/ScaleFoot';
import type { SceneProps } from '../../surface/registry';
import { codeCompareOf, paintDiffEntries, type CompareView } from '../../surface/compareModel';
import { showsTowers } from '../../surface/useShowInTower';
import { TYPE } from '../../surface/ui/type';
import { onePaneStage } from '../../layout';
import { codePaneWidth, maxCodePaneWidth, MIN_CODE_PANE_WIDTH, recordsForCode, targetForMark } from '../overlay/CodeDock';
import type { DiagramId } from '../../surface/diagrams/catalog';
import { fileRefOf } from '../../surface/stations';
import { DiagramPicker } from './DiagramPicker';
import { CodePaneSplitter } from './CodePaneSplitter';
import { ColourLegend } from './ColourLegend';
import { SystemVisibility, useSystemVisibility } from './SystemVisibility';
import { LevelRail, useLevelRail } from './LevelRail';
import { depthCrumbs } from '../../surface/DepthTrail';
import { PanelChevron } from '../../surface/ui/PanelChevron';
import { CODE_BAR_PX } from '../overlay/CodeTrail';
import { useStageWiring } from '../overlay/useStageWiring';
import type { StageRenderer } from '../renderer';
import { legendTypesOf } from '../rig/stageLegend';
import { Stage } from '../Stage';
import { ZOOM_BANDS, type ZoomBand } from '../labels/lod';
import { useStageRenderer } from '../stageHooks';
import { StageBusContext, stageBus } from '../anchor/stageBus';
import type { PlacementCamera } from '../types';
import { StageFactoryContext } from './StageFactoryContext';
import { StagePins } from './StagePins';
import { useDrillIdentity } from './useDrillIdentity';
import { useHeldFrame } from './useHeldFrame';
import { useSideMask } from './useSideMask';
import { holdsForNestBasis, useNestBasis } from './useNestBasis';
import { useStageStrings } from './stageStrings';
import type { CodeFile, HierarchyView } from '../../surface/codeHierarchy';
import { SurfaceErrorBoundary } from '../../surface/SurfaceErrorBoundary';
import { useRenderTrace } from '../../renderTrace';

/** What the host threads to the code pane (PRD 43 Part C): its visibility, and the actions another slice wires. */
export interface StageCodeProps {
    /** The pane is shown (`usePanelVisibility`'s `code` slot; default true). */
    codeShown?: boolean | undefined;
    onToggleCode?: (() => void) | undefined;
    /** Simulate / Restructure a symbol by ref; the lens row and the outline action are hidden while absent. */
    onSimulate?: ((ref: string) => void) | undefined;
    onRestructure?: ((ref: string) => void) | undefined;
    /** The restructure's file read is in flight: the card's Restructure is disabled meanwhile. */
    restructureLoading?: boolean | undefined;
    lines?: ReactNode;
    hierarchy?: HierarchyView | undefined;
    onHierarchy?: ((view: HierarchyView) => void) | undefined;
    codeFiles?: ReadonlyMap<string, CodeFile> | undefined;
    codeRef?: string | null | undefined;
    onCodeRef?: ((ref: string | null) => void) | undefined;
}

/** The open comparison, if any (PRD 43 C5): the side on show, what it lacks, how it differs. The graph the host hands in is already the union. */
export interface StageCompareProps {
    compare?: CompareView | null | undefined;
}

/** The ONE 3D / Flat switch's state (PRD 43 C4), owned by the view: flat = tilt 0 on every camera. */
export interface StageFlatProps {
    flat?: boolean | undefined;
}

export interface StageHostProps extends SceneProps, StageCodeProps, StageCompareProps, StageFlatProps {
    /** The placement the active camera row names. */
    camera: PlacementCamera;
    /** The scale sentence (`ScaleLine`), drawn under the Colour-by legend at the bottom-left; the view's chrome hands it in. */
    scale?: ReactNode;
    tools?: ReactNode;
    journey?: ReactNode;
    notice?: ReactNode;
    /** The DOM camera shown when the stage cannot draw (no WebGL, a lost context). */
    fallback: ComponentType<SceneProps>;
}

// Exactly its scene box (the layout gives that box its minimum, `sceneMinHeight`): a floor here made the stage taller
// than the box, so a fill camera scrolled inside it and drew only the strip on screen.
const BOX = { position: 'relative', width: '100%', height: '100%' } as const;
const UNMEASURED = { width: 960, height: 600 } as const;

function StageFallback({ fallback: Fallback, ...p }: StageHostProps) {
    const [diagram, setDiagram] = useState<DiagramId | null>(null);
    const { graph, surface } = p;
    const frame = surface.drill.stack.at(-1);
    const scope = p.codeRef ?? (frame?.level !== 'package' ? frame?.ref : undefined) ?? p.selected ?? surface.station?.refs[0] ?? null;
    const symbols = surface.drill.symbols;
    const load = surface.drill.loadFileSymbols;
    useEffect(() => {
        if (diagram && scope) load?.(fileRefOf(scope));
    }, [diagram, scope, load]);
    const records = useMemo(() => diagram ? recordsForCode(graph, { symbols }) : [], [diagram, graph, symbols]);
    return <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {p.tools}
        <DiagramPicker active={diagram} onPick={setDiagram} graph={graph} records={records} scope={scope}
            stations={surface.stations.stations} flat labels={p.labels} onOpen={(ref) => {
                const target = targetForMark(ref, ref, records);
                if (target) p.onOpenSource?.({ path: target.path, startLine: target.startLine, endLine: target.startLine });
            }} />
        {!diagram && <div style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}>
            <Fallback {...p} /><ScaleFoot>{p.scale}</ScaleFoot>{p.notice}
        </div>}
        {p.journey}
    </div>;
}

export default function StageHost({ fallback: Fallback, ...p }: StageHostProps) {
    const factory = useContext(StageFactoryContext);
    const renderer = useStageRenderer(factory);
    const trace = useRenderTrace();
    const [failedAt, setFailedAt] = useState<string | null>(null);
    const location = `${p.graph.scope.rootId}|${p.camera}|${p.surface.drill.stack.map((f) => f.ref).join(' > ')}`;
    useEffect(() => { setFailedAt((failed) => failed === location ? failed : null); }, [location]);
    const onLost = useCallback(() => {
        trace('WebGL context recovery timed out', location, new Error('WebGL context unavailable'));
        setFailedAt(location);
    }, [trace, location]);
    const onRenderError = useCallback((error: Error) => { trace('frame failed', location, error); setFailedAt(location); }, [trace, location]);
    useEffect(() => {
        if (renderer !== null) trace('renderer', `${location} renderer=${renderer === false ? 'list (WebGL 2 unavailable)' : renderer.kind}`);
    }, [trace, renderer, location]);
    const fallback = <StageFallback key={p.graph.scope.rootId} {...p} fallback={Fallback} />;
    if (renderer === false || failedAt === location) return fallback;
    if (!renderer) return <div style={{ ...BOX, display: 'flex', flexDirection: 'column' }} data-stage-host>
        {p.tools}<div style={{ flex: 1, minHeight: 0, position: 'relative' }}><LayingOut labels={p.labels} /></div>{p.journey}
    </div>;
    return (
        <SurfaceErrorBoundary labels={p.labels} resetKey={location} fallback={fallback}
            onError={(error, info) => trace('stage failed', `${location}${info.componentStack ?? ''}`, error)}>
            <StageBody {...p} renderer={renderer} onLost={onLost} onRenderError={onRenderError} onComputeError={() => setFailedAt(location)} />
        </SurfaceErrorBoundary>
    );
}

/** The Map's ladder: system, class, method, code (drill depth 0..3). Going in stays with the wheel, double-click and Enter. */
const MAP_BANDS: readonly ZoomBand[] = ZOOM_BANDS.map((b) => b.band);

function StageBody({ renderer, onLost, onRenderError, onComputeError, camera, scale, codeShown, onToggleCode, onSimulate, onRestructure, restructureLoading, compare, flat = false, tools, journey, notice, ...p }: Omit<StageHostProps, 'fallback'> & { renderer: StageRenderer; onLost(): void; onRenderError(error: Error): void; onComputeError(): void }) {
    const box = useRef<HTMLDivElement>(null);
    const picture = useRef<HTMLDivElement>(null);
    const codePaneId = useId();
    const [preferredCodeWidth, setPreferredCodeWidth] = useState<number>();
    const [diagramPick, setDiagramPick] = useState<{ root: string; camera: PlacementCamera; id: DiagramId } | null>(null);
    // Before the box is measured (and where nothing measures it: jsdom) the stage is laid out for a standard box.
    const measured = useContainerSize(box);
    const pictureSize = useContainerSize(picture);
    const boxWidth = measured.width || UNMEASURED.width, boxHeight = measured.height || UNMEASURED.height;
    const colors = useThemeColors(box.current);
    const { graph, surface, labels, codeRef, codeFiles } = p;
    const activeDiagram = diagramPick?.root === graph.scope.rootId && diagramPick.camera === camera ? diagramPick.id : null;
    const activeFrame = surface.drill.stack.at(-1);
    const graphScope = activeFrame?.level !== 'package' ? activeFrame?.ref ?? null : null;
    const activeFile = surface.station?.refs[0];
    const diagramScope = codeRef ?? graphScope ?? (activeFile && codeFiles?.get(activeFile)?.isCode ? activeFile : null);
    const loadedSymbols = surface.drill.symbols;
    const loadDiagramSymbols = surface.drill.loadFileSymbols;
    useEffect(() => {
        if (activeDiagram && diagramScope) loadDiagramSymbols?.(fileRefOf(diagramScope));
    }, [activeDiagram, diagramScope, loadDiagramSymbols]);
    const diagramRecords = useMemo(() => activeDiagram ? recordsForCode(graph, { symbols: loadedSymbols }) : [], [activeDiagram, graph, loadedSymbols]);
    // The box's band, not the map's: opening the code pane does not lay the map out again.
    const band = viewportBandOf(boxWidth);
    const strings = useStageStrings(labels);

    // The MarkSet is built once per graph: a comparison hands the union graph for its whole run, and a commit's changed set is paint, never an input here.
    const markResult = useComputed('markSet', { graph, strings }, [graph, strings], null, { keep: false });
    const marks = markResult.value;
    const generation = marks?.generation ?? 0;
    const codeCompare = useMemo(() => codeCompareOf(compare), [compare]);
    const wiring = useStageWiring(p, renderer, marks, boxWidth, {
        shown: codeShown, onToggleCode, onSimulate, onRestructure, restructureLoading, compare: codeCompare, sequence: camera === 'sequence', factsGraph: compare?.sideGraph,
        lines: p.lines, hierarchy: p.hierarchy, onHierarchy: p.onHierarchy, codeFiles: p.codeFiles, codeRef: p.codeRef, onCodeRef: p.onCodeRef,
    });
    const drilled = !!surface.drill.view;
    // The map's own box is measured below the toolbar and above the journey.
    const code = wiring.code;
    const codeWidth = code.split ? codePaneWidth(boxWidth, preferredCodeWidth) : 0;
    const showCodeHalf = code.visible && !code.split;
    const barPx = code.reading && !showCodeHalf ? CODE_BAR_PX : 0;
    const width = Math.max(1, boxWidth - codeWidth), height = Math.max(1, (pictureSize.height || boxHeight) - barPx);

    // Paint: the lens, the overlay, the question (+ its family) and what it lights; Show in towers' roles while a tower
    // picture is on show (the 3D scene, or the Map tilted).
    const bindings = surface.overlay.bindings;
    const lit = useMemo(() => (!drilled && surface.lit ? [...surface.lit] : null), [drilled, surface.lit]);
    const towers = showsTowers(camera === 'map' ? 'transit' : camera === '3d' ? '3d' : 'graph', surface.towers);
    const highlight = towers ? surface.highlight : null;
    const roles = useMemo(() => (highlight ? [...highlight.roles] : null), [highlight]);
    // Compare: how each ref differs on the side shown (a diff tone over the slot's own); a station mark is painted by its id.
    const stations = surface.stations;
    const visibility = useSystemVisibility(graph.scope.rootId, stations.stations, surface.lines?.systems, labels.surface.systems.loose);
    const { hiddenStations } = visibility;
    const diagramStations = useMemo(() => {
        const hidden = new Set(hiddenStations);
        return stations.stations.filter((station) => !hidden.has(station.id));
    }, [stations.stations, hiddenStations]);
    const diff = useMemo(() => (compare?.diff.size ? paintDiffEntries(compare.diff, stations) : null), [compare?.diff, stations]);
    const paint = useComputed('markPaint', {
        graph, generation, lensId: p.lens.id, questionId: surface.question, overlay: bindings, lit, roles, family: surface.family, diff,
    }, [graph, generation, p.lens.id, surface.question, bindings, lit, roles, surface.family, diff], null, { enabled: !!marks }).value;

    // Placement: Map always (its drill and unfold wiring read it; the worker caches it), and the camera on show.
    const channels = useMemo(() => ({ size: bindings.size, width: bindings.width }), [bindings.size, bindings.width]);
    const lineId = surface.line?.id ?? null;
    // The Sequence's band is the semantic zoom's (its participants' size, or the band control that flies to it): one state, not two.
    const seqBand = wiring.zoom.sequenceLod;
    const lod = camera === 'sequence' ? seqBand : 0;
    // Flow and Sequence follow the selected line; at code depth the Sequence draws the open method's calls (`PlacementReq.method`);
    // Flow follows the drilled level (system, component, class).
    const walks = camera === 'sequence' || camera === 'flow';
    const pathId = walks ? (diagramScope ? `node:${diagramScope}` : lineId) : null;
    const method = camera === 'sequence' ? wiring.method : null;
    const otherDrill = camera === 'flow' ? wiring.map.drill : null;
    const symbols = wiring.map.symbols;
    // The Sequence draws a method's calls (no bands): the zoom gates on the same condition the request does.
    const { setMethodOpen, zoomToBand } = wiring.zoom;
    const methodOpen = camera === 'sequence' && !!method;
    useEffect(() => { setMethodOpen(methodOpen); }, [setMethodOpen, methodOpen]);
    // The tilt the worker bakes in: Flat is 0 on every placement; 3D is the Map's full tower, the orbit's, else the placement's resting tilt.
    const mapDepth = flat ? 0 : 1;
    const place = (cam: PlacementCamera, depth: number | undefined, drill: string | null, l: number, path: string | null, m: string | null = null) => ({
        graph, generation, camera: cam, drill, unfolded: null, pins: [], pathId: path, viewportBand: band, lod: l, channels,
        ...(depth === undefined ? {} : { depth }),
        ...(m ? { method: m } : {}),
        ...(cam === 'map' && !drill && hiddenStations.length ? { hiddenStations } : {}),
        // Flow reads symbols only inside a drilled level; at system level they are not an input (nor part of its key).
        ...(drill || cam === 'sequence' ? { symbols } : {}),
    });
    const mapResult = useComputed('placement', place('map', mapDepth, wiring.map.drill, 0, null), [graph, generation, band, channels, wiring.map.drill, symbols, mapDepth, hiddenStations], null, { enabled: !!marks, scope: [generation, wiring.map.drill] });
    const map = mapResult.value;
    const other = camera === 'map' ? 'graph' : camera;
    // The zoom's nesting survives a rebuilt world: its entries are re-derived from the ancestor levels' placements of the new generation.
    const nestBasis = useNestBasis(marks, surface.drill.stack, camera === 'map' && wiring.zoom.nests, (d) => place('map', mapDepth, d, 0, null), [graph, generation, band, channels, symbols, mapDepth, hiddenStations]);
    const setBasis = wiring.zoom.setBasis;
    useEffect(() => { setBasis(nestBasis.basis); }, [setBasis, nestBasis.basis]);
    const otherDepth = other === '3d' ? 1 : flat ? 0 : undefined;
    const otherSymbols = otherDrill || other === 'sequence' ? symbols : null;
    const otherResult = useComputed('placement', place(other, otherDepth, otherDrill, lod, pathId, method), [graph, generation, band, channels, other, lod, pathId, otherSymbols, otherDepth, otherDrill, method], null, { enabled: !!marks && camera !== 'map', scope: [generation, other, otherDrill] });
    const otherPlacement = otherResult.value;
    // Before / After: the same placement with the slots the side lacks shrunk onto their anchor (the tween moves them).
    const placement = useSideMask(camera === 'map' ? wiring.patchMap(map) : otherPlacement, marks, compare);
    // A zoom-entered level whose entry went stale with the rebuilt world waits for the placements it re-nests from (not when they failed: nothing is coming).
    const nesting = camera === 'map' && !!map && holdsForNestBasis(nestBasis.pending, nestBasis.basis, wiring.zoom.awaitsBasis(map));
    const ready = !!marks && !!placement && placement.generation === marks.generation && !nesting;
    // The last ready frame bridges a regeneration of the SAME root, camera and drill depth (a live or growth repaint, a re-anchor);
    // any navigation (another root, camera or level) drops it. The Stage itself stays mounted on the MarkSet, as before.
    const drillIdentity = useDrillIdentity(surface.drill.stack, surface.drill.reanchored.moves);
    const frame = useHeldFrame(`${graph.scope.rootId}|${camera}|${drillIdentity}`, ready ? { marks, paint, placement } : null);
    const shownMarks = frame?.marks ?? marks;
    const computeFailed = markResult.failed || (camera === 'map' ? mapResult.failed : otherResult.failed);
    useEffect(() => { if (computeFailed) onComputeError(); }, [computeFailed, onComputeError]);
    const trace = useRenderTrace();
    useEffect(() => {
        if (!frame) return;
        const { placement: placed } = frame;
        trace('placement ready', `camera=${camera} level=${drillIdentity} generation=${placed.generation} size=${width}x${height} marks=${placed.a11y.length} bounds=${placed.bounds.min.join(',')} to ${placed.bounds.max.join(',')}`);
    }, [trace, camera, drillIdentity, frame?.placement, width, height]);

    // The selection: the stage's own (a mark picked here), else the surface's (a search hit, the List).
    const fileSlot = p.codeRef && frame ? frame.marks.keys.indexOf(`node:${p.codeRef}`) : -1;
    const fileOnStage = fileSlot >= 0 && (frame?.placement.scale[fileSlot] ?? 0) > 0;
    const stationOnStage = surface.station && frame ? frame.marks.keys.indexOf(`st:${surface.station.id}`) : -1;
    const selected = p.codeRef && fileOnStage ? `node:${p.codeRef}`
        : p.codeRef && stationOnStage >= 0 && (frame?.placement.scale[stationOnStage] ?? 0) > 0 ? `st:${surface.station!.id}`
        : wiring.selected ?? (p.selected && p.selected !== wiring.dismissed ? `node:${p.selected}` : null);
    const bus = useMemo(() => stageBus(renderer), [renderer]);

    const zoom = labels.surface.zoom;
    const nav = useMemo(() => ({ nav: labels.surface.nav, zoomIn: labels.zoomIn, zoomOut: labels.zoomOut, zoomReset: labels.zoomReset }), [labels]);
    const drill = surface.drill;
    const levelNote = camera !== 'map' ? null
        : drill.notice ? fillTemplate(labels.surface.map.drillReset, { name: drill.notice }) : drill.view?.noSymbols ? labels.surface.map.noSymbolsNote : null;
    const sc = labels.surface.code;
    const caption = ready ? placement.caption : null;
    // The level rail: the Sequence has its three bands, every other camera the Map's five levels; a click goes to that level.
    const narrowStage = onePaneStage(boxWidth);
    const sequenceRail = camera === 'sequence';
    const picked = wiring.map.stationOfKey(selected);
    const crumbs = depthCrumbs(drill.stack, null, labels.surface.depth);
    const rail = useLevelRail({
        zoom, sequence: sequenceRail, band: sequenceRail ? seqBand : MAP_BANDS.indexOf(wiring.zoom.band), linePicked: !!wiring.zoom.code && !!selected,
        toBand: sequenceRail ? zoomToBand : wiring.toBand, into: picked && drill.canEnter(picked.id).can ? picked.name : null,
        // The next zoom out lands in the drilled level (from the code), else in the level above it.
        backTo: sequenceRail ? null : (wiring.zoom.code ? crumbs.at(-1) : crumbs.at(-2))?.name ?? null, selected,
    });
    const { wheelStep } = wiring, noteStep = rail.noteStep;
    const onWheelStep = useCallback((dir: 1 | -1) => { noteStep(dir); wheelStep(dir); }, [noteStep, wheelStep]);

    // Esc clears the pick, else goes out, from anywhere over a shown map (not while typing, in a dialog, or when a pane already took it).
    const onEscape = wiring.onEscape;
    useEffect(() => {
        const el = box.current;
        if (!el) return undefined;
        const key = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            if ((e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return;
            if (!el.isConnected || el.closest('[hidden], [aria-hidden="true"]')) return;
            e.preventDefault();
            onEscape();
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, [onEscape]);

    return (
        <div ref={box} style={{ ...BOX, display: 'grid', gridTemplateColumns: code.split ? `${codeWidth}px minmax(0, 1fr)` : 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' }} data-stage-host data-stage-camera={camera}>
            {code.split && (
                <div id={codePaneId} data-code-split style={{ position: 'relative', minHeight: 0, minWidth: 0 }}>
                    {code.pane}
                    <CodePaneSplitter controls={codePaneId} label={labels.surface.code.dockAria}
                        width={codeWidth} min={MIN_CODE_PANE_WIDTH} max={maxCodePaneWidth(boxWidth)}
                        onResize={setPreferredCodeWidth} />
                </div>
            )}
            {code.show && (
                <PanelChevron action="dock-show" open={false} label={sc.dockShow} onClick={code.show}
                    style={{ position: 'absolute', zIndex: 3, insetBlockStart: '50%', insetInlineStart: 0, transform: 'translateY(-50%)', borderRadius: '0 4px 4px 0' }} />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
            {tools}
            {!showCodeHalf && <DiagramPicker active={activeDiagram} onPick={(id) => {
                setDiagramPick(id ? { root: graph.scope.rootId, camera, id } : null);
            }} graph={graph} records={diagramRecords} scope={diagramScope} stations={diagramStations} flat={flat} labels={labels}
                onOpen={(ref) => {
                    const file = fileRefOf(ref);
                    if (file !== ref) wiring.openDefinition(ref);
                    else if (codeFiles?.has(file)) wiring.openFile(file);
                }} />}
            <div ref={picture} style={{ display: activeDiagram && !showCodeHalf ? 'none' : undefined, position: 'relative', flex: 1, minHeight: 0, overflow: 'auto' }}>
            {!!barPx && <div style={{ position: 'absolute', top: 0, insetInline: 0 }}>{code.bar}</div>}
            <div data-map-pane style={{ position: 'absolute', top: barPx, insetInlineStart: 0, width, height, ...(showCodeHalf ? { visibility: 'hidden', pointerEvents: 'none' } : null) }}>
                {levelNote && <p data-level-note style={{ position: 'absolute', zIndex: 1, insetBlockEnd: 74, insetInlineStart: 10, maxWidth: 'calc(100% - 80px)', margin: 0, padding: '2px 8px', borderRadius: 6, background: cssVar('panel'), ...TYPE.bodyMuted }}>{levelNote}</p>}
                <LevelRail zoom={zoom} rail={rail} narrow={narrowStage} filters={camera === 'map' && !wiring.map.drill
                    ? <SystemVisibility label={labels.surface.code.architecture} {...visibility} /> : undefined} />
                {ready && <ColourLegend labels={labels} surface={surface} types={legendTypesOf(shownMarks?.type)} comparing={!!compare} narrow={narrowStage} scale={scale} />}
                {shownMarks && (
                    <Stage
                        renderer={renderer} marks={shownMarks} paint={frame?.paint ?? paint} placement={frame?.placement ?? null} colors={colors}
                        width={width} height={height} reducedMotion={p.reducedMotion} selected={selected} onSelect={wiring.onSelect} onDrill={wiring.onDrill}
                        nav={nav} description={labels.regionLabel}
                        onOut={wiring.onEscape} onClear={wiring.clearSelection}
                        {...(camera === 'map' ? { tilt: flat ? 0 : 1, onWheelStep } : {})} flat={flat} onContextLost={onLost} onRenderError={onRenderError}
                    />
                )}
                {!ready && <LayingOut labels={labels} corner={!!frame} />}
                {ready && wiring.card}
                {ready && camera === 'map' && !drilled && (
                    <StageBusContext.Provider value={bus}>
                        <StagePins pins={surface.pins} stations={surface.stations.byId} labels={labels} onActivate={wiring.onSelect} />
                    </StageBusContext.Provider>
                )}
                {(drill.loading && camera === 'map') && <LayingOut labels={labels} corner />}
                <EdgesCapped caption={caption} labels={labels} text={camera === 'map' ? labels.surface.scene.stationsCapped : undefined} />
                {notice}
            </div>
            {showCodeHalf && (
                <div data-code-narrow style={{ position: 'absolute', inset: 0, background: cssVar('bg') }}>{code.pane}</div>
            )}
            </div>
            {journey}
            </div>
        </div>
    );
}
