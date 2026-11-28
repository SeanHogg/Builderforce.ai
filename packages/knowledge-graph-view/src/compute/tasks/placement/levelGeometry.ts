/**
 * The level scene's geometry, in the design's own units (`code-visualizer-next` `FOOT`, `KINDMESH`, `HEIGHT`, `layMap`,
 * `floorLinks`, `FLOOR`): the mockup works in units on a 17.6 × 13.6 floor, the stage in world units, {@link U} per unit.
 * Footprints are rectangles (width × depth), heights are low, a level has ONE floor and its links are raised bars on it.
 * Data and tiny pure helpers only: the placement (`level.ts`) and the roof miniatures (`roofMinis.ts`) read them. Worker-safe.
 */

import type { MarkType } from '../../../shapes';

/** World units per design unit. */
export const U = 40;

/** What a shape is drawn as: the design's node kinds (a level's footprint and height come from it). */
export type LevelKind = 'system' | 'component' | 'store' | 'file' | 'class' | 'iface' | 'method' | 'table';

/** Footprint [width, depth] per kind, design units. */
export const FOOT: Readonly<Record<LevelKind, readonly [number, number]>> = {
    system: [2.4, 1.6], component: [2.5, 1.7], store: [1.6, 1.6], file: [2.0, 1.4], class: [2.1, 1.5], iface: [2.0, 1.3], method: [1.7, 1.7], table: [1.8, 1.8],
};

/** Kinds standing on the circle (a drum, a puck): their depth follows their width. */
export const ROUND_KINDS: ReadonlySet<LevelKind> = new Set<LevelKind>(['store', 'table', 'method']);

const FIXED_HEIGHT: Readonly<Partial<Record<LevelKind, number>>> = { component: 0.45, system: 0.45, store: 1.0, table: 0.7 };

/** The complexity badge, clamped to the design's 1..3. */
export const complexityOf = (cx: number | undefined): number => Math.min(3, Math.max(1, cx ?? 1));

/** A shape's height, design units: a fixed plate or tub, else it grows with its complexity (a method less than a file). */
export function heightOf(kind: LevelKind, cx: number | undefined): number {
    const fixed = FIXED_HEIGHT[kind];
    if (fixed !== undefined) return fixed;
    return kind === 'method' ? 0.35 + complexityOf(cx) * 0.22 : 0.45 + complexityOf(cx) * 0.36;
}

/** A child's footprint grows with the files it holds: 0.8 for none to 1.2 for the biggest sibling. */
export const footprintScale = (files: number, maxFiles: number): number => 0.8 + 0.4 * Math.sqrt(Math.max(0, files) / Math.max(1, maxFiles));

/** Which shape a child is, by what it is (a system, an app, a station, a graph node) and its mark type. */
export function kindOfChild(role: 'system' | 'app' | 'station' | 'node', type: MarkType): LevelKind {
    if (role === 'system') return 'system';
    if (role === 'app') return 'component';
    if (role === 'station') return type === 'data' ? 'store' : 'component';
    return type === 'interface' ? 'iface' : type === 'class' ? 'class' : type === 'function' ? 'method' : type === 'data' ? 'table' : 'file';
}

/** The floor: ONE slab per level, its top at y = 0. */
export const FLOOR = { w: 17.6, d: 13.6, thick: 0.3 } as const;

/** The three rows by tier (design z): entry and presentation in front, application and domain in the middle, the rest behind. */
export const TIER_Z = { front: -3.9, mid: 0, back: 3.9 } as const;
export type Tier = keyof typeof TIER_Z;

/** The most children a level draws; the rest are counted (the caption says shown of total). */
export const MAX_CHILDREN = 24;
/** Up to this many children share a single centred row; more are laid out in tier rows (or a grid past {@link ROW_MAX}). */
export const SINGLE_ROW_MAX = 4;
export const ROW_MAX = 8;

/** A floor link: a raised bar between two children. `y` is where its underside sits (the hall layer stands the bar ON the point's y, 0.24 x width thick: centre ~ the design's 0.1). */
export const LINK = { y: 0.06, thick: 0.08, width: 0.34 } as const;

/** Roof miniatures: at most this many per roof, 0.22 tall, their layout scaled by `1.25 × w / 17` by `1.25 × d / 13`. */
export const MINIS_MAX = 12;
export const MINI = { height: 0.22, share: 1.25, refW: 17, refD: 13 } as const;

/** The square outline spans ±0.9 about a mark's centre: a footprint of width w world units is drawn with scale w / 1.8. */
export const OUTLINE_SPAN = 1.8;
