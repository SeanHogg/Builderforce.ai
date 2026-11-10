/**
 * The scene's geometry as plain arrays — pure, so it is tested without WebGL.
 * Nodes become ONE instanced mesh (position + scale + colour per instance); edges become
 * ONE `LineSegments` buffer per edge kind, with rule-breaking and cyclic edges pulled into
 * buckets of their own so they can be drawn in their warning colours (PRD 38 §3.2).
 */

import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import type { LensDef, NodeShape } from '../lenses';
import { cmp, importanceOf } from '../order';
import type { Layout3D } from './layout3d';
import type { ThemeTone } from './themeColors';

export interface NodeInstances {
    refs: string[];
    /** xyz per instance */
    positions: Float32Array;
    scales: Float32Array;
    tones: ThemeTone[];
    shapes: NodeShape[];
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

/** A 3D node's scale (layout units) from its importance — the R3F scene's and the stage's 3D placement's ONE reading. */
export const nodeScale = (n: Pick<KNode, 'importance'>): number =>
    MIN_SCALE + (MAX_SCALE - MIN_SCALE) * Math.sqrt(Math.max(0, Math.min(1, importanceOf(n))));

export function nodeInstances(nodes: readonly KNode[], layout: Layout3D, lens: LensDef): NodeInstances {
    // A layout may be older than `nodes` (a new node lands before the next layout does): only nodes it placed are drawn.
    const placed = nodes.filter((n) => layout.positions.has(n.ref));
    const positions = new Float32Array(placed.length * 3);
    const scales = new Float32Array(placed.length);
    const tones: ThemeTone[] = [];
    const shapes: NodeShape[] = [];
    const dim: boolean[] = [];
    placed.forEach((n, i) => {
        const [x, y, z] = layout.positions.get(n.ref) ?? [0, 0, 0];
        positions.set([x, y, z], i * 3);
        scales[i] = nodeScale(n);
        const style = lens.nodeStyle(n);
        tones.push(style.tone);
        shapes.push(style.shape);
        dim.push(style.emphasis === 'dim');
    });
    return { refs: placed.map((n) => n.ref), positions, scales, tones, shapes, dim };
}

const KIND_TONE: Record<string, ThemeTone> = {
    duplicate: 'duplicate', 'near-duplicate': 'duplicate', contradicts: 'contradicts', agrees: 'agrees',
    'co-changed': 'changed', about: 'nodeFact', mentions: 'nodeEntity',
};

/** A link that breaks the layer rule. */
export const isViolation = (e: KEdge): boolean => e.verdict === 'upward' || e.verdict === 'skips';

/** A link drawn in a warning colour: a layer violation or a cycle (what the picture is for). */
export const isLoudEdge = (e: KEdge): boolean => isViolation(e) || !!e.cycle;

export interface EdgeBucket { bucket: string; tone: ThemeTone }

// Shared frozen buckets: edgeBucket allocates nothing per edge (it runs for every drawn edge).
const VIOLATION: EdgeBucket = Object.freeze({ bucket: 'violation', tone: 'violation' });
const CYCLE: EdgeBucket = Object.freeze({ bucket: 'cycle', tone: 'cycle' });
const KIND_BUCKETS = new Map<string, EdgeBucket>();

export function edgeBucket(e: KEdge): EdgeBucket {
    if (isViolation(e)) return VIOLATION;
    if (e.cycle) return CYCLE;
    let b = KIND_BUCKETS.get(e.kind);
    if (!b) { b = Object.freeze({ bucket: e.kind, tone: KIND_TONE[e.kind] ?? 'edge' }); KIND_BUCKETS.set(e.kind, b); }
    return b;
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
        let g = groups.get(bucket);
        if (!g) { g = { bucket, tone, pairs: [] }; groups.set(bucket, g); }
        g.pairs.push([a, b]);
    }
    return [...groups.values()].sort((a, b) => cmp(a.bucket, b.bucket));
}

export function edgeBuffers(edges: readonly KEdge[], layout: Layout3D): EdgeBuffer[] {
    return groupEdges(edges, (ref) => layout.positions.get(ref)).map((g) => {
        const positions = new Float32Array(g.pairs.length * 6);
        let at = 0;
        for (const [a, b] of g.pairs) {
            positions[at++] = a[0]; positions[at++] = a[1]; positions[at++] = a[2];
            positions[at++] = b[0]; positions[at++] = b[1]; positions[at++] = b[2];
        }
        return { bucket: g.bucket, tone: g.tone, positions, count: g.pairs.length };
    });
}
