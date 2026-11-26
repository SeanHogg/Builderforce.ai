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

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { fillTemplate } from '../../labels';
import { useComputed } from '../../compute/useComputed';
import { viewportBandOf } from '../../compute/tasks/placement/request';
import { useContainerSize } from '../../environment';
import { cssVar, useThemeColors } from '../../scene/themeColors';
import { EdgesCapped } from '../../surface/CapNote';
import { LayingOut } from '../../surface/LayingOut';
import type { SceneProps } from '../../surface/registry';
import { codeCompareOf, paintDiffEntries, type CompareView } from '../../surface/compareModel';
import { showsTowers } from '../../surface/useShowInTower';
import { TYPE } from '../../surface/ui/type';
import { codePaneWidth, SPLIT_MIN_PX } from '../overlay/CodeDock';
import { ColourLegend } from './ColourLegend';
import { LevelRail } from './LevelRail';
import { toggleButton } from '../overlay/cardStyles';
import { CODE_BAR_PX } from '../overlay/CodeTrail';
import { STATUS_PX } from '../overlay/StatusStrip';
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
    /** The DOM camera shown when the stage cannot draw (no WebGL, a lost context). */
    fallback: ComponentType<SceneProps>;
}

// Exactly its scene box (the layout gives that box its minimum, `sceneMinHeight`): a floor here made the stage taller
// than the box, so a fill camera scrolled inside it and drew only the strip on screen.
const BOX = { position: 'relative', width: '100%', height: '100%' } as const;
const UNMEASURED = { width: 960, height: 600 } as const;

export default function StageHost({ fallback: Fallback, ...p }: StageHostProps) {
    const factory = useContext(StageFactoryContext);
    const renderer = useStageRenderer(factory);
    const [lost, setLost] = useState(false);
    const onLost = useCallback(() => setLost(true), []);
    if (renderer === false || lost) return <Fallback {...p} />;
    return renderer ? <StageBody {...p} renderer={renderer} onLost={onLost} /> : <div style={BOX} data-stage-host />;
}

/** The Sequence's semantic-zoom band (`req.lod`): 0 system, 1 class, 2 method (B1a rule 10). */
const BANDS = ['system', 'class', 'method'] as const;
/** The Map's ladder: the same bands plus the code. Going in stays with the wheel, double-click and Enter. */
const MAP_BANDS: readonly ZoomBand[] = ZOOM_BANDS.map((b) => b.band);

function StageBody({ renderer, onLost, camera, scale, codeShown, onToggleCode, onSimulate, onRestructure, restructureLoading, compare, flat = false, ...p }: SceneProps & StageCodeProps & StageCompareProps & StageFlatProps & { camera: PlacementCamera; scale?: ReactNode; renderer: StageRenderer; onLost(): void }) {
    const box = useRef<HTMLDivElement>(null);
    // Before the box is measured (and where nothing measures it: jsdom) the stage is laid out for a standard box.
    const measured = useContainerSize(box);
    const boxWidth = measured.width || UNMEASURED.width, boxHeight = measured.height || UNMEASURED.height;
    const colors = useThemeColors(box.current);
    const { graph, surface, labels } = p;
    // The box's band, not the map's: opening the code pane does not lay the map out again.
    const band = viewportBandOf(boxWidth);
    const strings = useStageStrings(labels);

    // The MarkSet is built once per graph: a comparison hands the union graph for its whole run, and a commit's changed set is paint, never an input here.
    const marks = useComputed('markSet', { graph, strings }, [graph, strings], null, { keep: false }).value;
    const generation = marks?.generation ?? 0;
    const codeCompare = useMemo(() => codeCompareOf(compare), [compare]);
    const wiring = useStageWiring(p, renderer, marks, boxWidth, {
        shown: codeShown, onToggleCode, onSimulate, onRestructure, restructureLoading, compare: codeCompare, sequence: camera === 'sequence', factsGraph: compare?.sideGraph,
    });
    const drilled = !!surface.drill.view;
    // The map's own box: beside the docked pane, under the Code | Picture switch (a narrow box) and the zoom-path bar, above the status strip (the last two while a file is read).
    const code = wiring.code;
    const codeWidth = code.split ? codePaneWidth(boxWidth) : 0;
    const narrow = code.visible && !code.split;
    // A box up to 900px wide shows ONE of the two: the pane while the viewer's `code` slot is on (the header's Code | Picture switch), else the picture.
    const showCodeHalf = narrow;
    const switchPx = 0, barPx = code.reading ? CODE_BAR_PX : 0, statusPx = code.reading ? STATUS_PX : 0;
    const width = boxWidth - codeWidth, height = boxHeight - switchPx - barPx - statusPx;

    // Paint: the lens, the overlay, the question (+ its family) and what it lights; Show in towers' roles while a tower
    // picture is on show (the 3D scene, or the Map tilted).
    const bindings = surface.overlay.bindings;
    const lit = useMemo(() => (!drilled && surface.lit ? [...surface.lit] : null), [drilled, surface.lit]);
    const towers = showsTowers(camera === 'map' ? 'transit' : camera === '3d' ? '3d' : 'graph', surface.towers);
    const highlight = towers ? surface.highlight : null;
    const roles = useMemo(() => (highlight ? [...highlight.roles] : null), [highlight]);
    // Compare: how each ref differs on the side shown (a diff tone over the slot's own); a station mark is painted by its id.
    const stations = surface.stations;
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
    const pathId = walks ? lineId : null;
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
        // Flow reads symbols only inside a drilled level; at system level they are not an input (nor part of its key).
        ...(drill || cam === 'sequence' ? { symbols } : {}),
    });
    const map = useComputed('placement', place('map', mapDepth, wiring.map.drill, 0, null), [graph, generation, band, channels, wiring.map.drill, symbols, mapDepth], null, { enabled: !!marks }).value;
    const other = camera === 'map' ? 'graph' : camera;
    // The zoom's nesting survives a rebuilt world: its entries are re-derived from the ancestor levels' placements of the new generation.
    const nestBasis = useNestBasis(marks, surface.drill.stack, camera === 'map' && wiring.zoom.nests, (d) => place('map', mapDepth, d, 0, null), [graph, generation, band, channels, symbols, mapDepth]);
    const setBasis = wiring.zoom.setBasis;
    useEffect(() => { setBasis(nestBasis.basis); }, [setBasis, nestBasis.basis]);
    const otherDepth = other === '3d' ? 1 : flat ? 0 : undefined;
    const otherSymbols = otherDrill || other === 'sequence' ? symbols : null;
    const otherPlacement = useComputed('placement', place(other, otherDepth, otherDrill, lod, pathId, method), [graph, generation, band, channels, other, lod, pathId, otherSymbols, otherDepth, otherDrill, method], null, { enabled: !!marks }).value;
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

    // The selection: the stage's own (a mark picked here), else the surface's (a search hit, the List).
    const selected = wiring.selected ?? (p.selected && p.selected !== wiring.dismissed ? `node:${p.selected}` : null);
    const bus = useMemo(() => stageBus(renderer), [renderer]);

    const zoom = labels.surface.zoom;
    const nav = useMemo(() => ({ nav: labels.surface.nav, zoomIn: labels.zoomIn, zoomOut: labels.zoomOut, zoomReset: labels.zoomReset }), [labels]);
    const drill = surface.drill;
    const levelNote = camera !== 'map' ? null
        : drill.notice ? fillTemplate(labels.surface.map.drillReset, { name: drill.notice }) : drill.view?.noSymbols ? labels.surface.map.noSymbolsNote : null;
    const sc = labels.surface.code;
    const caption = ready ? placement.caption : null;
    // The level rail: the Sequence has three levels (no code band), every other camera the Map's four; a click goes to that level.
    const narrowStage = boxWidth <= SPLIT_MIN_PX - 1;
    const sequenceRail = camera === 'sequence';
    const picked = wiring.map.stationOfKey(selected);
    const rail = {
        bands: sequenceRail ? MAP_BANDS.slice(0, BANDS.length) : MAP_BANDS,
        current: Math.max(0, sequenceRail ? seqBand : MAP_BANDS.indexOf(wiring.zoom.band)),
        go: (i: number) => (sequenceRail ? zoomToBand(i) : wiring.toBand(i)),
    };
    const intoName = picked && drill.canEnter(picked.id).can ? picked.name : null;

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
        <div ref={box} style={BOX} data-stage-host data-stage-camera={camera}>
            {code.split && (
                <div data-code-split style={{ position: 'absolute', insetBlockStart: 0, insetBlockEnd: statusPx, insetInlineStart: 0, width: codeWidth }}>
                    {code.pane}
                </div>
            )}
            {code.show && (
                <button
                    type="button" data-action="dock-show" aria-label={sc.dockShow} title={sc.dockShow} onClick={code.show}
                    style={{ ...toggleButton, position: 'absolute', zIndex: 3, insetBlockStart: '50%', insetInlineStart: 0, transform: 'translateY(-50%)', minHeight: 40, borderRadius: '0 6px 6px 0' }}
                >
                    <span aria-hidden="true">›</span>
                </button>
            )}
            {code.reading && <div style={{ position: 'absolute', top: switchPx, left: codeWidth, width }}>{code.bar}</div>}
            <div data-map-pane style={{ position: 'absolute', top: switchPx + barPx, left: codeWidth, width, height, ...(showCodeHalf ? { visibility: 'hidden', pointerEvents: 'none' } : null) }}>
                {levelNote && <p data-level-note style={{ position: 'absolute', zIndex: 1, insetBlockEnd: 74, insetInlineStart: 10, maxWidth: 'calc(100% - 80px)', margin: 0, padding: '2px 8px', borderRadius: 6, background: cssVar('panel'), ...TYPE.bodyMuted }}>{levelNote}</p>}
                <LevelRail
                    zoom={zoom} bands={rail.bands} current={rail.current} onGo={rail.go} narrow={narrowStage}
                    deepest={rail.current >= rail.bands.length - 1} into={intoName}
                />
                {ready && <ColourLegend labels={labels} surface={surface} types={legendTypesOf(shownMarks?.type)} comparing={!!compare} narrow={narrowStage} scale={scale} />}
                {shownMarks && (
                    <Stage
                        renderer={renderer} marks={shownMarks} paint={frame?.paint ?? paint} placement={frame?.placement ?? null} colors={colors}
                        width={width} height={height} reducedMotion={p.reducedMotion} selected={selected} onSelect={wiring.onSelect} onDrill={wiring.onDrill}
                        nav={nav} description={labels.regionLabel}
                        onOut={wiring.onEscape} onClear={wiring.clearSelection}
                        {...(camera === 'map' ? { tilt: flat ? 0 : 1, onWheelStep: wiring.wheelStep } : {})} flat={flat} onContextLost={onLost}
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
            </div>
            {showCodeHalf && (
                <div data-code-narrow style={{ position: 'absolute', insetInline: 0, insetBlockStart: switchPx + barPx, insetBlockEnd: statusPx, background: cssVar('bg') }}>{code.pane}</div>
            )}
            {wiring.status}
        </div>
    );
}
