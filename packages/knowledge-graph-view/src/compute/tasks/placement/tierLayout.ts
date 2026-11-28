/**
 * The level scene's layout (the design's `layMap` system view): children stand in rows by tier on ONE floor, centred, in
 * design units about the floor's middle. Two to four children share one row; more go to the three tier rows (entry and
 * presentation in front, application and domain in the middle, infrastructure, data and the rest behind); past
 * {@link ROW_MAX} in a row the level reads as a grid instead. Children keep the order given (the caller ranks them). Pure.
 */

import { FLOOR, ROW_MAX, SINGLE_ROW_MAX, TIER_Z, type Tier } from './levelGeometry';

/** What the layout needs of a child: its tier and its footprint (design units, before the row clips it). */
export interface TierItem { tier: Tier; w: number; d: number }
/** A child's centre and footprint, design units. */
export interface Spot { x: number; z: number; w: number; d: number }

/** The layer a station or file is in → the row it stands in. */
export function tierOf(layer: string | undefined): Tier {
    return layer === 'entry' || layer === 'presentation' ? 'front' : layer === 'application' || layer === 'domain' ? 'mid' : 'back';
}

const SPAN_X = 15.5, SPAN_Z = 11.2;

function row(items: readonly TierItem[], at: number[], z: number, maxGap: number, out: Spot[]): void {
    const gap = Math.min(maxGap, SPAN_X / at.length);
    at.forEach((index, k) => {
        const it = items[index]!;
        out[index] = { x: (k - (at.length - 1) / 2) * gap, z, w: Math.min(it.w, gap - 0.4), d: it.d };
    });
}

function grid(items: readonly TierItem[]): Spot[] {
    const cols = Math.ceil(Math.sqrt(items.length * (SPAN_X / SPAN_Z)));
    const rows = Math.ceil(items.length / cols), cellX = SPAN_X / cols, cellZ = SPAN_Z / rows;
    return items.map((it, i) => ({
        x: ((i % cols) - (cols - 1) / 2) * cellX, z: (Math.floor(i / cols) - (rows - 1) / 2) * cellZ,
        w: Math.min(it.w, cellX - 0.4), d: Math.min(it.d, cellZ - 0.3),
    }));
}

/** One spot per item, in the items' order. */
export function layTiers(items: readonly TierItem[]): Spot[] {
    const n = items.length;
    if (n === 0) return [];
    const out = new Array<Spot>(n);
    if (n <= SINGLE_ROW_MAX) { row(items, items.map((_, i) => i), 0, 6, out); return out; }
    const by: Record<Tier, number[]> = { front: [], mid: [], back: [] };
    items.forEach((it, i) => by[it.tier].push(i));
    if (Math.max(by.front.length, by.mid.length, by.back.length) > ROW_MAX) return grid(items);
    for (const tier of Object.keys(by) as Tier[]) row(items, by[tier], TIER_Z[tier], 3.4, out);
    return out;
}

/** The floor's centre in world units' own frame is the origin of {@link Spot}; the placement shifts it by half the floor. */
export const FLOOR_CENTRE = { x: FLOOR.w / 2, z: FLOOR.d / 2 } as const;
