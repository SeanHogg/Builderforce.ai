/**
 * The run delta history as pure data (PRD 41 §C11.3): summaries in time order and the trend's
 * series — the dimension × run verdict matrix and the blast-radius score per run. No React, no
 * clock: the same summaries always give the same model.
 */

import { HEADLINE_ORDER, type DimensionId, type Verdict } from '@builderforce/run-delta/contract';
import type { RunDeltaSummary } from '@builderforce/run-delta';

/** The trend shows at most this many runs, the most recent ones. */
export const TREND_MAX_RUNS = 30;

/** One history row's identity: a run can cover more than one repository. */
export const summaryKey = (s: Pick<RunDeltaSummary, 'runId' | 'repoKey'>): string => `${s.runId}\u0000${s.repoKey}`;

const byTime = (a: RunDeltaSummary, b: RunDeltaSummary): number =>
    a.computedAt.localeCompare(b.computedAt) || a.runId.localeCompare(b.runId) || a.repoKey.localeCompare(b.repoKey);

/** Newest first, one row per run × repository (a re-listed row replaces the earlier copy). */
export function newestFirst(items: readonly RunDeltaSummary[]): RunDeltaSummary[] {
    const unique = new Map(items.map((s) => [summaryKey(s), s] as const));
    return [...unique.values()].sort((a, b) => byTime(b, a));
}

/** The worse of two verdicts by the engine's own headline order (`worse` first). */
const worseOf = (a: Verdict, b: Verdict): Verdict => (HEADLINE_ORDER.indexOf(a) <= HEADLINE_ORDER.indexOf(b) ? a : b);

/**
 * ONE trend column per run: a run that touched several repositories has one summary per repository, and the trend asks
 * how the RUN went — so its column takes the worst verdict per dimension and headline, the largest blast radius (with
 * that score's band), the summed counts and the latest time.
 */
function perRun(items: readonly RunDeltaSummary[]): RunDeltaSummary[] {
    const runs = new Map<string, RunDeltaSummary>();
    for (const s of newestFirst(items)) {
        const seen = runs.get(s.runId);
        if (!seen) { runs.set(s.runId, { ...s, verdicts: { ...s.verdicts } }); continue; }
        const verdicts = { ...seen.verdicts };
        for (const [d, v] of Object.entries(s.verdicts) as Array<[DimensionId, Verdict]>) verdicts[d] = verdicts[d] ? worseOf(verdicts[d]!, v) : v;
        runs.set(s.runId, {
            ...seen,
            verdicts,
            headline: worseOf(seen.headline, s.headline),
            counts: { introduced: seen.counts.introduced + s.counts.introduced, resolved: seen.counts.resolved + s.counts.resolved },
            blastRadius: s.blastRadius.score > seen.blastRadius.score ? s.blastRadius : seen.blastRadius,
            blocking: [...new Set([...seen.blocking, ...s.blocking])].sort(),
        });
    }
    // Insertion order is newest first (by each run's latest repository), which is the order the trend slices from.
    return [...runs.values()];
}

export interface DeltaTrendModel {
    /** Oldest first, one per run (repositories merged), at most {@link TREND_MAX_RUNS}. */
    runs: RunDeltaSummary[];
    /** Every dimension any run reports, sorted by id — the order the contract sorts `RunDelta.dimensions` in. */
    dimensions: DimensionId[];
    /** `cells[d][r]`: dimension `d`'s verdict in run `r`, or null when that run does not report it. */
    cells: Array<Array<Verdict | null>>;
    counts: { worse: number; better: number };
    blast: { min: number; max: number; latest: RunDeltaSummary | undefined };
}

export function trendModel(items: readonly RunDeltaSummary[], maxRuns: number = TREND_MAX_RUNS): DeltaTrendModel {
    const runs = perRun(items).slice(0, Math.max(0, maxRuns)).reverse();
    const dimensions = [...new Set(runs.flatMap((r) => Object.keys(r.verdicts) as DimensionId[]))].sort();
    const cells = dimensions.map((d) => runs.map((r) => r.verdicts[d] ?? null));
    const scores = runs.map((r) => r.blastRadius.score);
    return {
        runs,
        dimensions,
        cells,
        counts: { worse: runs.filter((r) => r.headline === 'worse').length, better: runs.filter((r) => r.headline === 'better').length },
        blast: { min: scores.length ? Math.min(...scores) : 0, max: scores.length ? Math.max(...scores) : 0, latest: runs[runs.length - 1] },
    };
}
