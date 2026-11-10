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
    | 'section' | 'entity' | 'claim' | 'external' | 'unit' | 'system';

/** The type of a node no rule claims (an unknown kind, an asset, generated output). */
export const FALLBACK_TYPE: MarkType = 'external';

/** Legend order: code first, then documents and knowledge, the outside and the aggregates last. */
export const MARK_TYPE_ORDER: readonly MarkType[] = [
    'class', 'function', 'source', 'test', 'style', 'config', 'data', 'doc', 'section', 'entity', 'claim', 'external', 'unit', 'system',
];

/** A silhouette. Each has ONE outline: drawn flat in 2D, extruded in 3D. */
export type NodeShape =
    | 'square' | 'circle' | 'window' | 'diamond' | 'tile' | 'triangle' | 'funnel'
    | 'drum' | 'banner' | 'pentagon' | 'smallStar' | 'cross' | 'capsule' | 'hexagon';

/**
 * type → shape: no two types share a silhouette, and every pair stays apart at 8 px (DPR 1) — XOR / union of the
 * thresholded silhouettes ≥ 0.15 (`shapes.distinct.test.ts`; PRD 43 P1a revision 2 replaced the rounded square, the
 * rounded triangle, the bookmark and the octagon, which merged with their sharp twins at ≤ 12 px). Size and aspect
 * carry the difference as much as the corners do:
 *   class    — a full square (a type is a solid block);
 *   function — a small circle (a member, smaller than the class that holds it);
 *   source   — a landscape window, 2.5 × 1.36 with a title bar (an editor pane);
 *   test     — a diamond touching the extent (a check mark's rhombus);
 *   doc      — a tall portrait page with a folded corner;
 *   config   — a triangle pointing up (a setting / a lever);
 *   style    — a triangle pointing down (the cascade);
 *   data     — a narrow, tall drum with a lid (a database cylinder);
 *   section  — a wide banner with notched ends (a heading);
 *   entity   — a pentagon (a thing with a name);
 *   claim    — a five-point star (an assertion);
 *   external — a dashed cross (outside the folder / not here);
 *   unit     — a wide, low capsule (a deployable unit: a container, a worker, a function — what ships);
 *   system   — a flat-topped hexagon at the full extent (the aggregate).
 */
export const TYPE_SHAPE: Readonly<Record<MarkType, NodeShape>> = Object.freeze({
    class: 'square', function: 'circle', source: 'window', test: 'diamond', doc: 'tile', config: 'triangle',
    style: 'funnel', data: 'drum', section: 'banner', entity: 'pentagon', claim: 'smallStar',
    external: 'cross', unit: 'capsule', system: 'hexagon',
});

/** A deployable unit is an `entity` node with this `type` badge (`deployFacts.ts` `DEPLOY_UNIT_TYPE`, the pack's word). */
const DEPLOY_UNIT = 'deployable-unit';

/** Shapes drawn with a dashed outline (the outside: a missing or external target). */
export const DASHED_SHAPES: ReadonlySet<NodeShape> = new Set<NodeShape>(['cross']);

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
        case 'entity': return n.badges?.['type'] === DEPLOY_UNIT ? 'unit' : 'entity';
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

/**
 * Every outline stays inside ±SHAPE_EXTENT on each axis: the stage's cap quad (`stage/marks/shader.ts`), the legend's
 * viewBox and the 2D cull pad are sized from it.
 */
export const SHAPE_EXTENT = 1.25;

const regular = (n: number, r: number, rot: number): Pt[] =>
    Array.from({ length: n }, (_, i) => [r * Math.cos(rot + (2 * Math.PI * i) / n), r * Math.sin(rot + (2 * Math.PI * i) / n)] as const);

const arc = (cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps: number): Pt[] =>
    Array.from({ length: steps + 1 }, (_, i) => { const t = from + ((to - from) * i) / steps; return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as const; });

const star = (outer: number, inner: number): Pt[] =>
    Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? inner : outer, t = -Math.PI / 2 + (Math.PI * i) / 5; return [r * Math.cos(t), r * Math.sin(t)] as const; });

const rect = (hw: number, hh: number): Pt[] => [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];

/** An ✕: four arms of half-width `half` reaching `reach` along the diagonals (clockwise, y down). */
function cross(reach: number, half: number): Pt[] {
    const out: Pt[] = [];
    for (let k = 0; k < 4; k++) {
        const t = Math.PI / 4 + (k * Math.PI) / 2, c = Math.cos(t), s = Math.sin(t);
        out.push([c * reach + s * half, s * reach - c * half], [c * reach - s * half, s * reach + c * half]);
        const inner = t + Math.PI / 4, d = half * Math.SQRT2;
        out.push([Math.cos(inner) * d, Math.sin(inner) * d]);
    }
    return out;
}

/** Every shape's closed outline (≤ `MAX_OUTLINE` points each: the stage's cap SDF reads them as a uniform). */
export const SHAPE_OUTLINES: Readonly<Record<NodeShape, readonly Pt[]>> = Object.freeze({
    square: rect(0.9, 0.9),
    circle: regular(32, 0.7, 0),
    window: rect(1.25, 0.68),
    diamond: [[0, -1.25], [1.25, 0], [0, 1.25], [-1.25, 0]],
    tile: [[-0.8, -1.25], [0.25, -1.25], [0.8, -0.7], [0.8, 1.25], [-0.8, 1.25]],
    triangle: [[0, -1.2], [1.2, 0.85], [-1.2, 0.85]],
    funnel: [[-1.2, -0.85], [1.2, -0.85], [0, 1.2]],
    drum: [...arc(0, -0.95, 0.55, 0.3, Math.PI, 2 * Math.PI, 12), ...arc(0, 0.95, 0.55, 0.3, 0, Math.PI, 12)],
    banner: [[-1.25, -0.55], [1.25, -0.55], [0.6, 0], [1.25, 0.55], [-1.25, 0.55], [-0.6, 0]],
    pentagon: regular(5, 1.1, -Math.PI / 2),
    smallStar: star(1, 0.42),
    cross: cross(1.25, 0.32),
    capsule: [...arc(0.8, 0, 0.45, 0.45, -Math.PI / 2, Math.PI / 2, 8), ...arc(-0.8, 0, 0.45, 0.45, Math.PI / 2, (3 * Math.PI) / 2, 8)],
    hexagon: regular(6, 1.25, 0),
});

/** 2D-only detail strokes drawn over a shape in the background colour: the drum's lid, the page's fold, the window's title bar. */
const DETAIL: Partial<Record<NodeShape, readonly Pt[]>> = {
    drum: arc(0, -0.95, 0.55, 0.3, 0, Math.PI, 12),
    tile: [[0.25, -1.25], [0.25, -0.7], [0.8, -0.7]],
    window: [[-1.25, -0.3], [1.25, -0.3]],
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
