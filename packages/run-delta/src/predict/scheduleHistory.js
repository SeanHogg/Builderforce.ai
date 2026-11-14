/**
 * predict/scheduleHistory.ts — what the D9.1 scheduler learns from: per run, each dynamic check's OUTCOME (did it
 * run, was it decisive for a verdict), folded into Beta counts per check and per (check × the run's cell) of one
 * repository, plus the §10 counts of the scheduler against random scheduling.
 *
 * The CELL of a run is ONE key: the sorted set of dimensions it touched (`performance+quality`), or `-` for none.
 * Each observation counts once in its check and once in its cell.
 *
 * "Changed a verdict" is measured, never predicted, and credited only when the check was DECISIVE (`credit.ts`,
 * leave-one-out). A `failed` or `skipped` check is no observation (`changedVerdict: null`).
 *
 * Pure: the host stores the outcomes (device-only rows) and hands them back as data.
 */
import { decisiveDimensions } from './credit.js';
/** The scheduler's own policy names in `scheduledBy.policy`. */
export const THOMPSON_POLICY = 'thompson';
export const EXPLORE_POLICY = 'thompson-explore';
/** The tier's outcomes: one per result, in result order. */
export function dynamicCheckOutcomes(ctx, results, finalDelta) {
    const touched = [...new Set(ctx.dimensionsTouched)].sort();
    return results.map((r) => ({
        check: r.check, dimensionsTouched: touched, policy: r.scheduledBy.policy, status: r.status,
        ...(r.status === 'skipped' && r.reason ? { reason: r.reason } : {}),
        ...(typeof r.scheduledBy.wouldRun === 'boolean' ? { wouldRun: r.scheduledBy.wouldRun } : {}),
        changedVerdict: r.status === 'ok' ? decisiveDimensions(r, finalDelta, results).length > 0 : null,
    }));
}
/** A run's ONE cell: its sorted, deduplicated dimensions touched, `+`-joined; `-` when it touched none. */
export const contextCell = (dimensionsTouched) => dimensionsTouched.length > 0 ? [...new Set(dimensionsTouched)].sort().join('+') : '-';
/** The dimensions of a cell ({@link contextCell}'s inverse; none for `-`). */
export const cellDimensions = (cell) => (cell === '-' ? [] : cell.split('+'));
export const scheduleCellKey = (check, cell) => `${check}|${cell}`;
/** The counts of a repository's outcomes: each observation once in its check and once in its run's cell. */
export function scheduleHistoryOf(outcomes) {
    const checks = {};
    const cells = {};
    const add = (c, hit) => { c.n += 1; if (hit)
        c.k += 1; };
    for (const o of outcomes) {
        if (o.changedVerdict === null)
            continue;
        add(checks[o.check] ??= { n: 0, k: 0 }, o.changedVerdict);
        add(cells[scheduleCellKey(o.check, contextCell(o.dimensionsTouched))] ??= { n: 0, k: 0 }, o.changedVerdict);
    }
    return { checks, cells };
}
export function scheduleTelemetry(outcomes) {
    const t = {
        scheduled: 0, scheduledChanged: 0, explored: 0, exploredChanged: 0, exploredWouldRun: 0, exploredChangedWouldRun: 0, failed: 0, notScheduled: 0, budgetSkipped: 0,
    };
    for (const o of outcomes) {
        const sampled = o.policy === THOMPSON_POLICY || o.policy === EXPLORE_POLICY;
        if (!sampled)
            continue;
        if (o.status === 'skipped') {
            if (o.reason === 'not-scheduled')
                t.notScheduled++;
            else if (o.reason === 'budget-exhausted')
                t.budgetSkipped++;
        }
        else if (o.status === 'failed') {
            t.failed++;
        }
        else if (o.policy === THOMPSON_POLICY) {
            t.scheduled++;
            if (o.changedVerdict)
                t.scheduledChanged++;
        }
        else {
            t.explored++;
            if (o.changedVerdict)
                t.exploredChanged++;
            if (o.wouldRun) {
                t.exploredWouldRun++;
                if (o.changedVerdict)
                    t.exploredChangedWouldRun++;
            }
        }
    }
    return t;
}
//# sourceMappingURL=scheduleHistory.js.map