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
 * No WebGL, or a context lost for good: the List (the registry's `fallback` row) instead (B8).
 */

import { useCallback, useContext, useMemo, useRef, useState, type ComponentType } from 'react';
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
import { useStageWiring } from '../overlay/useStageWiring';
import type { StageRenderer } from '../renderer';
import { Stage } from '../Stage';
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
const BOX = { position: 'relative', width: '100%', height: '100%', minHeight: 320 } as const;
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

function StageBody({ renderer, onLost, camera, ...p }: SceneProps & { camera: PlacementCamera; renderer: StageRenderer; onLost(): void }) {
    const box = useRef<HTMLDivElement>(null);
    // Before the box is measured (and where nothing measures it: jsdom) the stage is laid out for a standard box.
    const measured = useContainerSize(box);
    const width = measured.width || UNMEASURED.width, height = measured.height || UNMEASURED.height;
    const colors = useThemeColors(box.current);
    const { graph, surface, labels } = p;
    const band = viewportBandOf(width);
    const strings = useStageStrings(labels);
    const [seqBand, setSeqBand] = useState(0);

    const marks = useComputed('markSet', { graph, changed: NO_CHANGES, strings }, [graph, strings], null, { keep: false }).value;
    const generation = marks?.generation ?? 0;
    const wiring = useStageWiring(p, renderer, marks, width);
    const drilled = !!surface.drill.view;

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
    const drill = surface.drill;
    const levelNote = camera !== 'map' ? null
        : drill.notice ? fillTemplate(labels.surface.map.drillReset, { name: drill.notice }) : drill.view?.noSymbols ? labels.surface.map.noSymbolsNote : null;
    const caption = ready ? placement.caption : null;

    return (
        <div ref={box} style={BOX} data-stage-host data-stage-camera={camera}>
            {/* Over the stage's top-left corner, so the stage box (and every projection into it) starts at the host's origin. */}
            {(camera === 'sequence' || levelNote) && (
                <div style={{ position: 'absolute', zIndex: 1, insetBlockStart: 8, insetInlineStart: 8, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, maxWidth: 'calc(100% - 16px)' }}>
                    {camera === 'sequence' && (
                        <Segmented label={zoom.group} value={BANDS[seqBand]!} onChange={(id) => setSeqBand(Math.max(0, BANDS.indexOf(id as typeof BANDS[number])))} items={BANDS.map((b) => ({ id: b, label: zoom[b] }))} />
                    )}
                    {levelNote && <p data-level-note style={{ margin: 0, padding: '2px 8px', borderRadius: 6, background: cssVar('panel'),...TYPE.bodyMuted }}>{levelNote}</p>}
                </div>
            )}
            {marks && (
                <Stage
                    renderer={renderer} marks={marks} paint={paint} placement={placement ?? null} colors={colors}
                    width={width} height={height} reducedMotion={p.reducedMotion} selected={selected} onSelect={wiring.onSelect}
                    depthLabel={labels.surface.scene.depth} description={labels.regionLabel} {...(wiring.onOut ? { onOut: wiring.onOut } : {})}
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
        </div>
    );
}
