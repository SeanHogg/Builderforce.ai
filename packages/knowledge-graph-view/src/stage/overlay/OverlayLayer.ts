/**
 * The stage's overlay (PRD 43 B3 Overlay, B7 Selection): the selection ring (the text colour: a white edge on the dark
 * theme), the hover ring, the reading ring (the symbol on the code panel's reading line, a thick accent glow) and the
 * current-call ring (the code band's current callee, in the partner amber), and the highlighted lines — the path through
 * its stops, the selected slot's incident edges, sliced on the main thread from the ranked incident index, and the open
 * method's numbered calls as arcs (`callArcs.ts`; the current one amber and wider). Five meshes in all, drawn OVER the
 * marks and moved to the placement's positions; a selection, hover, reading or step change rewrites them and never
 * touches a mark's attributes (no per-mark state rebuild). Hidden while a tween runs (the marks are between placements);
 * shown again where the target placement put them.
 *
 * The lines go through the stage's ONE line shader (`links/LinkLayer`), as one `edge` batch in screen pixels.
 */

import { Color, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, SRGBColorSpace, TorusGeometry } from 'three';
import { CALL_LINK_STYLE } from '../../compute/tasks/placement/associations';
import { polylineBatch, roundedPoints, type WorldPath } from '../../compute/tasks/placement/links';
import { HallLayer, type HallUniforms } from '../links/HallLayer';
import { LinkLayer } from '../links/LinkLayer';
import { slotHalfPx } from '../markSize';
import type { LinkUniforms } from '../links/shader';
import type { StageStats } from '../stats';
import { toneIndex } from '../tones';
import { FLAG, type LinkBatch, type Placement } from '../types';
import { callArc, nthCallTo, type CallTrack, type GroundPt } from './callArcs';

export interface OverlayState {
    /** Slots; -1 = none. */
    selected: number;
    hover: number;
    /** The highlighted path's stops, in order. */
    path: ArrayLike<number>;
    /** The selected slot's neighbours (ranked, already capped). */
    incident: ArrayLike<number>;
    /** The slot on the code panel's reading line; -1 or absent = none. */
    reading?: number;
    /** The open method's numbered calls; absent or null = none. */
    calls?: CallTrack | null;
}

export const NO_OVERLAY: OverlayState = { selected: -1, hover: -1, path: [], incident: [] };

/** The highlighted path's hall bar: this wide (world units) per unit of the mark's own radius, never thinner than the minimum. */
const PATH_HALL_MIN = 4, PATH_HALL_SHARE = 0.34;
const INCIDENT_PX = 1.5;
/** A call's arc, and the current call's (wider, so it reads over the others). */
const CALL_PX = 1.5, CURRENT_CALL_PX = 3;
/** A ring sits this much wider than its mark, and never smaller than this many world units. */
const RING_GROW = 1.35, RING_MIN = 6;
/** World units the overlay floats over the ground (`CallBadges` projects the call numbers at the same height). */
export const OVERLAY_LIFT = 0.5;

const shown = (p: Placement, s: number): boolean => s >= 0 && s < p.scale.length && p.scale[s]! > 0;
const at = (p: Placement, s: number) => ({ x: p.position[s * 3]!, y: p.position[s * 3 + 2]! });
/** Ground points lifted to the overlay's height (a call's arc is already smooth: only the path's stops get rounded corners). */
const lifted = (pts: readonly GroundPt[]) => pts.map((q): [number, number, number] => [q.x, OVERLAY_LIFT, q.y]);

/**
 * The highlighted path as a LIT HALL batch (the design's emissive accent bar with a travelling pulse): the path's consecutive
 * shown stops joined by rounded corners, raised just off the floor. Null when fewer than two stops are shown.
 */
export function overlayHalls(p: Placement, state: OverlayState): LinkBatch | null {
    const stops: GroundPt[] = [];
    for (let i = 0; i < state.path.length; i++) { const s = state.path[i]!; if (shown(p, s)) stops.push(at(p, s)); }
    if (stops.length < 2) return null;
    const width = Math.max(PATH_HALL_MIN, PATH_HALL_SHARE * 2 * Math.min(...Array.from(state.path, (s) => (shown(p, s) ? p.scale[s]! : Infinity))));
    return polylineBatch('hall', [{ pts: roundedPoints(stops).map((q): [number, number, number] => [q.x, 0, q.y]), tone: toneIndex('lit'), width, dash: 0, flags: FLAG.PULSE }], 'world');
}

/**
 * The overlay's lines for `state` over placement `p`: the path's consecutive shown stops, then one segment from the
 * selection to each neighbour that is somewhere else (a hidden neighbour sits at its anchor), then one arc per call of
 * the open method to a shown callee, the current call last (drawn on top). Null when there are none.
 */
export function overlayLinks(p: Placement, state: OverlayState): LinkBatch | null {
    const tone = toneIndex('accent');
    const callTone = toneIndex(CALL_LINK_STYLE.tone);
    const paths: WorldPath[] = [];
    if (shown(p, state.selected)) {
        const from = at(p, state.selected);
        for (let i = 0; i < state.incident.length; i++) {
            const s = state.incident[i]!;
            if (s < 0 || s >= p.scale.length) continue;
            const to = at(p, s);
            if (to.x === from.x && to.y === from.y) continue;
            paths.push({ pts: lifted([from, to]), tone, width: INCIDENT_PX, dash: 0, flags: 0 });
        }
    }
    const calls = state.calls;
    if (calls && shown(p, calls.from)) {
        const from = at(p, calls.from);
        let current: WorldPath | null = null;
        for (let i = 0; i < calls.to.length; i++) {
            const s = calls.to[i]!;
            if (!shown(p, s) || s === calls.from) continue;
            const pts = lifted(callArc(from, at(p, s), nthCallTo(calls.to, i)));
            if (i === calls.current) current = { pts, tone: toneIndex('partner'), width: CURRENT_CALL_PX, dash: 0, flags: 0 };
            else paths.push({ pts, tone: callTone, width: CALL_PX, dash: CALL_LINK_STYLE.dash, flags: 0 });
        }
        if (current) paths.push(current);
    }
    if (paths.length === 0) return null;
    return polylineBatch('edge', paths, 'px');
}

const PRIMED_SEGMENTS = 256;

function emptyBatch(segments: number): LinkBatch {
    return {
        family: 'edge', points: new Float32Array((segments + 1) * 3), runLength: new Float32Array(segments + 1),
        tone: new Uint8Array(segments), width: new Float32Array(segments), dash: new Uint8Array(segments), flags: new Uint8Array(segments),
        group: new Uint32Array(segments), widthUnit: 'px',
    };
}

/** A ring's inner radius (its outer is 1); the reading ring's is thicker: a glow around the mark rather than an edge. */
const RING_INNER = 0.82, READING_INNER = 0.66;
/** The selection TORUS: the design's ring around the shape, its tube this share of the radius. */
const TORUS_TUBE = 0.045;

function torus(order: number): Mesh {
    const geometry = new TorusGeometry(1, TORUS_TUBE, 8, 64);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
}

function ring(order: number, opacity: number, inner = RING_INNER): Mesh {
    const geometry = new RingGeometry(inner, 1, 48);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ transparent: true, opacity, depthTest: false, side: DoubleSide }));
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
}

export class OverlayLayer {
    readonly group = new Group();
    private readonly selectRing = torus(6);
    private readonly hoverRing = ring(5, 0.55);
    private readonly readingRing = ring(5, 0.85, READING_INNER);
    private readonly callRing = ring(6, 1);
    private readonly lines: LinkLayer;
    private readonly halls: HallLayer;
    private state: OverlayState = NO_OVERLAY;
    private placement: Placement | null = null;
    /** The depth control: a ring sits on top of the mark as drawn (extrude × depth, the shader's `uDepth`). */
    private depth = 0;

    setDepth(depth: number): void { if (depth !== this.depth) { this.depth = depth; this.draw(); } }

    /** CSS px per world unit at the settled zoom: a ring rings the mark as DRAWN, which a placement's `minMarkPx` floors. */
    private pxPerWorld = 1;

    setPxPerWorld(px: number): void {
        if (px === this.pxPerWorld) return;
        this.pxPerWorld = px;
        if (this.placement?.minMarkPx) this.placeRings();
    }

    constructor(stats: StageStats, uniforms: LinkUniforms & HallUniforms) {
        // Only the `edge` family: the overlay's lines are one px batch (LinkLayer preallocates what it is told to).
        this.lines = new LinkLayer(stats, uniforms, ['edge']);
        this.halls = new HallLayer(stats, uniforms);
        this.selectRing.name = 'overlay:selection';
        this.hoverRing.name = 'overlay:hover';
        this.readingRing.name = 'overlay:reading';
        this.callRing.name = 'overlay:call';
        this.group.add(this.lines.group, this.halls.group, this.readingRing, this.hoverRing, this.callRing, this.selectRing);
        this.group.renderOrder = 5;
        // The line mesh exists from the start (sized for a long path and a full incident fan), so a selection creates none.
        this.lines.set([emptyBatch(PRIMED_SEGMENTS)]);
        this.lines.set([]);
    }

    /**
     * The rings' colours (CSS, written as sRGB as-is like the palette): hover and reading in the accent, the selection in
     * `selection` (the theme's text colour) and the current call in `call` (the partner amber).
     */
    setColors(colors: { accent: string; selection: string; call: string }): void {
        const c = new Color(), rgb = { r: 0, g: 0, b: 0 };
        const paint = (meshes: readonly Mesh[], css: string) => {
            c.setStyle(css).getRGB(rgb, SRGBColorSpace);
            for (const m of meshes) (m.material as MeshBasicMaterial).color.setRGB(rgb.r, rgb.g, rgb.b);
        };
        paint([this.hoverRing, this.readingRing], colors.accent);
        paint([this.selectRing], colors.selection);
        paint([this.callRing], colors.call);
    }

    set(state: OverlayState): void { this.state = state; this.draw(); }

    /** The placement the overlay follows (null hides it: a tween is running). */
    follow(p: Placement | null): void { this.placement = p; this.draw(); }

    private get rings(): readonly Mesh[] { return [this.selectRing, this.hoverRing, this.readingRing, this.callRing]; }

    get meshes(): readonly Mesh[] { return [...this.rings, ...this.lines.meshes, ...this.halls.meshes]; }

    private draw(): void {
        const p = this.placement, s = this.state;
        this.group.visible = !!p;
        if (!p) return;
        this.placeRings();
        const batch = overlayLinks(p, s);
        this.lines.set(batch ? [batch] : []);
        const path = overlayHalls(p, s);
        this.halls.set(path ? [path] : []);
    }

    /** A lit path hall is on screen: the renderer keeps the decorative clock running. */
    get pulsing(): boolean { return this.group.visible && this.halls.pulsing; }

    private placeRings(): void {
        const p = this.placement, s = this.state;
        if (!p) return;
        place(this.selectRing, p, s.selected, this.depth, this.pxPerWorld);
        place(this.hoverRing, p, s.hover === s.selected ? -1 : s.hover, this.depth, this.pxPerWorld);
        place(this.readingRing, p, s.reading ?? -1, this.depth, this.pxPerWorld);
        place(this.callRing, p, s.calls && s.calls.current >= 0 ? s.calls.to[s.calls.current] ?? -1 : -1, this.depth, this.pxPerWorld);
    }

    dispose(): void {
        for (const m of this.rings) { m.geometry.dispose(); (m.material as MeshBasicMaterial).dispose(); }
        this.lines.dispose();
        this.halls.dispose();
    }
}

function place(m: Mesh, p: Placement, s: number, depth: number, pxPerWorld: number): void {
    m.visible = shown(p, s);
    if (!m.visible) return;
    const r = Math.max(RING_MIN, (slotHalfPx(p, s, pxPerWorld) / Math.max(pxPerWorld, 1e-6)) * RING_GROW);
    // A rectangle (`Placement.aspect` = depth ÷ width): the ring is scaled along z by it, so it fits the footprint; the short side keeps the round ring's size.
    const asp = p.aspect?.[s] ?? 1, rz = r * asp;
    // The mark's foot as the shader draws it: a placement that lifts with the depth lowers its heights with it.
    const foot = p.position[s * 3 + 1]! * (p.liftWithDepth ? depth : 1);
    if (m.name === 'overlay:selection') {
        // The torus rings the shape at its foot (the design's: just off the floor); its tube stays round on the short side (x and z scale together, to the shorter).
        const k = Math.min(r, rz);
        m.position.set(p.position[s * 3]!, foot + TORUS_TUBE * k, p.position[s * 3 + 2]!);
        m.scale.set(r, k, rz);
        return;
    }
    m.position.set(p.position[s * 3]!, foot + (p.extrude[s] ?? 0) * depth + OVERLAY_LIFT, p.position[s * 3 + 2]!);
    m.scale.set(r, 1, rz);
}
