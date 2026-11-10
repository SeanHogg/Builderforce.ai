/**
 * THE mark-type registry (PRD 43 B1a rule 2): shape = node type, the same in every camera. ONE
 * table from what a node IS to the silhouette the Graph canvas, the 3D scene and Tower, the Map
 * stations and towers, the Mind map and every legend draw for it:
 *
 *   node ──markTypeOf──▶ MarkType ──TYPE_SHAPE──▶ NodeShape ──SHAPE_OUTLINES──▶ 2D path (SHAPE_PATHS)
 *                                                                          └──▶ 3D: the outline extruded
 *
 * `markTypeOf` reads only the node's `kind` (a string: memory's NODE_KINDS plus `missing`), the ONE
 * path classifier (`fileCategory`) and the ONE symbol classifier (`symbolSort`, here). Aggregates
 * have no node: a system/package is a hexagon, an area/folder takes its members' dominant type
 * ({@link dominantType}). Every 3D shape is its 2D outline extruded (flat = extrude 0), so a node
 * reads the same from above and in depth. Renderers never branch on a kind.
 */

import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { fileCategory } from './fileCategory';

/**
 * Memory's node kinds (`NODE_KINDS` in `@seanhogg/builderforce-memory` knowledge/pack/sections/columns,
 * not a public export) plus `missing` (a link target that is not in the folder). `KNode.kind` stays a
 * string: an unknown kind takes {@link FALLBACK_TYPE}.
 */
export const KNOWN_NODE_KINDS = ['file', 'section', 'symbol', 'area', 'entity', 'claim', 'fact', 'missing'] as const;

/** What a node is, as the legend names it. */
export type MarkType =
    | 'class' | 'function' | 'source' | 'test' | 'doc' | 'config' | 'style' | 'data'
    | 'section' | 'entity' | 'claim' | 'external' | 'system';

/** The type of a node no rule claims (an unknown kind, an asset, generated output). */
export const FALLBACK_TYPE: MarkType = 'external';

/** Legend order: code first, then documents and knowledge, the outside and the aggregates last. */
export const MARK_TYPE_ORDER: readonly MarkType[] = [
    'class', 'function', 'source', 'test', 'style', 'config', 'data', 'doc', 'section', 'entity', 'claim', 'external', 'system',
];

/** A silhouette. Each has ONE outline: drawn flat in 2D, extruded in 3D. */
export type NodeShape =
    | 'square' | 'circle' | 'roundedSquare' | 'diamond' | 'tile' | 'triangle' | 'roundedTriangle'
    | 'drum' | 'bookmark' | 'pentagon' | 'smallStar' | 'octagon' | 'hexagon';

/** type → shape: no two types share a silhouette. */
export const TYPE_SHAPE: Readonly<Record<MarkType, NodeShape>> = Object.freeze({
    class: 'square', function: 'circle', source: 'roundedSquare', test: 'diamond', doc: 'tile', config: 'triangle',
    style: 'roundedTriangle', data: 'drum', section: 'bookmark', entity: 'pentagon', claim: 'smallStar',
    external: 'octagon', system: 'hexagon',
});

/** Shapes drawn with a dashed outline (the outside: a missing or external target). */
export const DASHED_SHAPES: ReadonlySet<NodeShape> = new Set<NodeShape>(['octagon']);

/** The legend key (`labels.legend`) that names a type. */
export const typeLegendKey = (type: MarkType): string => `type${type.charAt(0).toUpperCase()}${type.slice(1)}`;

export type SymbolSort = 'class' | 'function' | 'method';
const CLASSY = /^(class|interface|type|enum|struct|trait|object)$/;
const METHODY = /^(method|member|constructor)$/;

/** A symbol's sort: from a badge when the pack wrote one (`symbolKind`, `kind` or `type`), else from its name. */
export function symbolSort(n: Pick<KNode, 'label' | 'badges'>): SymbolSort {
    const declared = String(n.badges?.symbolKind ?? n.badges?.kind ?? n.badges?.type ?? '').toLowerCase();
    if (CLASSY.test(declared)) return 'class';
    if (METHODY.test(declared)) return 'method';
    if (declared !== '') return 'function';
    const name = n.label.replace(/\(.*$/, '');
    if (name.includes('.')) return 'method';
    return /^[A-Z]/.test(name) ? 'class' : 'function';
}

const FILE_TYPE = { source: 'source', test: 'test', doc: 'doc', config: 'config', style: 'style', data: 'data', other: FALLBACK_TYPE } as const;

/**
 * A node's type. An `area` node is an aggregate: alone it reads as `source` (what a folder mostly
 * holds); a surface that knows its members uses {@link dominantType} instead.
 */
export function markTypeOf(n: Pick<KNode, 'kind' | 'ref' | 'label' | 'badges'>): MarkType {
    switch (n.kind) {
        case 'file': return FILE_TYPE[fileCategory(n)];
        case 'symbol': return symbolSort(n) === 'class' ? 'class' : 'function';
        case 'section': return 'section';
        case 'area': return 'source';
        case 'entity': return 'entity';
        case 'claim': case 'fact': return 'claim';
        case 'missing': return 'external';
        default: return FALLBACK_TYPE;
    }
}

export const typeShape = (type: MarkType): NodeShape => TYPE_SHAPE[type];
export const nodeShape = (n: Pick<KNode, 'kind' | 'ref' | 'label' | 'badges'>): NodeShape => TYPE_SHAPE[markTypeOf(n)];

/** The type most of `types` have (an aggregate's members); ties go to legend order; empty ⇒ `fallback`. */
export function dominantType(types: Iterable<MarkType>, fallback: MarkType = 'source'): MarkType {
    const count = new Map<MarkType, number>();
    for (const t of types) count.set(t, (count.get(t) ?? 0) + 1);
    return dominantOfCounts(count, fallback);
}

/** {@link dominantType} over counts already tallied (a folder tree sums its children's). */
export function dominantOfCounts(count: ReadonlyMap<MarkType, number>, fallback: MarkType = 'source'): MarkType {
    let best = fallback, most = 0;
    for (const t of MARK_TYPE_ORDER) { const c = count.get(t) ?? 0; if (c > most) { best = t; most = c; } }
    return best;
}

/** The types present among `types`, in legend order (what a legend lists). */
export function typesPresent(types: Iterable<MarkType>): MarkType[] {
    const seen = new Set(types);
    return MARK_TYPE_ORDER.filter((t) => seen.has(t));
}

// ── Outlines: unit radius, centred on the origin, y down (SVG). ONE source for 2D and 3D. ──

type Pt = readonly [number, number];

const regular = (n: number, r: number, rot: number): Pt[] =>
    Array.from({ length: n }, (_, i) => [r * Math.cos(rot + (2 * Math.PI * i) / n), r * Math.sin(rot + (2 * Math.PI * i) / n)] as const);

/** A polygon with each corner replaced by a quadratic curve of `r` (sampled, so 2D and 3D share the points). */
function rounded(pts: readonly Pt[], r: number, steps = 4): Pt[] {
    const out: Pt[] = [];
    pts.forEach((p, i) => {
        const a = pts[(i + pts.length - 1) % pts.length]!, b = pts[(i + 1) % pts.length]!;
        const towards = (q: Pt): Pt => { const dx = q[0] - p[0], dy = q[1] - p[1], d = Math.hypot(dx, dy); return [p[0] + (dx / d) * r, p[1] + (dy / d) * r]; };
        const s = towards(a), e = towards(b);
        for (let k = 0; k <= steps; k++) {
            const t = k / steps, u = 1 - t;
            out.push([u * u * s[0] + 2 * u * t * p[0] + t * t * e[0], u * u * s[1] + 2 * u * t * p[1] + t * t * e[1]]);
        }
    });
    return out;
}

const arc = (cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps: number): Pt[] =>
    Array.from({ length: steps + 1 }, (_, i) => { const t = from + ((to - from) * i) / steps; return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as const; });

const star = (outer: number, inner: number): Pt[] =>
    Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? inner : outer, t = -Math.PI / 2 + (Math.PI * i) / 5; return [r * Math.cos(t), r * Math.sin(t)] as const; });

/** Every shape's closed outline. */
export const SHAPE_OUTLINES: Readonly<Record<NodeShape, readonly Pt[]>> = Object.freeze({
    square: [[-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9]],
    circle: regular(32, 1, 0),
    roundedSquare: rounded([[-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9]], 0.35),
    diamond: [[0, -1.2], [1.2, 0], [0, 1.2], [-1.2, 0]],
    tile: [[-0.75, -1], [0.35, -1], [0.75, -0.6], [0.75, 1], [-0.75, 1]],
    triangle: [[0, -1.1], [1, 0.8], [-1, 0.8]],
    roundedTriangle: rounded([[0, -1.15], [1.05, 0.85], [-1.05, 0.85]], 0.4),
    drum: [...arc(0, -0.7, 0.9, 0.32, Math.PI, 2 * Math.PI, 12), ...arc(0, 0.7, 0.9, 0.32, 0, Math.PI, 12)],
    bookmark: [[-0.7, -1], [0.7, -1], [0.7, 1], [0, 0.5], [-0.7, 1]],
    pentagon: regular(5, 1.05, -Math.PI / 2),
    smallStar: star(0.85, 0.36),
    octagon: regular(8, 1.05, Math.PI / 8),
    hexagon: regular(6, 1.05, 0),
});

/** 2D-only detail strokes drawn over a shape in the background colour: the drum's lid, the tile's folded corner. */
const DETAIL: Partial<Record<NodeShape, readonly Pt[]>> = {
    drum: arc(0, -0.7, 0.9, 0.32, 0, Math.PI, 12),
    tile: [[0.35, -1], [0.35, -0.6], [0.75, -0.6]],
};

const n3 = (v: number): string => String(Math.round(v * 1000) / 1000);
const polyline = (pts: readonly Pt[]): string => pts.map((p, i) => `${i ? 'L' : 'M'}${n3(p[0])} ${n3(p[1])}`).join('');

/** `{shape}` path data for a unit-radius mark centred on the origin; the caller translates/scales it to the node. */
export function shapePath(shape: NodeShape): string {
    const detail = DETAIL[shape];
    return `${polyline(SHAPE_OUTLINES[shape])}Z${detail ? ` ${polyline(detail)}` : ''}`;
}

export const NODE_SHAPES: readonly NodeShape[] = Object.keys(SHAPE_OUTLINES) as NodeShape[];

export const SHAPE_PATHS: Readonly<Record<NodeShape, string>> = Object.freeze(
    Object.fromEntries(NODE_SHAPES.map((s) => [s, shapePath(s)])) as Record<NodeShape, string>,
);
