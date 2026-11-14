/**
 * The route report's arithmetic — what the router did over a window of runs, and
 * whether its threshold should move. Pure: a host folds its own ledger into
 * {@link RouteRunRecord}s (one per run) and renders the {@link RouteReport}.
 *
 * MISROUTE PROXY. Nothing labels a quick run "should have been full", so the report
 * uses what the person did next: a quick run followed, in the same conversation and
 * within {@link RERUN_WINDOW_MS}, by a FULL run (they asked again, often with "full
 * pipeline"), or a quick run the host recorded as failed. Both say the quick pass did
 * not finish the job.
 */
import { DEFAULT_ROUTE_THRESHOLD } from './score.js';
/** A quick run re-asked as full within this long counts as misrouted. */
export const RERUN_WINDOW_MS = 30 * 60_000;
/** Fewer quick runs than this and the report does not suggest a threshold. */
export const MIN_QUICK_RUNS_FOR_SUGGESTION = 10;
/** Misroute share above which the threshold should come down … */
export const MISROUTE_HIGH = 0.15;
/** … and below which quick can take more. */
export const MISROUTE_LOW = 0.05;
const HISTOGRAM_BINS = 10;
const STEP = 0.05;
const floorStep = (n) => Math.floor(n / STEP + 1e-9) * STEP;
const round2 = (n) => Math.round(n * 100) / 100;
/** Which quick runs the proxy calls misrouted, by index into `runs`. */
export function misroutedRuns(runs, windowMs = RERUN_WINDOW_MS) {
    const out = new Set();
    const byConversation = new Map();
    runs.forEach((r, i) => {
        const list = byConversation.get(r.conversation) ?? [];
        list.push(i);
        byConversation.set(r.conversation, list);
    });
    for (const indexes of byConversation.values()) {
        indexes.sort((a, b) => runs[a].startedAt.localeCompare(runs[b].startedAt));
        indexes.forEach((i, k) => {
            const run = runs[i];
            if (run.route !== 'quick')
                return;
            if (run.failed) {
                out.add(i);
                return;
            }
            const next = indexes[k + 1] !== undefined ? runs[indexes[k + 1]] : undefined;
            if (next?.route === 'full' && Date.parse(next.startedAt) - Date.parse(run.startedAt) <= windowMs)
                out.add(i);
        });
    }
    return out;
}
function totals(runs) {
    const scored = runs.filter((r) => typeof r.score === 'number');
    const priced = runs.filter((r) => typeof r.costMc === 'number' && Number.isFinite(r.costMc));
    const unpricedRuns = runs.length - priced.length;
    return {
        runs: runs.length,
        costMc: priced.reduce((sum, r) => sum + r.costMc, 0),
        ...(unpricedRuns > 0 ? { unpricedRuns } : {}),
        avgScore: scored.length ? round2(scored.reduce((s, r) => s + r.score, 0) / scored.length) : null,
    };
}
function histogramOf(runs) {
    const bins = Array.from({ length: HISTOGRAM_BINS }, (_, i) => ({
        from: round2(i / HISTOGRAM_BINS),
        to: round2((i + 1) / HISTOGRAM_BINS),
        full: 0,
        quick: 0,
    }));
    for (const r of runs) {
        if (typeof r.score !== 'number' || !Number.isFinite(r.score))
            continue;
        const i = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor(r.score * HISTOGRAM_BINS)));
        bins[i][r.route] += 1;
    }
    return bins;
}
/**
 * Where the threshold should go. Too many misroutes: down to the lower quartile of the
 * misrouted runs' scores, so most of them would have gone full. Almost none: up one
 * step, so quick takes a little more. Otherwise, or on too little evidence, keep it.
 */
export function suggestThreshold(runs, threshold, misrouted = misroutedRuns(runs)) {
    const quick = runs.filter((r) => r.route === 'quick').length;
    if (quick < MIN_QUICK_RUNS_FOR_SUGGESTION)
        return { suggestedThreshold: null };
    const rate = misrouted.size / quick;
    if (rate > MISROUTE_HIGH) {
        const scores = [...misrouted].map((i) => runs[i].score).filter((s) => typeof s === 'number').sort((a, b) => a - b);
        const quartile = scores.length ? scores[Math.floor((scores.length - 1) / 4)] : threshold - STEP;
        const next = round2(Math.max(STEP * 2, Math.min(threshold - STEP, floorStep(quartile))));
        return { suggestedThreshold: next };
    }
    if (rate < MISROUTE_LOW && runs.some((r) => r.route === 'full')) {
        const next = round2(Math.min(0.9, threshold + STEP));
        // Already at the ceiling: keep it.
        return { suggestedThreshold: next > threshold ? next : null };
    }
    // Inside the MISROUTE_LOW–MISROUTE_HIGH band: keep it.
    return { suggestedThreshold: null };
}
/** The whole report over `runs` at the current `threshold`. */
export function summarizeRouteRuns(runs, opts = {}) {
    const threshold = opts.threshold ?? DEFAULT_ROUTE_THRESHOLD;
    const misrouted = misroutedRuns(runs, opts.rerunWindowMs);
    const quick = runs.filter((r) => r.route === 'quick');
    return {
        runs: runs.length,
        byRoute: { full: totals(runs.filter((r) => r.route === 'full')), quick: totals(quick) },
        histogram: histogramOf(runs),
        misroutes: misrouted.size,
        misrouteRate: quick.length ? round2(misrouted.size / quick.length) : null,
        threshold,
        ...suggestThreshold(runs, threshold, misrouted),
    };
}
//# sourceMappingURL=report.js.map