/**
 * engine/blastRadius.ts — the C10 blast radius, `formula: 'v1'` (file-level until WS4 gives symbol
 * call facts):
 *
 *     score = Σ over changed files f:  centrality(f) × (1 + log2(1 + churn90d(f)))
 *             + 2 × |entry points reaching a changed file|
 *
 * `centrality` is memory's deterministic `pageRank` (power iteration over sorted nodes with a FIXED
 * iteration cap — no early exit, so no tolerance can differ between machines; damping 0.85,
 * {@link BLAST_RADIUS_ITERATIONS} iterations, normalized so the top node is 1) over the union of both
 * sides' file import graphs. The score is rounded to {@link BLAST_RADIUS_STEP}.
 *
 * Bands come from the repo's own past scores: `low` below p50, `medium` up to p90, `high` above p90
 * (nearest-rank percentiles). With fewer than {@link MIN_PAST_SCORES} past scores the band is `low`
 * and the reason `insufficient-history` is recorded.
 */

import { pageRank, srcRef } from '@seanhogg/builderforce-memory/knowledge';
import { BLAST_RADIUS_STEP, type RunDelta, type SideFacts } from '../contract.js';
import { compareStr } from './text.js';

export const BLAST_RADIUS_DAMPING = 0.85;
export const BLAST_RADIUS_ITERATIONS = 50;
export const MIN_PAST_SCORES = 5;
export const ENTRY_POINT_WEIGHT = 2;

/** A synthetic root id: the graph is only ranked here, never stored. */
const GRAPH_ROOT = 'delta';

/** File → centrality (top node = 1) over the union of the sides' import graphs. */
export function fileCentrality(...sides: readonly SideFacts[]): Map<string, number> {
    const nodes = new Set<string>();
    const edges = new Map<string, { from: string; to: string }>();
    for (const side of sides) {
        for (const [from, targets] of side.imports) {
            nodes.add(from);
            for (const to of targets) {
                nodes.add(to);
                edges.set(`${from}\u0000${to}`, { from, to });
            }
        }
    }
    const ranked = pageRank(
        [...nodes].map((p) => srcRef(GRAPH_ROOT, p)),
        [...edges.values()].map((e) => ({ from: srcRef(GRAPH_ROOT, e.from), to: srcRef(GRAPH_ROOT, e.to), weight: 1 })),
        BLAST_RADIUS_ITERATIONS,
        BLAST_RADIUS_DAMPING,
    );
    return new Map([...nodes].map((p) => [p, ranked.get(srcRef(GRAPH_ROOT, p)) ?? 0]));
}

const quantize = (n: number): number => Math.round(n / BLAST_RADIUS_STEP) * BLAST_RADIUS_STEP;
const round = (n: number): number => Number(quantize(n).toFixed(3));

/** Nearest-rank percentile of an ascending list. */
function percentile(sorted: readonly number[], p: number): number {
    return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

export function blastRadius(input: {
    changedFiles: readonly string[];
    entryPoints: readonly string[];
    before: SideFacts;
    after: SideFacts;
    churn: ReadonlyMap<string, number>;
    pastScores: readonly number[];
}): RunDelta['blastRadius'] {
    const centrality = fileCentrality(input.before, input.after);
    let sum = 0;
    for (const f of [...input.changedFiles].sort(compareStr)) {
        const churn = Math.max(0, input.churn.get(f) ?? 0);
        sum += (centrality.get(f) ?? 0) * (1 + Math.log2(1 + churn));
    }
    const score = round(sum + ENTRY_POINT_WEIGHT * new Set(input.entryPoints).size);

    const past = input.pastScores.filter((s) => Number.isFinite(s)).sort((a, b) => a - b);
    if (past.length < MIN_PAST_SCORES) return { score, band: 'low', formula: 'v1', reasons: ['insufficient-history'] };
    const band = score < percentile(past, 0.5) ? 'low' : score <= percentile(past, 0.9) ? 'medium' : 'high';
    return { score, band, formula: 'v1', reasons: [] };
}
