/**
 * The scene's geometry as plain arrays — pure, so it is tested without WebGL.
 * Nodes become ONE instanced mesh (position + scale + colour per instance); edges become
 * ONE `LineSegments` buffer per edge kind, with rule-breaking and cyclic edges pulled into
 * buckets of their own so they can be drawn in their warning colours (PRD 38 §3.2).
 */

import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import type { LensDef } from '../lenses';
import { cmp, importanceOf } from '../order';
import type { Layout3D } from './layout3d';
import type { ThemeTone } from './themeColors';

export interface NodeInstances {
    refs: string[];
    /** xyz per instance */
    positions: Float32Array;
    scales: Float32Array;
    tones: ThemeTone[];
    dim: boolean[];
}

export interface EdgeBuffer {
    /** The edge kind, or `violation` / `cycle` for highlighted edges. */
    bucket: string;
    tone: ThemeTone;
    /** Two xyz points per edge. */
    positions: Float32Array;
    count: number;
}

const MIN_SCALE = 0.18;
const MAX_SCALE = 0.75;

export function nodeInstances(nodes: readonly KNode[], layout: Layout3D, lens: LensDef): NodeInstances {
    // A layout may be older than `nodes` (a new node lands before the next layout does): only nodes it placed are drawn.
    const placed = nodes.filter((n) => layout.positions.has(n.ref));
    const positions = new Float32Array(placed.length * 3);
    const scales = new Float32Array(placed.length);
    const tones: ThemeTone[] = [];
    const dim: boolean[] = [];
    placed.forEach((n, i) => {
        const [x, y, z] = layout.positions.get(n.ref) ?? [0, 0, 0];
        positions.set([x, y, z], i * 3);
        scales[i] = MIN_SCALE + (MAX_SCALE - MIN_SCALE) * Math.sqrt(Math.max(0, Math.min(1, importanceOf(n))));
        const style = lens.nodeStyle(n);
        tones.push(style.tone);
        dim.push(style.emphasis === 'dim');
    });
    return { refs: placed.map((n) => n.ref), positions, scales, tones, dim };
}

const KIND_TONE: Record<string, ThemeTone> = {
    duplicate: 'duplicate', 'near-duplicate': 'duplicate', contradicts: 'contradicts', agrees: 'agrees',
    'co-changed': 'changed', about: 'nodeFact', mentions: 'nodeEntity',
};

export function edgeBucket(e: KEdge): { bucket: string; tone: ThemeTone } {
    if (e.verdict === 'upward' || e.verdict === 'skips') return { bucket: 'violation', tone: 'violation' };
    if (e.cycle) return { bucket: 'cycle', tone: 'cycle' };
    return { bucket: e.kind, tone: KIND_TONE[e.kind] ?? 'edge' };
}

export interface EdgeGroup<P> {
    bucket: string;
    tone: ThemeTone;
    /** One [from, to] position pair per drawn edge. */
    pairs: Array<readonly [P, P]>;
}

/** Edges bucketed by tone (kind, or violation / cycle), buckets sorted; an edge with an unplaced end is skipped. Shared by the 3D buffers and the 2D paths. */
export function groupEdges<P>(edges: readonly KEdge[], at: (ref: string) => P | undefined): Array<EdgeGroup<P>> {
    const groups = new Map<string, EdgeGroup<P>>();
    for (const e of edges) {
        const a = at(e.from), b = at(e.to);
        if (!a || !b) continue;
        const { bucket, tone } = edgeBucket(e);
        const g = groups.get(bucket) ?? groups.set(bucket, { bucket, tone, pairs: [] }).get(bucket)!;
        g.pairs.push([a, b]);
    }
    return [...groups.values()].sort((a, b) => cmp(a.bucket, b.bucket));
}

export function edgeBuffers(edges: readonly KEdge[], layout: Layout3D): EdgeBuffer[] {
    return groupEdges(edges, (ref) => layout.positions.get(ref)).map((g) => ({
        bucket: g.bucket,
        tone: g.tone,
        positions: new Float32Array(g.pairs.flatMap(([a, b]) => [a[0], a[1], a[2], b[0], b[1], b[2]])),
        count: g.pairs.length,
    }));
}
