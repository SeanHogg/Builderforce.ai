/**
 * A link batch packed into per-segment instance attributes — the ONE packing the line shader (`LinkLayer`) and the halls
 * (`HallLayer`) share: `a` (xyz, run length at A), `b` (xyz, width), `style` (tone, dash, flags, group), one row per segment
 * between two consecutive non-break points.
 */

import type { LinkBatch } from '../types';

/** Segments of a batch: consecutive non-break points. */
export function segmentsOf(batch: LinkBatch): number {
    let n = 0;
    const p = batch.points;
    for (let i = 1; i < p.length / 3; i++) if (!Number.isNaN(p[i * 3]!) && !Number.isNaN(p[(i - 1) * 3]!)) n++;
    return n;
}

/** Writes `batch`'s segments into the arrays from segment row `at`; returns how many it wrote. */
export function fillSegments(batch: LinkBatch, a: Float32Array, b: Float32Array, st: Float32Array, at = 0): number {
    const p = batch.points, run = batch.runLength;
    let s = 0;
    for (let i = 1; i < p.length / 3; i++) {
        if (Number.isNaN(p[i * 3]!) || Number.isNaN(p[(i - 1) * 3]!)) continue;
        const r = at + s;
        a[r * 4] = p[(i - 1) * 3]!; a[r * 4 + 1] = p[(i - 1) * 3 + 1]!; a[r * 4 + 2] = p[(i - 1) * 3 + 2]!; a[r * 4 + 3] = run[i - 1]!;
        b[r * 4] = p[i * 3]!; b[r * 4 + 1] = p[i * 3 + 1]!; b[r * 4 + 2] = p[i * 3 + 2]!; b[r * 4 + 3] = batch.width[s]!;
        st[r * 4] = batch.tone[s]!; st[r * 4 + 1] = batch.dash[s]!; st[r * 4 + 2] = batch.flags[s]!; st[r * 4 + 3] = batch.group[s]!;
        s++;
    }
    return s;
}
