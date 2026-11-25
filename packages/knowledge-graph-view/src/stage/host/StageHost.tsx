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
 * With the code open (`wiring.code`) the box splits: the code pane on the left, the map on the right under its zoom-path
 * bar (`CodeTrail`); the stage, its cards and its pins are laid out in the map's own box, so every projection into it
 * starts at its origin. A box too narrow to split keeps the whole width for the map and floats the pane over it.
 *
 * No WebGL, or a context lost for good: the List (the registry's `fallback` row) instead (B8).
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { fillTemplate } from '../../labels';
import { useComputed } from '../../compute/useComputed';
import { viewportBandOf } from '../../compute/tasks/placement/request';
import { useContainerSize } from '../../environment';
import { cssVar, useThemeColors } from '../../scene/themeColors';
import { EdgesCapped } from '../../surface/CapNote';
import { LayingOut } from '../../surface/LayingOut';
import type { SceneProps } from '../../surface/registry';
import { showsTowers } from '../../surface/useShowInTower';
import { Segmented } from '../../surface/ui';
import { TYPE } from '../../surface/ui/type';
import { codePaneWidth } from '../overlay/CodeDock';
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
import { useStageStrings } from './stageStrings';

export interface StageHostProps extends SceneProps {
    /** The placement the active camera row names. */
    camera: PlacementCamera;
    /** The DOM camera shown when the stage cannot draw (no WebGL, a lost context). */
    fallback: ComponentType<SceneProps>;
}

const NO_CHANGES: string[] = [];
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

function StageBody({ renderer, onLost, camera, ...p }: SceneProps & { camera: PlacementCamera; renderer: StageRenderer; onLost(): void }) {
    const box = useRef<HTMLDivElement>(null);
    // Before the box is measured (and where nothing measures it: jsdom) the stage is laid out for a standard box.
    const measured = useContainerSize(box);
    const boxWidth = measured.width || UNMEASURED.width, boxHeight = measured.height || UNMEASURED.height;
    const colors = useThemeColors(box.current);
    const { graph, surface, labels } = p;
    // The box's band, not the map's: opening the code pane does not lay the map out again.
    const band = viewportBandOf(boxWidth);
    const strings = useStageStrings(labels);
    const [seqBand, setSeqBand] = useState(0);

    const marks = useComputed('markSet', { graph, changed: NO_CHANGES, strings }, [graph, strings], null, { keep: false }).value;
    const generation = marks?.generation ?? 0;
    const wiring = useStageWiring(p, renderer, marks, boxWidth);
    const drilled = !!surface.drill.view;
    // The map's own box: beside the code pane and under its bar while the code is open.
    const code = wiring.code;
    const codeWidth = code?.split ? codePaneWidth(boxWidth) : 0;
    const width = boxWidth - codeWidth, height = boxHeight - (code ? CODE_BAR_PX : 0);

    // Paint: the lens, the overlay, the question (+ its family) and what it lights; Show in towers' roles while a tower
    // picture is on show (the 3D scene, or the Map tilted).
    const bindings = surface.overlay.bindings;
    const lit = useMemo(() => (!drilled && surface.lit ? [...surface.lit] : null), [drilled, surface.lit]);
    const towers = showsTowers(camera === 'map' ? 'transit' : camera === '3d' ? '3d' : 'graph', surface.towers);
    const highlight = towers ? surface.highlight : null;
    const roles = useMemo(() => (highlight ? [...highlight.roles] : null), [highlight]);
    const paint = useComputed('markPaint', {
        graph, generation, lensId: p.lens.id, questionId: surface.question, overlay: bindings, lit, roles, family: surface.family,
    }, [graph, generation, p.lens.id, surface.question, bindings, lit, roles, surface.family], null, { enabled: !!marks }).value;

    // Placement: Map always (its drill and unfold wiring read it; the worker caches it), and the camera on show.
    const channels = useMemo(() => ({ size: bindings.size, width: bindings.width }), [bindings.size, bindings.width]);
    const lineId = surface.line?.id ?? null;
    const lod = camera === 'sequence' ? seqBand : 0;
    const pathId = camera === 'sequence' ? lineId : null;
    const symbols = wiring.map.symbols;
    const place = (cam: PlacementCamera, depth: number, drill: string | null, l: number, path: string | null) => ({
        graph, generation, camera: cam, drill, unfolded: null, pins: [], pathId: path, viewportBand: band, lod: l, depth, channels,
        ...(drill || cam === 'sequence' ? { symbols } : {}),
    });
    const map = useComputed('placement', place('map', 1, wiring.map.drill, 0, null), [graph, generation, band, channels, wiring.map.drill, symbols], null, { enabled: !!marks }).value;
    const other = camera === 'map' ? 'graph' : camera;
    const otherPlacement = useComputed('placement', place(other, other === '3d' ? 1 : 0, null, lod, pathId), [graph, generation, band, channels, other, lod, pathId, symbols], null, { enabled: !!marks }).value;
    const placement = camera === 'map' ? wiring.patchMap(map) : otherPlacement;
    const ready = !!marks && !!placement && placement.generation === marks.generation;

    // The selection: the stage's own (a mark picked here), else the surface's (a search hit, the List).
    const selected = wiring.selected ?? (p.selected ? `node:${p.selected}` : null);
    const setTowers = surface.setTowers;
    const onTilt = useCallback((d: number) => setTowers(d > 0), [setTowers]);
    const bus = useMemo(() => stageBus(renderer), [renderer]);

    const zoom = labels.surface.zoom;
    const nav = useMemo(() => ({ nav: labels.surface.nav, zoomIn: labels.zoomIn, zoomOut: labels.zoomOut, zoomReset: labels.zoomReset }), [labels]);
    const drill = surface.drill;
    const levelNote = camera !== 'map' ? null
        : drill.notice ? fillTemplate(labels.surface.map.drillReset, { name: drill.notice }) : drill.view?.noSymbols ? labels.surface.map.noSymbolsNote : null;
    const caption = ready ? placement.caption : null;
    const mapBand = MAP_BANDS.indexOf(wiring.zoom.band);

    // Esc goes out from anywhere over the map (not while typing, and not when a pane already took it).
    const onOut = wiring.onOut;
    useEffect(() => {
        const el = box.current;
        if (!el || !onOut) return undefined;
        const key = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            if ((e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')) return;
            if (!el.matches(':hover') && !el.contains(document.activeElement)) return;
            e.preventDefault();
            onOut();
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, [onOut]);

    return (
        <div ref={box} style={BOX} data-stage-host data-stage-camera={camera}>
            {code?.split && (
                <div data-code-split style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 0, width: codeWidth, borderInlineEnd: `1px solid ${cssVar('border')}`, background: cssVar('bg') }}>
                    {code.pane}
                </div>
            )}
            {code && <div style={{ position: 'absolute', top: 0, left: codeWidth, width }}>{code.bar}</div>}
            <div data-map-pane style={{ position: 'absolute', top: boxHeight - height, left: codeWidth, width, height }}>
                {/* Over the stage's top-left corner, so the stage box (and every projection into it) starts at the map's origin. */}
                {(camera === 'sequence' || camera === 'map' || levelNote) && (
                    <div style={{ position: 'absolute', zIndex: 1, insetBlockStart: 8, insetInlineStart: 8, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, maxWidth: 'calc(100% - 16px)' }}>
                        {camera === 'sequence' && (
                            <Segmented label={zoom.group} value={BANDS[seqBand]!} onChange={(id) => setSeqBand(Math.max(0, BANDS.indexOf(id as typeof BANDS[number])))} items={BANDS.map((b) => ({ id: b, label: zoom[b] }))} />
                        )}
                        {camera === 'map' && (
                            <Segmented
                                label={zoom.group} value={MAP_BANDS[mapBand]!} onChange={(id) => wiring.zoom.outToBand(MAP_BANDS.indexOf(id as ZoomBand))}
                                items={MAP_BANDS.map((b, i) => ({ id: b, label: zoom[b], disabled: i > mapBand }))}
                            />
                        )}
                        {camera === 'map' && <p data-stage-hint style={{ margin: 0, padding: '2px 8px', borderRadius: 6, background: cssVar('panel'), ...TYPE.bodyMuted }}>{zoom.hint}</p>}
                        {levelNote && <p data-level-note style={{ margin: 0, padding: '2px 8px', borderRadius: 6, background: cssVar('panel'),...TYPE.bodyMuted }}>{levelNote}</p>}
                    </div>
                )}
                {marks && (
                    <Stage
                        renderer={renderer} marks={marks} paint={paint} placement={placement ?? null} colors={colors}
                        width={width} height={height} reducedMotion={p.reducedMotion} selected={selected} onSelect={wiring.onSelect} onDrill={wiring.onDrill}
                        depthLabel={labels.surface.scene.depth} nav={nav} description={labels.regionLabel} legend={{ types: legendTypesOf(marks.type), labels }} {...(wiring.onOut ? { onOut: wiring.onOut } : {})}
                        {...(camera === 'map' ? { tilt: surface.towers ? 1 : 0, onTilt } : {})} onContextLost={onLost}
                    />
                )}
                {!ready && <LayingOut labels={labels} />}
                {ready && wiring.card}
                {ready && camera === 'map' && !drilled && (
                    <StageBusContext.Provider value={bus}>
                        <StagePins pins={surface.pins} stations={surface.stations.byId} labels={labels} onActivate={wiring.onSelect} />
                    </StageBusContext.Provider>
                )}
                {(drill.loading && camera === 'map') && <LayingOut labels={labels} corner />}
                <EdgesCapped caption={caption} labels={labels} />
                {code && !code.split && code.pane}
            </div>
        </div>
    );
}
