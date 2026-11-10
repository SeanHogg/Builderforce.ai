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

import type { DimensionId, RunDelta } from '../contract.js';
import type { DynamicCheckContext, DynamicCheckId, DynamicCheckResult } from '../dynamic/contract.js';
import { decisiveDimensions } from './credit.js';

/** The scheduler's own policy names in `scheduledBy.policy`. */
export const THOMPSON_POLICY = 'thompson';
export const EXPLORE_POLICY = 'thompson-explore';

/** One check's outcome on one run. Codes and booleans only. */
export interface DynamicCheckOutcome {
    check: DynamicCheckId;
    /** The run's dimensions touched at decision time (`DynamicCheckContext.dimensionsTouched`), sorted. */
    dimensionsTouched: DimensionId[];
    /** Who decided (`scheduledBy.policy`: `mandated`, `opt-in`, `thompson`, `thompson-explore`, …). */
    policy: string;
    status: DynamicCheckResult['status'];
    /** Why it did not run (a skip reason code), when skipped. */
    reason?: string;
    /** On a `thompson-explore` decision: what the sampler alone would have decided (§10 recall against random). */
    wouldRun?: boolean;
    /** `ok` only: whether it was decisive for a dimension's verdict. Else null. */
    changedVerdict: boolean | null;
}

/** The tier's outcomes: one per result, in result order. */
export function dynamicCheckOutcomes(
    ctx: Pick<DynamicCheckContext, 'dimensionsTouched'>, results: readonly DynamicCheckResult[], finalDelta: RunDelta,
): DynamicCheckOutcome[] {
    const touched = [...new Set(ctx.dimensionsTouched)].sort();
    return results.map((r) => ({
        check: r.check, dimensionsTouched: touched, policy: r.scheduledBy.policy, status: r.status,
        ...(r.status === 'skipped' && r.reason ? { reason: r.reason } : {}),
        ...(typeof r.scheduledBy.wouldRun === 'boolean' ? { wouldRun: r.scheduledBy.wouldRun } : {}),
        changedVerdict: r.status === 'ok' ? decisiveDimensions(r, finalDelta, results).length > 0 : null,
    }));
}

/** Observations and verdict changes. */
export interface BetaCount {
    n: number;
    k: number;
}

/** A repository's counts: per check, and per (check × cell) ({@link scheduleCellKey}). */
export interface ScheduleHistory {
    checks: Partial<Record<DynamicCheckId, BetaCount>>;
    cells: Record<string, BetaCount>;
}

/** A run's ONE cell: its sorted, deduplicated dimensions touched, `+`-joined; `-` when it touched none. */
export const contextCell = (dimensionsTouched: readonly DimensionId[]): string =>
    dimensionsTouched.length > 0 ? [...new Set(dimensionsTouched)].sort().join('+') : '-';

/** The dimensions of a cell ({@link contextCell}'s inverse; none for `-`). */
export const cellDimensions = (cell: string): DimensionId[] => (cell === '-' ? [] : (cell.split('+') as DimensionId[]));

export const scheduleCellKey = (check: DynamicCheckId, cell: string): string => `${check}|${cell}`;

/** The counts of a repository's outcomes: each observation once in its check and once in its run's cell. */
export function scheduleHistoryOf(outcomes: Iterable<DynamicCheckOutcome>): ScheduleHistory {
    const checks: Partial<Record<DynamicCheckId, BetaCount>> = {};
    const cells: Record<string, BetaCount> = {};
    const add = (c: BetaCount, hit: boolean): void => { c.n += 1; if (hit) c.k += 1; };
    for (const o of outcomes) {
        if (o.changedVerdict === null) continue;
        add(checks[o.check] ??= { n: 0, k: 0 }, o.changedVerdict);
        add(cells[scheduleCellKey(o.check, contextCell(o.dimensionsTouched))] ??= { n: 0, k: 0 }, o.changedVerdict);
    }
    return { checks, cells };
}

/**
 * §10 "the share of verdict-changing optional checks the scheduler ran versus random scheduling", as counts:
 *  - `scheduled` / `scheduledChanged`: Thompson-scheduled checks that ran `ok`, and how many were decisive;
 *  - `explored` / `exploredChanged`: the seeded random 10% that ran `ok`, and how many were decisive — the random baseline;
 *  - `exploredWouldRun` / `exploredChangedWouldRun`: of those, the ones the sampler would have run itself (its recall:
 *    `exploredChangedWouldRun / exploredChanged`);
 *  - `failed`: scheduled or explored checks that failed (in neither rate);
 *  - `notScheduled`: checks the sampler skipped on the posterior;
 *  - `budgetSkipped`: checks it skipped because the remaining budget could not afford them (not a posterior call).
 * The rates are the server's arithmetic over these counts.
 */
export interface ScheduleTelemetry {
    scheduled: number;
    scheduledChanged: number;
    explored: number;
    exploredChanged: number;
    exploredWouldRun: number;
    exploredChangedWouldRun: number;
    failed: number;
    notScheduled: number;
    budgetSkipped: number;
}

export function scheduleTelemetry(outcomes: readonly DynamicCheckOutcome[]): ScheduleTelemetry {
    const t: ScheduleTelemetry = {
        scheduled: 0, scheduledChanged: 0, explored: 0, exploredChanged: 0, exploredWouldRun: 0, exploredChangedWouldRun: 0, failed: 0, notScheduled: 0, budgetSkipped: 0,
    };
    for (const o of outcomes) {
        const sampled = o.policy === THOMPSON_POLICY || o.policy === EXPLORE_POLICY;
        if (!sampled) continue;
        if (o.status === 'skipped') {
            if (o.reason === 'not-scheduled') t.notScheduled++;
            else if (o.reason === 'budget-exhausted') t.budgetSkipped++;
        } else if (o.status === 'failed') {
            t.failed++;
        } else if (o.policy === THOMPSON_POLICY) {
            t.scheduled++;
            if (o.changedVerdict) t.scheduledChanged++;
        } else {
            t.explored++;
            if (o.changedVerdict) t.exploredChanged++;
            if (o.wouldRun) {
                t.exploredWouldRun++;
                if (o.changedVerdict) t.exploredChangedWouldRun++;
            }
        }
    }
    return t;
}
