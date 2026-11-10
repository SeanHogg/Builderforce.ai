/**
 * predict/scheduler.ts — D9.1 contextual Thompson sampling for the OPTIONAL dynamic checks: the
 * {@link DynamicCheckScheduler} WS12's tier asks (`dynamic/contract.ts`). Mandated and `never` checks are never asked.
 *
 * Model v1 (task `run.check-scheduler`, version `beta-cell.1`): per (check × the run's ONE cell — its sorted dimensions touched) of one
 * repository, a hierarchical Beta–Bernoulli posterior of "this check is decisive for a verdict" (`scheduleHistory.ts`,
 * `credit.ts`), shrunk toward the check's repository-wide rate with {@link PRIOR_STRENGTH} pseudo-observations. The
 * conjugate posterior makes the Thompson draw exact. The check runs when the draw ≥ cost(check) / value(cell) and the
 * remaining dynamic budget can afford it; the ratio is one more Thompson arm (a Beta concentrated at it), so the
 * decision is ONE `thompsonSample` from the builderforce-memory `stats` module — the sampler learned-routing uses.
 *
 * Exploration: {@link EXPLORATION_SHARE} of decisions run the check regardless (`thompson-explore`), by the seeded draw,
 * and still record what the sampler would have done (`wouldRun`): the §10 random baseline and its recall.
 *
 * Deterministic: the PRNG is seeded from `ctx.inputDigest` and the check (`seedOf`); `scheduledBy` records
 * `{ policy, modelId, modelVersion, p, seed, wouldRun? }` with `p` (the cell's posterior mean) quantized to 1e-4.
 *
 * Defaults (D0: a prediction never changes a verdict; it only spends or saves time): not opted in, or fewer than
 * {@link MIN_CHECK_OBSERVATIONS} observations of the check in this repository ⇒ the opt-in default. The host's kill switch
 * (the `checkScheduler` setting) simply does not pass this scheduler.
 *
 * ml task (D13): `run.check-scheduler`, a host row of memory-engine's `ml/tasks`. Its model card
 * (`CHECK_SCHEDULER_MODEL_CARD`) is the ONE source of the model id, version, data threshold and exploration share used
 * here; the engine row's logistic engine is this model's later pooled upgrade.
 *
 * The card comes through the engine's light `./ml/tasks/check-scheduler` subpath (never the engine root, which the
 * webview and the Worker — both `predict` consumers — must not bundle), so this module is served by `predict/index`.
 */

import { CHECK_SCHEDULER_MODEL_CARD } from '@seanhogg/builderforce-memory-engine/ml/tasks/check-scheduler';
import { betaPosterior, createRng, thompsonSample, type BetaArm } from '@seanhogg/builderforce-memory/stats';
import type { DimensionId } from '../contract.js';
import {
    DYNAMIC_CHECK_DIMENSION, DYNAMIC_CHECKS,
    type DynamicCheckContext, type DynamicCheckId, type DynamicCheckScheduler, type DynamicDecision, type DynamicScheduledBy,
} from '../dynamic/contract.js';
import { optInScheduler } from '../dynamic/schedule.js';
import { seedOf } from '../dynamic/significance.js';
import { cellDimensions, contextCell, EXPLORE_POLICY, scheduleCellKey, THOMPSON_POLICY, type ScheduleHistory } from './scheduleHistory.js';

/** The memory-engine ml task this model answers (the card's `taskId`). */
export const CHECK_SCHEDULER_MODEL_ID: string = CHECK_SCHEDULER_MODEL_CARD.taskId;
/** The card's `modelVersion`: the per-cell Beta–Bernoulli v1. */
export const CHECK_SCHEDULER_MODEL_VERSION: string = CHECK_SCHEDULER_MODEL_CARD.modelVersion;

/** Share of sampled decisions that run the check regardless (§11: deterministic exploration) — the card's. */
export const EXPLORATION_SHARE: number = CHECK_SCHEDULER_MODEL_CARD.explorationShare;
/** Observations of a check in a repository below which the opt-in default decides — the card's. */
export const MIN_CHECK_OBSERVATIONS: number = CHECK_SCHEDULER_MODEL_CARD.minObservations;
/** Pseudo-observations of the check's repository-wide rate in each cell's prior. */
export const PRIOR_STRENGTH = 10;
/** How tightly the cost arm sits at the cost-to-value ratio (a Beta with this α + β). */
export const COST_ARM_CONCENTRATION = 10_000;
const P_STEP = 1e-4;

/** Relative cost of running a check (wall time and CPU on the person's machine). */
export const CHECK_COST: Readonly<Record<DynamicCheckId, number>> = { benchmark: 3, 'diff-coverage': 1, mutation: 4 };
/** Relative value of catching a verdict change in a dimension. */
export const DIMENSION_VALUE: Readonly<Partial<Record<DimensionId, number>>> = { performance: 20, quality: 20, security: 40 };
const DEFAULT_DIMENSION_VALUE = 20;
/** What a check typically takes (ms): the remaining dynamic budget must afford it. */
export const CHECK_EXPECTED_MS: Readonly<Record<DynamicCheckId, number>> = { benchmark: 3 * 60_000, 'diff-coverage': 60_000, mutation: 5 * 60_000 };

/**
 * The probability of a verdict change at which running `check` pays in `cell`: cost(check) / value, where value is the
 * most valuable dimension of the cell (the check's own dimension for a run that touched none). In [0.01, 0.99].
 */
export function runThreshold(check: DynamicCheckId, cell: string): number {
    const dims = cellDimensions(cell);
    const value = Math.max(...(dims.length > 0 ? dims : [DYNAMIC_CHECK_DIMENSION[check]]).map((d) => DIMENSION_VALUE[d] ?? DEFAULT_DIMENSION_VALUE));
    return Math.min(0.99, Math.max(0.01, CHECK_COST[check] / value));
}

/** Whether a repository's history is enough for the sampler on any check (the host's choice of scheduler). */
export function hasScheduleHistory(history: ScheduleHistory): boolean {
    return DYNAMIC_CHECKS.some((c) => (history.checks[c]?.n ?? 0) >= MIN_CHECK_OBSERVATIONS);
}

/** The cell's posterior: Beta(1 + S·m, 1 + S·(1 − m)) around the check's rate m, updated by the cell's own counts. */
function cellArm(history: ScheduleHistory, check: DynamicCheckId, cell: string): BetaArm & { mean: number } {
    const total = history.checks[check] ?? { n: 0, k: 0 };
    const m = total.n > 0 ? total.k / total.n : 0.5;
    const own = history.cells[scheduleCellKey(check, cell)] ?? { n: 0, k: 0 };
    const post = betaPosterior(1 + PRIOR_STRENGTH * m, 1 + PRIOR_STRENGTH * (1 - m), own.k, own.n);
    return { alpha: post.alpha, beta: post.beta, mean: post.mean };
}

const quantize = (v: number): number => Number((Math.round(v / P_STEP) * P_STEP).toFixed(4));

/** The D9.1 sampler over one repository's {@link ScheduleHistory}. */
export function thompsonScheduler(history: ScheduleHistory): DynamicCheckScheduler {
    return {
        expectedMs: (check: DynamicCheckId): number => CHECK_EXPECTED_MS[check],
        decide(check: DynamicCheckId, ctx: DynamicCheckContext): DynamicDecision {
            if (!ctx.optIn || (history.checks[check]?.n ?? 0) < MIN_CHECK_OBSERVATIONS) return optInScheduler.decide(check, ctx);
            const model = { modelId: CHECK_SCHEDULER_MODEL_ID, modelVersion: CHECK_SCHEDULER_MODEL_VERSION };
            const expectedMs = CHECK_EXPECTED_MS[check];
            // The remaining budget (after what earlier checks of this run were decided to spend) cannot afford it.
            if (ctx.remainingBudgetMs < expectedMs) {
                return { run: false, reason: 'budget-exhausted', scheduledBy: { policy: THOMPSON_POLICY, ...model }, expectedMs };
            }
            const seed = seedOf(`${ctx.inputDigest}:${check}`);
            const rng = createRng(seed);
            const explore = rng() < EXPLORATION_SHARE;
            const cell = contextCell(ctx.dimensionsTouched);
            const arm = cellArm(history, check, cell);
            const t = runThreshold(check, cell);
            const cost: BetaArm = { alpha: t * COST_ARM_CONCENTRATION, beta: (1 - t) * COST_ARM_CONCENTRATION };
            const wouldRun = thompsonSample([{ alpha: arm.alpha, beta: arm.beta }, cost], rng) === 0;
            const p = quantize(arm.mean);
            if (explore) {
                const scheduledBy: DynamicScheduledBy = { policy: EXPLORE_POLICY, ...model, p, seed, wouldRun };
                return { run: true, scheduledBy, expectedMs };
            }
            const scheduledBy: DynamicScheduledBy = { policy: THOMPSON_POLICY, ...model, p, seed };
            return wouldRun ? { run: true, scheduledBy, expectedMs } : { run: false, reason: 'not-scheduled', scheduledBy, expectedMs };
        },
    };
}
