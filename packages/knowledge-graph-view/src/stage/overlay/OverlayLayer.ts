/**
 * The stage's overlay (PRD 43 B3 Overlay, B7 Selection): the selection ring, the hover ring and the highlighted lines —
 * the path through its stops and the selected slot's incident edges, sliced on the main thread from the ranked incident
 * index. Three meshes in all, drawn OVER the marks and moved to the placement's positions; a selection or hover change
 * rewrites them and never touches a mark's attributes (no per-mark state rebuild). Hidden while a tween runs (the marks
 * are between placements); shown again where the target placement put them.
 *
 * The lines go through the stage's ONE line shader (`links/LinkLayer`), as one `edge` batch in screen pixels.
 */

import { Color, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, SRGBColorSpace } from 'three';
import { linkBatch, type LinkPath } from '../../compute/tasks/placement/links';
import { LinkLayer } from '../links/LinkLayer';
import type { LinkUniforms } from '../links/shader';
import type { StageStats } from '../stats';
import { toneIndex } from '../tones';
import type { LinkBatch, Placement } from '../types';

export interface OverlayState {
    /** Slots; -1 = none. */
    selected: number;
    hover: number;
    /** The highlighted path's stops, in order. */
    path: ArrayLike<number>;
    /** The selected slot's neighbours (ranked, already capped). */
    incident: ArrayLike<number>;
}

export const NO_OVERLAY: OverlayState = { selected: -1, hover: -1, path: [], incident: [] };

const PATH_PX = 3;
const INCIDENT_PX = 1.5;
/** A ring sits this much wider than its mark, and never smaller than this many world units. */
const RING_GROW = 1.35, RING_MIN = 6;
const LIFT = 0.5;

const shown = (p: Placement, s: number): boolean => s >= 0 && s < p.scale.length && p.scale[s]! > 0;
const at = (p: Placement, s: number) => ({ x: p.position[s * 3]!, y: p.position[s * 3 + 2]! });

/**
 * The overlay's lines for `state` over placement `p`: the path's consecutive shown stops, then one segment from the
 * selection to each neighbour that is somewhere else (a hidden neighbour sits at its anchor). Null when there are none.
 */
export function overlayLinks(p: Placement, state: OverlayState): LinkBatch | null {
    const tone = toneIndex('accent');
    const paths: LinkPath[] = [];
    const stops: { x: number; y: number }[] = [];
    for (let i = 0; i < state.path.length; i++) { const s = state.path[i]!; if (shown(p, s)) stops.push(at(p, s)); }
    if (stops.length >= 2) paths.push({ pts: stops, tone, width: PATH_PX, dash: 0, flags: 0 });
    if (shown(p, state.selected)) {
        const from = at(p, state.selected);
        for (let i = 0; i < state.incident.length; i++) {
            const s = state.incident[i]!;
            if (s < 0 || s >= p.scale.length) continue;
            const to = at(p, s);
            if (to.x === from.x && to.y === from.y) continue;
            paths.push({ pts: [from, to], tone, width: INCIDENT_PX, dash: 0, flags: 0 });
        }
    }
    if (paths.length === 0) return null;
    return { ...linkBatch('edge', paths, LIFT), widthUnit: 'px' };
}

const PRIMED_SEGMENTS = 256;

function emptyBatch(segments: number): LinkBatch {
    return {
        family: 'edge', points: new Float32Array((segments + 1) * 3), runLength: new Float32Array(segments + 1),
        tone: new Uint8Array(segments), width: new Float32Array(segments), dash: new Uint8Array(segments), flags: new Uint8Array(segments),
        group: new Uint32Array(segments), widthUnit: 'px',
    };
}

function ring(order: number, opacity: number): Mesh {
    const geometry = new RingGeometry(0.82, 1, 48);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ transparent: true, opacity, depthTest: false, side: DoubleSide }));
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
}

export class OverlayLayer {
    readonly group = new Group();
    private readonly selectRing = ring(6, 1);
    private readonly hoverRing = ring(5, 0.55);
    private readonly lines: LinkLayer;
    private state: OverlayState = NO_OVERLAY;
    private placement: Placement | null = null;
    /** The depth control: a ring sits on top of the mark as drawn (extrude × depth, the shader's `uDepth`). */
    private depth = 0;

    setDepth(depth: number): void { if (depth !== this.depth) { this.depth = depth; this.draw(); } }

    constructor(stats: StageStats, uniforms: LinkUniforms) {
        // Only the `edge` family: the overlay's lines are one px batch (LinkLayer preallocates what it is told to).
        this.lines = new LinkLayer(stats, uniforms, ['edge']);
        this.selectRing.name = 'overlay:selection';
        this.hoverRing.name = 'overlay:hover';
        this.group.add(this.lines.group, this.hoverRing, this.selectRing);
        this.group.renderOrder = 5;
        // The line mesh exists from the start (sized for a long path and a full incident fan), so a selection creates none.
        this.lines.set([emptyBatch(PRIMED_SEGMENTS)]);
        this.lines.set([]);
    }

    /** The accent the rings are drawn in (sRGB, written as-is like the palette). */
    setAccent(css: string): void {
        const c = new Color(), rgb = { r: 0, g: 0, b: 0 };
        c.setStyle(css).getRGB(rgb, SRGBColorSpace);
        for (const m of [this.selectRing, this.hoverRing]) (m.material as MeshBasicMaterial).color.setRGB(rgb.r, rgb.g, rgb.b);
    }

    set(state: OverlayState): void { this.state = state; this.draw(); }

    /** The placement the overlay follows (null hides it: a tween is running). */
    follow(p: Placement | null): void { this.placement = p; this.draw(); }

    get meshes(): readonly Mesh[] { return [this.selectRing, this.hoverRing, ...this.lines.meshes]; }

    private draw(): void {
        const p = this.placement, s = this.state;
        this.group.visible = !!p;
        if (!p) return;
        place(this.selectRing, p, s.selected, this.depth);
        place(this.hoverRing, p, s.hover === s.selected ? -1 : s.hover, this.depth);
        const batch = overlayLinks(p, s);
        this.lines.set(batch ? [batch] : []);
    }

    dispose(): void {
        for (const m of [this.selectRing, this.hoverRing]) { m.geometry.dispose(); (m.material as MeshBasicMaterial).dispose(); }
        this.lines.dispose();
    }
}

function place(m: Mesh, p: Placement, s: number, depth: number): void {
    m.visible = shown(p, s);
    if (!m.visible) return;
    const r = Math.max(RING_MIN, p.scale[s]! * RING_GROW);
    m.position.set(p.position[s * 3]!, p.position[s * 3 + 1]! + (p.extrude[s] ?? 0) * depth + LIFT, p.position[s * 3 + 2]!);
    m.scale.set(r, 1, r);
}
