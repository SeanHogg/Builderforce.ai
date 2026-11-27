/**
 * The ONE stage (PRD 43 B3): one persistent R3F `<Canvas frameloop="demand">` holding the renderer's planes, links,
 * marks and labels, with the DOM layers over it — the caption layer (moved by ONE CSS transform) and the interaction layer
 * (picking, the a11y proxies); the 3D / Flat switch is the host's (`flat`). Declarative over the B7 update rules: a new `marks` rebuilds the
 * meshes, a new `paint` uploads paint, a new `placement` tweens the SAME meshes to it while the rig tweens the camera
 * alongside (or both jump under reduced motion), new `colors` rewrite tone colours only. A lost WebGL context is restored
 * from the last inputs. With the no-op renderer (jsdom, no WebGL) there is no canvas; the rig, the captions, the proxies
 * and picking still work from the placement.
 *
 * Generation gate: a placement built for another MarkSet generation (the graph changed; the worker has not answered
 * yet) is NO placement — nothing interactive happens until they match: no bus placement, proxies, rig fit or captions.
 *
 * drei stays out of the stage (B3): the camera is the canvas's own orthographic one, posed by the rig every frame.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import { PerspectiveCamera, type OrthographicCamera } from 'three';
import type { ThemeColors } from '../scene/themeColors';
import { CameraProjector } from './projector';
import { StageBusContext, stageBus, type StageBus } from './anchor/stageBus';
import { CaptionLayer } from './captions/CaptionLayer';
import { ChipLayer } from './labels/ChipLayer';
import type { PlacedChip } from './labels/runs';
import { applyCaptionTransform, groundAffine, type Affine2 } from './captions/transform';
import { bindContextLoss } from './contextLoss';
import { StageInteraction } from './overlay/StageInteraction';
import { stageHeight } from './projection';
import type { StageRenderer, StageView } from './renderer';
import { aimCamera } from './rig/aim';
import { NavControl, type NavLabels } from './rig/NavControl';
import { StageCorner } from './rig/StageCorner';
import { useStageLegend, type StageLegendValue } from './rig/stageLegend';
import { useFlatTilt } from './rig/useFlatTilt';
import { bindOrbitKeys, touchActionFor } from './rig/gestures';
import type { RigController } from './rig/rig';
import { bindRig } from './rig/rigOfBus';
import { panZoomOf, useRig } from './rig/useRig';
import { useDepth, useLiveKeys, useStageMotion, useTweening } from './stageHooks';
import { now, TWEEN_MS } from './tween';
import type { Caption, MarkPaint, MarkSet, Placement } from './types';
import { useRenderTrace } from '../renderTrace';

export interface StageProps {
    renderer: StageRenderer;
    marks: MarkSet;
    paint: MarkPaint | null;
    /** Null, or one built for another MarkSet generation: the stage waits (nothing interactive until they match). */
    placement: Placement | null;
    colors: ThemeColors | null;
    width: number;
    /** The box height of a `fill` frame; a `document` frame sizes itself to its content at `width` (the page scrolls). */
    height: number;
    reducedMotion: boolean;
    selected: string | null;
    onSelect(key: string): void;
    /** The nav control's names (localized by the host); absent ⇒ no nav control. */
    nav?: NavLabels;
    /** The shape key above the nav. Absent ⇒ the `StageLegendProvider` above this stage, if any. */
    legend?: StageLegendValue;
    /** What the view shows, read with the proxies' group; also the canvas's accessible name on an orbit view (localized by the host). */
    description?: string;
    /** Escape / Backspace on a proxy: out of a drilled level. */
    onOut?: () => void;
    /** Double-click on a mark, or Enter on the selected one: go inside it. */
    onDrill?: (key: string) => void;
    /**
     * A tilt asked for from outside (Show in towers: 1; back to the flat map: 0). Applied when it changes and the depth is
     * not already on that side of flat, so the person's own drag is never snapped back.
     */
    tilt?: number;
    /** Bumped to put the view back: the camera fitted and the tilt up, whatever the person dragged it to. */
    resetTilt?: number;
    /** A plain mouse wheel moved one level (the Map's stepped zoom); absent ⇒ the wheel zooms continuously. */
    onWheelStep?: (dir: 1 | -1) => void;
    /** A click on empty space (not a drag, not a mark or a link). */
    onClear?: () => void;
    /**
     * The ONE 3D / Flat switch (PRD 43 C4), controlled by the host (`surface/useFlatView`). Flat = tilt 0 on a ground
     * placement (drag stays pan), an orbit pitched straight down (drag turns it only); 3D = the placement's resting
     * tilt. Switching animates. Absent ⇒ the switch does not drive the stage.
     */
    flat?: boolean;
    /** The WebGL context was lost and did not come back: the host falls back to the List. */
    onContextLost?: () => void;
    onRenderError?: ((error: Error) => void) | undefined;
}

type Inputs = { marks: MarkSet; paint: MarkPaint | null; placement: Placement | null; colors: ThemeColors | null; reducedMotion: boolean };

/** Pushes the props into the renderer in B7 order (marks before paint before placement); `changed` is told after each. */
function useRendererInputs(r: StageRenderer, p: Inputs, changed: () => void): void {
    useEffect(() => { r.setMarks(p.marks); changed(); }, [r, p.marks]); // eslint-disable-line react-hooks/exhaustive-deps
    // Paint and placement name the MarkSet generation they were built for: one for an older graph is never applied.
    useEffect(() => { if (p.paint?.generation === p.marks.generation) { r.setPaint(p.paint); changed(); } }, [r, p.marks, p.paint]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (p.colors) { r.setPalette(p.colors); changed(); } }, [r, p.colors]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!p.placement) return;
        r.setPlacement(p.placement, now(), p.reducedMotion ? 0 : TWEEN_MS);
        changed();
    }, [r, p.marks, p.placement]); // eslint-disable-line react-hooks/exhaustive-deps
}

interface SceneProps { renderer: StageRenderer; rig: RigController; inputs: Inputs; captions: RefObject<HTMLDivElement | null>; onContextLost?: (() => void) | undefined; onRenderError?: ((error: Error) => void) | undefined }

/** A matrix no real transform equals: the first frame always writes. */
const unwritten = (): Affine2 => ({ a: NaN, b: NaN, c: NaN, d: NaN, e: NaN, f: NaN });

function StageScene({ renderer, rig, inputs, captions, canvasLabel, onContextLost, onRenderError, width, height, bus }: SceneProps & { canvasLabel: string; width: number; height: number; bus: StageBus }) {
    const trace = useRenderTrace();
    const projector = useMemo(() => new CameraProjector(), []);
    const invalidate = useThree((s) => s.invalidate);
    const gl = useThree((s) => s.gl);
    const set = useThree((s) => s.set);
    const get = useThree((s) => s.get);
    const size = useThree((s) => s.size);
    const setSize = useThree((s) => s.setSize);
    useEffect(() => {
        bus.invalidate = invalidate;
        return () => { bus.invalidate = () => {}; };
    }, [bus, invalidate]);
    // ONE size: the canvas draws at the stage box the rig, the captions and picking project into. R3F measures its own
    // container with a ResizeObserver, which can lag a box that just grew (a fill camera on a stacked layout) — the
    // drawing then covered only the old height and the rest of the box stayed blank.
    useLayoutEffect(() => {
        if (width > 0 && height > 0 && (size.width !== width || size.height !== height)) setSize(width, height);
    }, [width, height, size.width, size.height, setSize]);
    // The canvas's own orthographic camera for ground views, ONE perspective camera for orbit (and cross-projection
    // tweens); the rig says which, and the frame loop swaps the store's camera when it changes.
    const ortho = useRef(get().camera as OrthographicCamera).current;
    const persp = useMemo(() => new PerspectiveCamera(35, 1, 1, 1e6), []);
    useRendererInputs(renderer, inputs, invalidate);
    useEffect(() => rig.subscribe(invalidate), [rig, invalidate]);
    // Labels typeset after the last frame (troika is async) need one more frame: the canvas draws on demand.
    useEffect(() => renderer.onRedraw(invalidate), [renderer, invalidate]);
    const giveUp = useRef(onContextLost);
    giveUp.current = onContextLost;
    useEffect(() => bindContextLoss(gl.domElement, renderer, invalidate, () => giveUp.current?.(), (event, error) => trace(`WebGL context ${event}`, undefined, error)), [gl, renderer, invalidate, trace]);
    useEffect(() => {
        const previous = gl.debug.onShaderError;
        gl.debug.onShaderError = (context, program, vertex, fragment) => {
            const message = [context.getProgramInfoLog(program), context.getShaderInfoLog(vertex), context.getShaderInfoLog(fragment)].filter(Boolean).join('\n');
            trace('WebGL shader failed', undefined, new Error(message || 'Shader compilation failed'));
            previous?.(context, program, vertex, fragment);
        };
        return () => { gl.debug.onShaderError = previous; };
    }, [gl, trace]);
    // Arrow keys orbit only while the canvas itself has focus (never the proxies' roving arrows).
    // The canvas is a tab stop only while there is something for the keys to do (an orbit view).
    useEffect(() => {
        const canvas = gl.domElement;
        const stop = () => {
            if (rig.orbiting) { canvas.tabIndex = 0; canvas.setAttribute('aria-label', canvasLabel); }
            else { canvas.removeAttribute('tabindex'); canvas.removeAttribute('aria-label'); }
        };
        stop();
        const unsubscribe = rig.subscribe(stop);
        const unbind = bindOrbitKeys(canvas, rig, invalidate);
        return () => { unsubscribe(); unbind(); };
    }, [gl, rig, invalidate, canvasLabel]);
    const motionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (motionTimer.current) clearTimeout(motionTimer.current); }, []);
    // Reused every frame: no allocation in the loop.
    const scratch = useMemo(() => ({ view: { pxPerWorld: 1, dpr: 1 } as StageView, affine: unwritten(), last: unwritten() }), []);
    const draw = ({ scene }: RootState) => {
        const t = now();
        const rigMoving = rig.tick(t);
        const pose = rig.pose();
        const camera = aimCamera(pose, rig.currentOrbit.distance, ortho, persp, rig);
        if (get().camera !== camera) set({ camera });
        scratch.view.pxPerWorld = rig.pxPerWorld; scratch.view.dpr = gl.getPixelRatio();
        if (!Number.isFinite(scratch.view.pxPerWorld) || scratch.view.pxPerWorld <= 0) throw new Error(`Invalid camera scale: ${scratch.view.pxPerWorld}`);
        renderer.setView(scratch.view);
        // The extrude follows the rig (held at 1 in 3D, blended across a Map ↔ 3D tween); the label pass and overlay
        // re-place once it stops moving.
        const depth = rig.depthUniform;
        if (depth !== renderer.depth) renderer.setDepth(depth, !rigMoving);
        const at = pose.target;
        if (captions.current) applyCaptionTransform(captions.current, groundAffine(rig.projectInto, scratch.affine, at[0], at[2]), scratch.last);
        const moving = renderer.tick(t);
        gl.render(scene, camera);
        if (inputs.placement) {
            projector.update(camera, width, height, rig.pxPerWorld);
            bus.frame(projector);
        }
        if (moving || rigMoving) { invalidate(); return; }
        // The label fade (next frame) and decorative motion (the pulse, ≤ 30 fps, only while visible and allowed).
        const delay = renderer.motionDelay(t);
        if (delay === 0) { invalidate(); return; }
        if (delay !== null && !motionTimer.current) motionTimer.current = setTimeout(() => { motionTimer.current = null; invalidate(); }, delay);
    };
    const failed = useRef(false);
    const painted = useRef<Placement | null>(null);
    useFrame((state) => {
        if (failed.current || gl.getContext().isContextLost()) return;
        try {
            draw(state);
            if (inputs.placement && painted.current !== inputs.placement) {
                painted.current = inputs.placement;
                trace('frame drawn', `generation=${inputs.marks.generation} size=${width}x${height} dpr=${gl.getPixelRatio()} calls=${gl.info.render.calls} scale=${rig.pxPerWorld.toPrecision(4)}`);
            }
        } catch (error) {
            failed.current = true;
            onRenderError?.(error instanceof Error ? error : new Error(String(error)));
        }
    }, 1);
    return inputs.placement && renderer.object ? <primitive object={renderer.object} dispose={null} /> : null;
}

/** No canvas (jsdom, no WebGL): the rig still drives the captions and hands the bus its projection. */
function NoCanvas({ renderer, rig, inputs, captions, bus }: SceneProps & { bus: StageBus }) {
    useRendererInputs(renderer, inputs, () => {});
    const shown = inputs.placement !== null;
    useEffect(() => {
        if (!shown) return undefined;
        const affine = unwritten(), last = unwritten();
        const apply = () => {
            bus.frame(rig.projector(), false);
            const at = rig.pose().target;
            if (captions.current) applyCaptionTransform(captions.current, groundAffine(rig.projectInto, affine, at[0], at[2]), last);
        };
        apply();
        return rig.subscribe(apply);
    }, [rig, bus, captions, shown]);
    return null;
}

const sameCaptions = (a: readonly Caption[], b: readonly Caption[]): boolean =>
    a === b || (a.length === b.length && a.every((c, i) => {
        const d = b[i]!;
        return c.text === d.text && c.tone === d.tone && c.anchor === d.anchor && c.font === d.font
            && c.position[0] === d.position[0] && c.position[1] === d.position[1] && c.position[2] === d.position[2];
    }));

export function Stage(p: StageProps) {
    const { renderer, width } = p;
    // The generation gate: a placement for another MarkSet is no placement.
    const placement = p.placement && p.placement.generation === p.marks.generation ? p.placement : null;
    const height = stageHeight(placement?.rig.frame, placement?.bounds, width, p.height);
    const bus = useMemo(() => stageBus(renderer), [renderer]);
    const keys = useLiveKeys(renderer);
    const box = useRef<HTMLDivElement>(null);
    const captions = useRef<HTMLDivElement>(null);
    const tweening = useTweening(placement, p.reducedMotion);
    const [names, setNames] = useState<readonly Caption[]>([]);
    const [chips, setChips] = useState<readonly PlacedChip[]>([]);
    const legendContext = useStageLegend();
    const legend = p.legend ?? legendContext;
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const rigRef = useRef<RigController | null>(null);
    const settle = useCallback(() => {
        const r = rigRef.current;
        if (r) renderer.settleView({ pxPerWorld: r.pxPerWorld, dpr });
        bus.settle();
        bus.invalidate();
    }, [renderer, bus, dpr]);
    const rig = useRig(placement, width, height, p.reducedMotion, box, settle, p.onWheelStep);
    rigRef.current = rig;
    // A layout effect: it runs before `useRig`'s passive effects (a resize re-fit) of the same commit read `motionMs`.
    useLayoutEffect(() => { rig.motionMs = p.reducedMotion ? 0 : TWEEN_MS; }, [rig, p.reducedMotion]);
    const panZoom = useMemo(() => panZoomOf(rig, p.reducedMotion, settle), [rig, p.reducedMotion, settle]);
    // The semantic zoom (outside this component) flies and reads the same rig through the bus.
    useEffect(() => bindRig(bus, rig), [bus, rig]);
    const { setDepth } = useDepth(renderer, rig, bus);
    // A tilt asked for from outside lands only when the depth is on the other side of flat (never undoes a drag). With the
    // 3D / Flat switch controlled (`flat` given) `useFlatTilt` is the ONE depth driver and takes `tilt` as its 3D target.
    const ready = placement !== null;
    useEffect(() => {
        const t = p.tilt;
        if (t === undefined || !ready || p.flat !== undefined) return;
        if (t > 0 ? rig.depth === 0 : rig.depth > 0) setDepth(t);
    }, [p.tilt, ready]); // eslint-disable-line react-hooks/exhaustive-deps
    // Reset view: the camera fitted, and the tilt put back up.
    const resets = useRef(p.resetTilt ?? 0);
    useEffect(() => {
        if (!ready || (p.resetTilt ?? 0) === resets.current) return;
        resets.current = p.resetTilt ?? 0;
        setDepth(p.flat ? 0 : 1);
        rig.fit(now(), p.reducedMotion ? 0 : TWEEN_MS);
        settle();
    }, [p.resetTilt, ready]); // eslint-disable-line react-hooks/exhaustive-deps
    // The 3D / Flat switch (controlled by the host): eases the tilt (ground) or the pitch (orbit).
    const invalidate = useCallback(() => bus.invalidate(), [bus]);
    useFlatTilt({ rig, flat: p.flat, ready, reducedMotion: p.reducedMotion, tilt: p.tilt, setDepth, invalidate });

    useEffect(() => { if (placement) bus.setPlacement(placement, keys); }, [bus, placement, keys]);
    useEffect(() => { bus.setTweening(tweening); }, [bus, tweening]);
    // Labels the SDF font cannot draw become DOM captions. They update when the view settles and when the renderer
    // redraws (the font blob arriving after the first placement re-routes names off the DOM).
    useEffect(() => {
        const pull = (): void => {
            const next = renderer.labelCaptions;
            setNames((cur) => (sameCaptions(cur, next) ? cur : next));
            setChips(renderer.chips);
        };
        const offSettle = bus.onSettle(pull);
        const offRedraw = renderer.onRedraw(pull);
        return () => { offSettle?.(); offRedraw(); };
    }, [bus, renderer]);
    useEffect(() => (placement ? bus.onReveal((slot) => rig.centreOn(placement.position[slot * 3]!, placement.position[slot * 3 + 2]!)) : undefined), [bus, rig, placement]);
    useStageMotion(renderer, box, p.reducedMotion, bus);
    // An orbit placement (3D) holds the marks' extrude at full; a ground one gives the depth control back.
    useEffect(() => { if (placement) { renderer.setDepth(rig.depthUniform, true); bus.invalidate(); } }, [renderer, rig, bus, placement]);

    const scene: SceneProps = { renderer, rig, inputs: { marks: p.marks, paint: p.paint, placement, colors: p.colors, reducedMotion: p.reducedMotion }, captions, onContextLost: p.onContextLost, onRenderError: p.onRenderError };
    const frame = placement?.rig.frame ?? 'fill';
    return (
        <StageBusContext.Provider value={bus}>
            {/* `overflow: clip` (not hidden): it clips without becoming a scroll container. */}
            <div ref={box} style={{ position: 'relative', display: 'flow-root', width, height, overflow: 'clip', touchAction: touchActionFor(frame) }} data-stage={renderer.kind} data-stage-frame={frame} data-stage-ready={placement ? 'true' : 'false'}>
                {renderer.kind === 'webgl'
                    ? (
                        <Canvas orthographic frameloop="demand" dpr={[1, 2]} gl={{ antialias: false, alpha: true }} style={{ position: 'absolute', inset: 0, touchAction: 'none' }}>
                            <StageScene {...scene} canvasLabel={p.description ?? ''} width={width} height={height} bus={bus} />
                        </Canvas>
                    )
                    : <NoCanvas {...scene} bus={bus} />}
                {placement && <CaptionLayer ref={captions} captions={placement.captions} names={names} hidden={tweening} />}
                {placement && chips.length > 0 && <ChipLayer bus={bus} chips={chips} selected={p.selected} hidden={tweening} onSelect={p.onSelect} onDrill={p.onDrill} />}
                {placement && <StageInteraction bus={bus} renderer={renderer} keys={keys} placement={placement} tweening={tweening} selected={p.selected} description={p.description} onSelect={p.onSelect} onOut={p.onOut} onDrill={p.onDrill} onClear={p.onClear} />}
                {placement && (
                    <StageCorner boxHeight={height} legend={legend}>
                        {p.nav && <NavControl rig={rig} panZoom={panZoom} labels={p.nav} onSettle={settle} />}
                    </StageCorner>
                )}
            </div>
        </StageBusContext.Provider>
    );
}
