/**
 * The P1a spike harness (PRD 43 Phases), behind `stageSpikeOn()`: the ONE stage with the Map placement, a toggle to the
 * Graph placement and back, tweening the SAME marks. Both placements are asked for up front, so a switch is a buffer
 * swap with no worker trip (B1a rule 6). Not a camera: `ViewSurface` mounts it in place of the active camera only when
 * a developer opted in. Reads the camera's own props (graph, lens, overlay bindings), so it draws what the surface does.
 *
 * The renderer is created and disposed in ONE effect (`useStageRenderer`), so Strict Mode's double mount ends with a
 * live renderer; the stage mounts once it exists.
 */

import { useMemo, useRef, useState } from 'react';
import { useComputed } from '../../compute/useComputed';
import { PLACEMENT_WORD_KEYS } from '../../compute/tasks/placement/graph';
import { bandStrings } from '../../surface/bands';
import { viewportBandOf } from '../../compute/tasks/placement/request';
import { hasWebGL, useContainerSize } from '../../environment';
import { useThemeColors } from '../../scene/themeColors';
import type { SceneProps } from '../../surface/registry';
import { createNoopStage, createWebGLStage, type StageRenderer } from '../renderer';
import { useStageWiring } from '../overlay/useStageWiring';
import { Stage } from '../Stage';
import { useStageRenderer } from '../stageHooks';
import type { PlacementCamera } from '../types';

const NO_CHANGES: string[] = [];
const createStage = (): StageRenderer => (hasWebGL() ? createWebGLStage() : createNoopStage());

export default function StageSpike(p: SceneProps) {
    const renderer = useStageRenderer(createStage);
    return renderer ? <SpikeBody {...p} renderer={renderer} /> : <div style={{ width: '100%', height: '100%', minHeight: 320 }} data-stage-spike />;
}

function SpikeBody({ renderer, ...p }: SceneProps & { renderer: StageRenderer }) {
    const box = useRef<HTMLDivElement>(null);
    const { width, height } = useContainerSize(box);
    const colors = useThemeColors(box.current);
    const [camera, setCamera] = useState<PlacementCamera>('map');
    const graph = p.graph;
    const band = viewportBandOf(width || 960);

    // The words a placement embeds (partition / community names), localized by the host; never English from here.
    const strings = useMemo(() => ({ ...Object.fromEntries(PLACEMENT_WORD_KEYS.map((k) => [k, p.labels[k]])), ...bandStrings(p.labels) }), [p.labels]);
    const marks = useComputed('markSet', { graph, changed: NO_CHANGES, strings }, [graph, strings], null, { keep: false }).value;
    const generation = marks?.generation ?? 0;
    const bindings = p.surface.overlay.bindings;
    const channels = useMemo(() => ({ size: bindings.size, width: bindings.width }), [bindings.size, bindings.width]);
    const paint = useComputed('markPaint', {
        graph, generation, lensId: p.lens.id, questionId: null, overlay: bindings, lit: null, roles: null, family: null,
    }, [graph, generation, p.lens.id, bindings], null, { enabled: !!marks }).value;
    // Selection, the card, the Map's drill / unfold and the incident index (PRD 43 B5, B7).
    const wiring = useStageWiring(p, renderer, marks, width);
    // Map is asked for at full depth (each tower's height); the depth control scales it on the GPU, 0 = the flat map.
    const place = (cam: PlacementCamera, depth: number, drill: string | null = null) => ({ graph, generation, camera: cam, drill, unfolded: null, pins: [], pathId: null, viewportBand: band, lod: 0, depth, channels, ...(drill ? { symbols: wiring.map.symbols } : {}) });
    const map = useComputed('placement', place('map', 1, wiring.map.drill), [graph, generation, band, channels, wiring.map.drill, wiring.map.symbols], null, { enabled: !!marks }).value;
    const graphPlacement = useComputed('placement', place('graph', 0), [graph, generation, band, channels], null, { enabled: !!marks }).value;
    const placement = camera === 'map' ? wiring.patchMap(map) : graphPlacement;

    return (
        <div ref={box} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 320 }} data-stage-spike>
            <div role="group" style={{ position: 'absolute', zIndex: 1, top: 8, right: 8, display: 'flex', gap: 4 }}>
                <button type="button" aria-pressed={camera === 'map'} onClick={() => setCamera('map')}>{p.labels.viewTransit}</button>
                <button type="button" aria-pressed={camera === 'graph'} disabled={!graphPlacement} onClick={() => setCamera('graph')}>{p.labels.viewGraph}</button>
            </div>
            {marks && width > 0 && height > 0 && (
                <Stage
                    renderer={renderer} marks={marks} paint={paint} placement={placement ?? null} colors={colors}
                    width={width} height={height} reducedMotion={p.reducedMotion} selected={wiring.selected} onSelect={wiring.onSelect}
                    depthLabel={p.labels.surface.scene.depth} description={p.labels.regionLabel} {...(wiring.onOut ? { onOut: wiring.onOut } : {})}
                />
            )}
            {marks && placement && placement.generation === marks.generation && wiring.card}
        </div>
    );
}
