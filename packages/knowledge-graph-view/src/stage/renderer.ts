/**
 * The `StageRenderer` port (PRD 43 B3): what the stage component drives, with a WebGL implementation (planes, links,
 * marks and the SDF labels as three.js objects, mounted into the ONE R3F canvas) and a no-op implementation for jsdom /
 * no-WebGL, which keeps the last placement so the a11y proxies, the DOM overlays and picking still mount and work.
 *
 * The update rules (B7) are the port's methods: marks once per graph, paint on a lens / overlay change, a placement on a
 * camera switch (tweened unless reduced motion; links, planes and labels land with it), the palette on a theme flip
 * (tone colours only), the view on zoom, the depth control, decorative motion (≤ 30 fps, only while visible, never under
 * reduced motion), and a restore from the last inputs after a lost WebGL context.
 *
 * Every mesh the stage ever draws in normal use exists after `createWebGLStage` + `setMarks`: the link families, the
 * plane batch and the label batch are preallocated, so a placement — the first included — creates none.
 */

import { Color, Group, SRGBColorSpace, Vector3, type Object3D } from 'three';
import type { ThemeColors } from '../scene/themeColors';
import { documentFontPort, type StageFontPort } from './fonts';
import { LabelLayer, type TextPort } from './labels/LabelLayer';
import { troikaTextPort } from './labels/troika';
import { LinkLayer } from './links/LinkLayer';
import { MarkLayer } from './marks/MarkLayer';
import { sharedMarkUniforms } from './marks/shader';
import { PlaneLayer } from './planes/PlaneLayer';
import { createStats, type StageStats } from './stats';
import { TONE_ORDER } from './tones';
import { Tween } from './tween';
import { FLAG, type Caption, type MarkPaint, type MarkSet, type Placement, type SlotAppend } from './types';
import { LiveKeys } from './liveKeys';
import { AppendedSlots, withAppended } from './drill/appended';
import { NO_OVERLAY, OverlayLayer, type OverlayState } from './overlay/OverlayLayer';
import { SlotTable } from './slots';

export interface StageView { pxPerWorld: number; dpr: number }
export interface StageMotion { visible: boolean; reduced: boolean }

/** Decorative motion (the pulse) runs at most this often: 30 fps. */
export const MOTION_FRAME_MS = 1000 / 30;

export interface StageRenderer {
    readonly kind: 'webgl' | 'none';
    /** The scene graph to mount (null for the no-op renderer). */
    readonly object: Object3D | null;
    readonly stats: StageStats;
    readonly marks: MarkSet | null;
    readonly placement: Placement | null;
    /**
     * The live slot keys: `MarkSet.keys` plus every key a drill appended since (a drilled symbol's slot is past the
     * MarkSet's). Survives an overflow rebuild and a restore; only a new MarkSet resets it. Index picks and proxies by it.
     */
    keys(): readonly string[];
    /** Told whenever {@link keys} changes (a new MarkSet, an append). Returns the unsubscribe. */
    onKeys(cb: () => void): () => void;
    /**
     * Told when the renderer needs a frame that no input asked for — troika finished typesetting the labels after the
     * placement landed (the stage draws on demand, so without it a name typeset after the last frame never shows).
     * Returns the unsubscribe.
     */
    onRedraw(cb: () => void): () => void;
    /** Label runs the SDF pass handed to the DOM caption layer (a glyph outside the font, or no host font). */
    readonly labelCaptions: readonly Caption[];
    setMarks(set: MarkSet): void;
    setPaint(paint: MarkPaint): void;
    setPalette(colors: ThemeColors): void;
    /**
     * A new placement; `tweenMs` 0 jumps (reduced motion, the first placement). A placement that appends slots (a drill,
     * `Placement.append`) adds them into the headroom first — ranged, no mesh — and only an overflow rebuilds the marks.
     */
    setPlacement(p: Placement, now: number, tweenMs: number): void;
    /** The selection ring, hover ring and highlighted lines (B3 Overlay): overlay meshes only, never a mark attribute. */
    setOverlay(state: OverlayState): void;
    readonly overlay: OverlayState;
    /** The depth last set (the extrude multiplier picking and card anchors scale a mark's height by). */
    readonly depth: number;
    setView(view: StageView): void;
    /** The view settled (zoom ended): `screen` labels and the label LOD are re-placed. */
    settleView(view: StageView): void;
    /**
     * The depth control, 0..1: extrude multiplier (the rig tilts the camera with it). `settled` false (a drag in
     * progress) writes the uniform only; the label pass and the overlay rebuild run once the drag settles.
     */
    setDepth(depth: number, settled?: boolean): void;
    setMotion(motion: StageMotion): void;
    /** Advances the tween, the label fade and decorative motion; true while the TWEEN needs the next frame. */
    tick(now: number): boolean;
    /** Ms until the label fade (0: the next frame) or decorative motion (≤ 30 fps) wants a frame, or null when nothing moves. */
    motionDelay(now: number): number | null;
    /** After a lost WebGL context is restored: re-apply the last marks, paint, palette and placement (no tween). */
    restore(now: number): void;
    dispose(): void;
}

export interface WebGLStageOptions {
    /** Where the mono font comes from (default: the host's @fontsource faces in the document). */
    fonts?: StageFontPort;
    /** The text objects of the label pass (default: troika); `onSynced` asks for a frame once text is typeset. */
    text?: (onSynced: () => void) => TextPort;
    /** Told when the stage needs a frame outside the tween (troika finished typesetting). */
    onChange?: () => void;
}

/** The palette as sRGB triples, written to the shader as-is (a ShaderMaterial does no colour-space conversion). */
export function paletteOf(colors: ThemeColors, into: Vector3[]): void {
    const c = new Color(), rgb = { r: 0, g: 0, b: 0 };
    TONE_ORDER.forEach((tone, i) => {
        c.setStyle(colors[tone] ?? '#808080');
        c.getRGB(rgb, SRGBColorSpace);
        into[i]?.set(rgb.r, rgb.g, rgb.b);
    });
}

const hasPulse = (paint: MarkPaint): boolean => paint.flags.some((f) => (f & FLAG.PULSE) !== 0);

export function createWebGLStage(options: WebGLStageOptions = {}): StageRenderer {
    const stats = createStats();
    const uniforms = sharedMarkUniforms();
    const marksLayer = new MarkLayer(stats, uniforms);
    const links = new LinkLayer(stats, { uPxPerWorld: uniforms.uPxPerWorld, uDpr: uniforms.uDpr, uPalette: uniforms.uPalette, uBg: uniforms.uBg });
    const planes = new PlaneLayer(stats, uniforms.uPalette);
    const redraw = new Set<() => void>();
    const notify = (): void => { options.onChange?.(); for (const cb of redraw) cb(); };
    const labels = new LabelLayer((options.text ?? troikaTextPort)(notify), options.fonts ?? documentFontPort());
    const root = new Group();
    root.add(planes.group, links.group, marksLayer.group);
    if (labels.object) root.add(labels.object);
    const overlay = new OverlayLayer(stats, { uPxPerWorld: uniforms.uPxPerWorld, uDpr: uniforms.uDpr, uPalette: uniforms.uPalette, uBg: uniforms.uBg });
    root.add(overlay.group);
    const appended = new AppendedSlots();
    const live = new LiveKeys();
    /** The MarkSet the host gave, and every run appended since (a restore rebuilds from them). */
    let base: MarkSet | null = null;
    let runs: SlotAppend[] = [];
    let overlayState: OverlayState = NO_OVERLAY;
    const tween = new Tween();
    let marks: MarkSet | null = null, placement: Placement | null = null, paint: MarkPaint | null = null, colors: ThemeColors | null = null;
    let view: StageView = { pxPerWorld: 1, dpr: 1 };
    let motion: StageMotion = { visible: true, reduced: false }, pulsing = false, lastMotion = -Infinity;
    const labelView = () => ({ pxPerWorld: view.pxPerWorld, depth: uniforms.uDepth.value });

    const land = (now: number, animate: boolean): void => {
        uniforms.uT.value = 1;
        if (!placement) return;
        links.set(placement.links); links.visible = true;
        planes.set(placement.planes); planes.visible = true;
        overlay.follow(placement);
        if (animate) labels.landed(now);
    };
    const motionOn = (): boolean => pulsing && motion.visible && !motion.reduced;

    const r: StageRenderer = {
        kind: 'webgl', object: root, stats,
        get marks() { return marks; },
        get placement() { return placement; },
        get labelCaptions() { return labels.domCaptions; },
        keys: () => live.get(),
        onKeys: (cb) => live.on(cb),
        onRedraw(cb) { redraw.add(cb); return () => { redraw.delete(cb); }; },
        setMarks(set) { base = set; runs = []; marks = set; marksLayer.setMarks(set); placement = null; appended.reset(); overlay.follow(null); live.reset(set.keys); },
        setPaint(next) { paint = next; marksLayer.setPaint(next); pulsing = hasPulse(next); },
        get overlay() { return overlayState; },
        setOverlay(state) { overlayState = state; overlay.set(state); },
        setPalette(next) {
            colors = next;
            paletteOf(next, uniforms.uPalette.value);
            const bg = new Color(), rgb = { r: 0, g: 0, b: 0 };
            bg.setStyle(next.bg ?? '#ffffff').getRGB(rgb, SRGBColorSpace);
            uniforms.uBg.value.set(rgb.r, rgb.g, rgb.b);
            labels.setPalette(next);
            overlay.setAccent(next.accent ?? '#2563eb');
        },
        setPlacement(next, now, tweenMs) {
            // A placement arriving mid-tween continues from where the marks ARE (baked at the current eased t).
            const midTween = tween.active ? uniforms.uT.value : undefined;
            if (tween.active) tween.finish();
            // A drill appends its symbols into the headroom (ranged); only an overflow rebuilds the meshes (and jumps).
            let rebuilt = false;
            if (next.append && marks) {
                if (!marksLayer.append(next.append, placement)) { const grown = withAppended(marks, next.append); marks = grown; marksLayer.setMarks(grown); placement = null; rebuilt = true; if (paint) marksLayer.setPaint(paint); }
                appended.add(next.append);
                if (!runs.includes(next.append)) runs.push(next.append);
                live.append(next.append);
            }
            const p = appended.pad(next);
            const first = placement === null;
            placement = p;
            overlay.follow(null);
            uniforms.uFlip.value = marksLayer.setPlacement(p, first || rebuilt || tweenMs <= 0 ? undefined : midTween);
            const jump = first || tweenMs <= 0;
            labels.setPlacement(p, now, !jump);
            if (jump) { land(now, false); labels.place(labelView()); return; }
            links.visible = false;
            planes.visible = false;
            uniforms.uT.value = 0;
            tween.begin(now, tweenMs);
        },
        setView(next) { view = next; uniforms.uPxPerWorld.value = next.pxPerWorld; uniforms.uDpr.value = next.dpr; },
        settleView(next) { r.setView(next); if (!tween.active) labels.place(labelView()); },
        get depth() { return uniforms.uDepth.value; },
        setDepth(depth, settled = true) {
            uniforms.uDepth.value = depth;
            if (!settled) return;
            overlay.setDepth(depth);
            if (!tween.active) labels.place(labelView());
        },
        setMotion(next) { motion = next; uniforms.uMotion.value = next.reduced ? 0 : 1; },
        tick(now) {
            let more = false;
            if (tween.active) {
                uniforms.uT.value = tween.at(now);
                if (tween.active) more = true; else land(now, true);
            }
            labels.tick(now, labelView());
            if (motionOn() && now - lastMotion >= MOTION_FRAME_MS - 1) { uniforms.uTime.value = now; lastMotion = now; }
            return more;
        },
        motionDelay(now) {
            if (labels.fade.animating) return 0;
            return motionOn() ? Math.max(0, MOTION_FRAME_MS - (now - lastMotion)) : null;
        },
        restore(now) {
            const last = { paint, colors, placement };
            if (!base) return;
            tween.finish();
            // The host's MarkSet with every appended run folded in: the meshes come back holding every live slot, and the
            // live keys (which only a new MarkSet resets) are unchanged.
            const full = runs.reduce((m, run) => withAppended(m, run), base);
            marks = full;
            marksLayer.setMarks(full);
            placement = null;
            appended.reset();
            for (const run of runs) appended.add(run);
            overlay.follow(null);
            if (last.paint) r.setPaint(last.paint);
            if (last.colors) r.setPalette(last.colors);
            if (last.placement) r.setPlacement(last.placement, now, 0);
        },
        dispose() { marksLayer.dispose(); links.dispose(); planes.dispose(); labels.dispose(); overlay.dispose(); },
    };
    return r;
}

/** jsdom / no WebGL: nothing is drawn; the placement is kept for picking, the a11y proxies and the DOM captions. */
export function createNoopStage(): StageRenderer {
    const stats = createStats();
    let marks: MarkSet | null = null, placement: Placement | null = null, table: SlotTable | null = null;
    let overlayState: OverlayState = NO_OVERLAY, depth = 0;
    const appended = new AppendedSlots();
    const live = new LiveKeys();
    return {
        kind: 'none', object: null, stats,
        get marks() { return marks; },
        get placement() { return placement; },
        keys: () => live.get(),
        onKeys: (cb) => live.on(cb),
        onRedraw: () => () => {},
        // Nothing draws without WebGL (B8: such a host shows the List camera), so no label is routed anywhere.
        labelCaptions: [],
        get overlay() { return overlayState; },
        setOverlay(state) { overlayState = state; },
        setMarks(set) { marks = set; placement = null; table = new SlotTable(set); appended.reset(); live.reset(set.keys); },
        setPaint() {},
        setPalette() {},
        // The same slot rules as the WebGL stage (append into the headroom, rebuild on overflow), so a drill behaves alike.
        setPlacement(p) {
            if (p.append && marks && table) {
                if (!table.appendRun(p.append)) { marks = withAppended(marks, p.append); table = new SlotTable(marks); }
                appended.add(p.append);
                live.append(p.append);
            }
            placement = appended.pad(p);
        },
        setView() {},
        settleView() {},
        get depth() { return depth; },
        setDepth(d) { depth = d; },
        setMotion() {},
        tick: () => false,
        motionDelay: () => null,
        restore() {},
        dispose() {},
    };
}
