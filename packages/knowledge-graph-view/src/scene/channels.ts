/**
 * The Tower's overlay channels as plain data — pure, so they are tested without WebGL. The
 * same bindings that colour the transit map drive the tower: a node's HEIGHT is the size
 * channel, a FILL BAND (the coverage fill line) is the ring channel, an untested file is a
 * WIREFRAME shell, and a pipe's WIDTH is the width channel. A channel with no data leaves the
 * node at a neutral height with no band; nothing is ever drawn as zero.
 */

import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { frac, level5 } from '../surface/overlays';
import type { OverlayModel } from '../surface/overlays';
import { stationOfRef, type StationModel } from '../surface/stations';
import { edgeBucket, type NodeInstances } from './buffers';
import { towerHeight } from './layout3d';
import type { ThemeTone } from './themeColors';

/** Line coverage under this reads as untested (the transit map dashes a segment by the same line). */
export const UNTESTED_BELOW = 0.5;
export const MAX_PIPES = 1500;

export interface NodeChannel {
    height: number;
    /** The ring channel's 0 to 1, when it has data for this node. */
    fill?: number;
    fillTone?: ThemeTone;
    /** Coverage was collected and is under {@link UNTESTED_BELOW}. */
    shell: boolean;
}
export type NodeChannels = ReadonlyMap<string, NodeChannel>;

/** What the scene is handed to draw the channels. */
export interface SceneChannels {
    nodes: NodeChannels;
    /** A pipe radius per edge; null for an edge the width channel has no reading for. Absent ⇒ lines. */
    pipeWidth?: ((edge: Pick<KEdge, 'from' | 'to'>) => number | null) | undefined;
}

export function nodeChannels(nodes: readonly KNode[], model: Pick<StationModel, 'stationOf' | 'byId'>, overlay: OverlayModel): NodeChannels {
    const out = new Map<string, NodeChannel>();
    for (const n of nodes) {
        const station = model.byId.get(stationOfRef(model, n.ref) ?? '');
        if (!station) { out.set(n.ref, { height: towerHeight(undefined), shell: false }); continue; }
        const style = overlay.style(station);
        const level = overlay.status.size === 'ready' ? level5(overlay.bindings.size, station) : undefined;
        out.set(n.ref, {
            height: towerHeight(level),
            ...(style.ring ? { fill: style.ring.frac, fillTone: style.ring.tone } : {}),
            shell: station.cov !== undefined && station.cov < UNTESTED_BELOW,
        });
    }
    return out;
}

/** A pipe's radius from the width channel's line width (5 to 12). */
export const pipeRadius = (lineWidth: number): number => 0.03 + ((Math.min(12, Math.max(5, lineWidth)) - 5) / 7) * 0.09;

export function pipeWidthOf(model: Pick<StationModel, 'stationOf' | 'byId'>, overlay: OverlayModel): SceneChannels['pipeWidth'] {
    if (overlay.status.width !== 'ready') return undefined;
    return (edge) => {
        const a = model.byId.get(stationOfRef(model, edge.from) ?? ''), b = model.byId.get(stationOfRef(model, edge.to) ?? '');
        // A pipe is drawn only where the width channel read at least one end.
        const read = a && b && [a, b].some((s) => frac(overlay.bindings.width, s) !== undefined);
        return a && b && read ? pipeRadius(overlay.lineWidth([a, b])) : null;
    };
}

export interface Body {
    ref: string;
    /** The tower's centre. */
    x: number;
    y: number;
    z: number;
    radius: number;
    height: number;
    tone: ThemeTone;
    dim: boolean;
    shell: boolean;
    fill?: number;
    fillTone?: ThemeTone;
}

/** The instanced nodes as towers: a cylinder standing on its plane, its height the size channel. */
export function towerBodies(inst: NodeInstances, channels: NodeChannels): Body[] {
    return inst.refs.map((ref, i) => {
        const c = channels.get(ref) ?? { height: towerHeight(undefined), shell: false };
        return {
            ref, x: inst.positions[i * 3]!, y: inst.positions[i * 3 + 1]! + c.height / 2, z: inst.positions[i * 3 + 2]!,
            radius: inst.scales[i]! * 0.8, height: c.height, tone: inst.tones[i]!, dim: inst.dim[i]!, shell: c.shell,
            ...(c.fill !== undefined && c.fillTone ? { fill: c.fill, fillTone: c.fillTone } : {}),
        };
    });
}

export interface Pipe {
    mid: readonly [number, number, number];
    /** Unit vector from the first end to the second. */
    dir: readonly [number, number, number];
    length: number;
    radius: number;
    tone: ThemeTone;
}

/** A pipe per edge between two placed towers, at most {@link MAX_PIPES}; zero-length edges are skipped. */
export function pipes(edges: readonly KEdge[], bodies: readonly Body[], radiusOf: NonNullable<SceneChannels['pipeWidth']>): Pipe[] {
    const at = new Map(bodies.map((b) => [b.ref, b] as const));
    const out: Pipe[] = [];
    for (const e of edges) {
        if (out.length >= MAX_PIPES) break;
        const a = at.get(e.from), b = at.get(e.to);
        const radius = radiusOf(e);
        if (!a || !b || radius === null) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const length = Math.hypot(dx, dy, dz);
        if (length < 1e-6) continue;
        out.push({ mid: [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2], dir: [dx / length, dy / length, dz / length], length, radius, tone: edgeBucket(e).tone });
    }
    return out;
}
