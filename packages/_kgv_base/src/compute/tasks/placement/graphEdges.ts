/**
 * The Graph camera's edges per LOD band (PRD 43 B4) as ONE `edge` link batch: the 2D graph's drawn set (the ONE ranking,
 * `pickEdges` for no selection — the selection's incident edges are the overlay's, rule 6) split by `bundleEdges` into
 * singles and station-to-station bundles, packed by the ONE `polylineBatch`.
 *
 *   - A single is a straight segment between its two nodes, styled as the 2D graph strokes it: a loud edge (violation,
 *     cycle) 1.6 px at full tone, the rest 1 px dimmed toward the background (the 2D graph's 0.5 opacity).
 *   - A bundle is a shallow arc between its two aggregates' hubs (a station's hub is the centroid of its shown members —
 *     where the hidden station slot itself sits), sampled into {@link BUNDLE_SEGMENTS} segments, its width growing with
 *     the log of its member count; `aggregate` carries the count per segment.
 *
 * The band's budget never exceeds the `edge` family's preallocated capacity, so a camera switch never overflows into a
 * mesh rebuild. Pure.
 */

import type { KEdge } from '@seanhogg/builderforce-memory/knowledge';
import { edgeBucket, isLoudEdge } from '../../../scene/buffers';
import { LINK_FAMILY_STYLE } from '../../../stage/links/families';
import { toneIndex } from '../../../stage/tones';
import { DASH_SOLID, FLAG, type LinkBatch, type Vec3 } from '../../../stage/types';
import type { BundleBudget, BundledEdges } from '../bundle';
import { polylineBatch, type WorldPath } from './links';

/** Segments per bundle arc. */
export const BUNDLE_SEGMENTS = 4;
/** An arc bows sideways by this fraction of its chord, so A–B and A–C bundles leaving one hub fan apart. */
const BOW = 0.12;
const LOUD_WIDTH = 1.6;
const MAX_BUNDLE_WIDTH = 5;

/** What one Graph LOD band shows: nodes (the focus cap), single edges and bundles. */
export interface GraphLodBand extends BundleBudget { shown: number }

/**
 * The bands, as DATA, indexed by `req.lod`: band 0 is the overview at today's 2,000-node cap (P1a: the marks budget),
 * band 1 shows every node with twice the singles. Both keep `singles + bundles × BUNDLE_SEGMENTS` within the `edge`
 * family's capacity (8,192 segments).
 */
export const GRAPH_LOD: readonly GraphLodBand[] = [
    { shown: 2000, singles: 2000, bundles: 1024 },
    { shown: Number.POSITIVE_INFINITY, singles: 4000, bundles: 1024 },
];

export const graphLodOf = (lod: number): GraphLodBand => GRAPH_LOD[Math.max(0, Math.min(GRAPH_LOD.length - 1, Math.floor(lod)))]!;

/** Segments a band can draw at most: the family's capacity must hold it. */
export const segmentsOf = (b: BundleBudget): number => b.singles + b.bundles * BUNDLE_SEGMENTS;

/** A shallow quadratic arc from `a` to `b` on the ground (y = 0), sampled. */
export function bundleArc(a: readonly [number, number], b: readonly [number, number]): Vec3[] {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const cx = (a[0] + b[0]) / 2 - dz * BOW, cz = (a[1] + b[1]) / 2 + dx * BOW;
    const out: Vec3[] = [];
    for (let i = 0; i <= BUNDLE_SEGMENTS; i++) {
        const t = i / BUNDLE_SEGMENTS, u = 1 - t;
        out.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], 0, u * u * a[1] + 2 * u * t * cz + t * t * b[1]]);
    }
    return out;
}

export const bundleWidth = (count: number): number => Math.min(MAX_BUNDLE_WIDTH, 1 + Math.log2(Math.max(1, count)));

/**
 * The batch: singles first (in ranking order), then the bundles by count. `at` is a node's ground point (x, z); `hub`
 * an aggregate's. A polyline whose end has no point is skipped.
 */
export function graphEdgeLinks(
    bundled: BundledEdges, at: (ref: string) => readonly [number, number] | undefined, hub: (aggregate: number) => readonly [number, number] | undefined,
): LinkBatch {
    const style = LINK_FAMILY_STYLE.edge;
    const paths: WorldPath[] = [], counts: number[] = [];
    const single = (e: KEdge): void => {
        const a = at(e.from), b = at(e.to);
        if (!a || !b) return;
        const loud = isLoudEdge(e);
        paths.push({ pts: [[a[0], 0, a[1]], [b[0], 0, b[1]]], tone: toneIndex(edgeBucket(e).tone), width: loud ? LOUD_WIDTH : style.width, dash: DASH_SOLID, flags: loud ? 0 : FLAG.DIM });
        counts.push(1);
    };
    for (const e of bundled.singles) single(e);
    for (const k of bundled.bundles) {
        const a = hub(k.a), b = hub(k.b);
        if (!a || !b) continue;
        const loud = k.bucket === 'violation' || k.bucket === 'cycle';
        paths.push({ pts: bundleArc(a, b), tone: toneIndex(k.tone), width: bundleWidth(k.count), dash: DASH_SOLID, flags: loud ? 0 : FLAG.DIM });
        counts.push(k.count);
    }
    const batch = polylineBatch('edge', paths, style.widthUnit);
    batch.aggregate = Uint32Array.from(batch.group, (g) => counts[g]!);
    return batch;
}
