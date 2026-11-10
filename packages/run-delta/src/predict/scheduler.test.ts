import { describe, expect, it } from 'vitest';
import type { DeltaFinding, DimensionId, DimensionResult, MetricDelta, RunDelta } from '../contract.js';
import type { DynamicCheckContext, DynamicCheckResult } from '../dynamic/contract.js';
import { optInScheduler } from '../dynamic/schedule.js';
import { decisiveDimensions } from './credit.js';
import {
    contextCell, dynamicCheckOutcomes, EXPLORE_POLICY, scheduleHistoryOf, scheduleTelemetry, THOMPSON_POLICY, type DynamicCheckOutcome,
} from './scheduleHistory.js';
import {
    CHECK_EXPECTED_MS, CHECK_SCHEDULER_MODEL_ID, CHECK_SCHEDULER_MODEL_VERSION, EXPLORATION_SHARE, hasScheduleHistory, MIN_CHECK_OBSERVATIONS,
    runThreshold, thompsonScheduler,
} from './scheduler.js';

const ctxOf = (inputDigest: string, over: Partial<DynamicCheckContext> = {}): DynamicCheckContext => ({
    runId: 'run-1', mode: 'interactive', changedFiles: ['src/a.ts'], dimensionsTouched: ['performance'],
    blastRadius: { score: 0.2, band: 'low' }, inputDigest, optIn: true, trusted: true, remainingBudgetMs: 15 * 60_000, ...over,
});

/** `n` observations of `check` on runs touching `dims`, `k` of which were decisive. */
function observed(check: DynamicCheckOutcome['check'], dims: DimensionId[], n: number, k: number): DynamicCheckOutcome[] {
    return Array.from({ length: n }, (_, i) => ({ check, dimensionsTouched: dims, policy: 'opt-in', status: 'ok', changedVerdict: i < k }));
}

const digests = (n: number): string[] => Array.from({ length: n }, (_, i) => `digest-${i}`);

describe('Thompson scheduler (D9.1)', () => {
    const useful = scheduleHistoryOf(observed('benchmark', ['performance'], 60, 45));
    const useless = scheduleHistoryOf(observed('benchmark', ['performance'], 200, 0));

    it('is deterministic under the input digest, and records its model', () => {
        for (const d of digests(50)) {
            const a = thompsonScheduler(useless).decide('benchmark', ctxOf(d));
            const b = thompsonScheduler(scheduleHistoryOf(observed('benchmark', ['performance'], 200, 0))).decide('benchmark', ctxOf(d));
            expect(a).toEqual(b);
            expect(a.scheduledBy).toMatchObject({ modelId: CHECK_SCHEDULER_MODEL_ID, modelVersion: CHECK_SCHEDULER_MODEL_VERSION, seed: expect.any(Number) });
        }
    });

    it('below the data threshold it is the opt-in default', () => {
        const thin = scheduleHistoryOf(observed('benchmark', ['performance'], MIN_CHECK_OBSERVATIONS - 1, 0));
        expect(hasScheduleHistory(thin)).toBe(false);
        for (const optIn of [true, false]) {
            const ctx = ctxOf('d', { optIn });
            expect(thompsonScheduler(thin).decide('benchmark', ctx)).toEqual(optInScheduler.decide('benchmark', ctx));
            // A check with no history of its own, in a repository that has some for another check.
            expect(thompsonScheduler(useful).decide('mutation', ctx)).toEqual(optInScheduler.decide('mutation', ctx));
        }
    });

    it('never schedules a check the person did not opt in to', () => {
        expect(thompsonScheduler(useful).decide('benchmark', ctxOf('d', { optIn: false }))).toEqual({ run: false, reason: 'opt-in-off', scheduledBy: { policy: 'opt-in' } });
    });

    it('a remaining budget that cannot afford the check is not scheduled (nor explored)', () => {
        const out = digests(200).map((d) => thompsonScheduler(useful).decide('benchmark', ctxOf(d, { remainingBudgetMs: CHECK_EXPECTED_MS.benchmark - 1 })));
        expect(out.every((x) => !x.run && x.reason === 'budget-exhausted')).toBe(true);
    });

    it('explores about 10% of decisions, recording what it would have done; otherwise follows the posterior', () => {
        const ds = digests(2_000);
        const low = ds.map((d) => thompsonScheduler(useless).decide('benchmark', ctxOf(d)));
        const explored = low.filter((x) => x.scheduledBy.policy === EXPLORE_POLICY);
        expect(Math.abs(explored.length / ds.length - EXPLORATION_SHARE)).toBeLessThan(0.02);
        expect(explored.every((x) => x.run && typeof x.scheduledBy.wouldRun === 'boolean')).toBe(true);
        expect(explored.filter((x) => x.scheduledBy.wouldRun).length / explored.length).toBeLessThan(0.05);
        expect(low.filter((x) => x.run && x.scheduledBy.policy === THOMPSON_POLICY).length / ds.length).toBeLessThan(0.02);
        expect(low.filter((x) => !x.run).every((x) => x.reason === 'not-scheduled')).toBe(true);
        const high = ds.slice(0, 500).map((d) => thompsonScheduler(useful).decide('benchmark', ctxOf(d)));
        expect(high.filter((x) => x.run).length / high.length).toBeGreaterThan(0.95);
        expect(high[0]!.scheduledBy.p).toBeGreaterThan(0.6);
    });

    it('value is the cell\'s most valuable dimension (security counts double)', () => {
        expect(runThreshold('mutation', '-')).toBeCloseTo(0.2, 10);
        expect(runThreshold('mutation', 'quality')).toBeCloseTo(0.2, 10);
        expect(runThreshold('mutation', 'quality+security')).toBeCloseTo(0.1, 10);
    });
});

describe('regression: M3 — one cell per run, keyed by its dimension set', () => {
    it('regression: an observation counts once, in its run\'s one cell', () => {
        const history = scheduleHistoryOf(observed('mutation', ['security', 'quality'], 30, 10));
        expect(contextCell(['security', 'quality', 'quality'])).toBe('quality+security');
        expect(history.cells).toEqual({ 'mutation|quality+security': { n: 30, k: 10 } });
        expect(history.checks.mutation).toEqual({ n: 30, k: 10 });
    });

    it('regression: cells learn apart, and an unseen cell shrinks toward the check\'s rate', () => {
        const history = scheduleHistoryOf([...observed('mutation', ['security'], 40, 36), ...observed('mutation', ['quality'], 40, 0)]);
        const runShare = (dims: DimensionId[]) => {
            const out = digests(400).map((d) => thompsonScheduler(history).decide('mutation', ctxOf(d, { dimensionsTouched: dims })));
            return out.filter((x) => x.run).length / out.length;
        };
        expect(runShare(['security'])).toBeGreaterThan(0.9);
        expect(runShare(['quality'])).toBeLessThan(0.2);
        // Unseen cell: the prior around the check's 45% rate, Beta(1 + 4.5, 1 + 5.5) — mean 5.5 / 12.
        expect(thompsonScheduler(history).decide('mutation', ctxOf('d', { dimensionsTouched: ['quality', 'security'] })).scheduledBy.p)
            .toBeCloseTo(5.5 / 12, 4);
        expect(runShare(['quality', 'security'])).toBeGreaterThan(0.5);
    });
});

// ─── Credit and the §10 counts ───────────────────────────────────────────────

const finding = (ruleId: string, dimension: DimensionId): DeltaFinding => ({
    identity: { ruleId, key: ruleId } as unknown as DeltaFinding['identity'], dimension, ruleId, ruleVersion: 1, severity: 'error',
    lineage: 'introduced', confidence: 'measured', params: {}, evidence: [],
});
const metric = (metricId: string, before: number, after: number): MetricDelta => ({
    metricId, before, after, step: 1, unit: 'count', betterWhen: 'higher', threshold: { warn: 0.05, error: 0.1, kind: 'pct' },
});
const ok = (tool: string) => ({ tool, version: '1', status: 'ok' as const });
const deltaOf = (dims: DimensionResult[]): RunDelta => ({ dimensions: dims }) as unknown as RunDelta;

describe('regression: H2 — credit only the check that was decisive (leave-one-out)', () => {
    // Two checks co-run on `quality`: mutation introduces an error finding (decisive); the other's metric did not move.
    const quality: DimensionResult = {
        id: 'quality', verdict: 'worse', reasons: [], findings: [finding('mutant-survived', 'quality')],
        metrics: [metric('cov.x', 80, 80)], measuredBy: [ok('complexity'), ok('cov-x.metrics'), ok('mutant-survived')],
    };
    const mutation: DynamicCheckResult = {
        check: 'mutation', tool: 'stryker', version: '', status: 'ok', scheduledBy: { policy: THOMPSON_POLICY },
        measurements: [{ ruleId: 'mutant-survived', ruleVersion: 1, dimension: 'quality', findings: { before: [], after: [] }, metrics: [] }],
    };
    const coverage: DynamicCheckResult = {
        check: 'diff-coverage', tool: 'vitest', version: '', status: 'ok', scheduledBy: { policy: EXPLORE_POLICY, wouldRun: true },
        measurements: [{ ruleId: 'cov-x', ruleVersion: 1, dimension: 'quality', findings: { before: [], after: [] }, metrics: [metric('cov.x', 80, 80)] }],
    };

    it('regression: of two co-running checks on one dimension, only the decisive one is credited', () => {
        const delta = deltaOf([quality]);
        expect(decisiveDimensions(mutation, delta)).toEqual(['quality']);
        expect(decisiveDimensions(coverage, delta)).toEqual([]);
        const outcomes = dynamicCheckOutcomes({ dimensionsTouched: ['quality'] }, [mutation, coverage], delta);
        expect(outcomes.map((o) => o.changedVerdict)).toEqual([true, false]);
        expect(outcomes[1]!.wouldRun).toBe(true);
    });

    it('regression: measuring a dimension nothing else measured (out of not_measured) is not a verdict change', () => {
        const alone: DimensionResult = { ...quality, measuredBy: [ok('mutant-survived')], metrics: [] };
        expect(decisiveDimensions(mutation, deltaOf([alone]))).toEqual([]);
    });
});

describe('the §10 counts', () => {
    it('counts scheduled and explored runs, the sampler\'s would-run share, failures and skips apart', () => {
        const o = (policy: string, status: DynamicCheckOutcome['status'], changedVerdict: boolean | null, extra: Partial<DynamicCheckOutcome> = {}): DynamicCheckOutcome =>
            ({ check: 'benchmark', dimensionsTouched: [], policy, status, changedVerdict, ...extra });
        expect(scheduleTelemetry([
            o(THOMPSON_POLICY, 'ok', true), o(THOMPSON_POLICY, 'ok', false), o(THOMPSON_POLICY, 'failed', null),
            o(EXPLORE_POLICY, 'ok', true, { wouldRun: true }), o(EXPLORE_POLICY, 'ok', true, { wouldRun: false }), o(EXPLORE_POLICY, 'failed', null, { wouldRun: true }),
            o(THOMPSON_POLICY, 'skipped', null, { reason: 'not-scheduled' }), o('opt-in', 'ok', true),
        ])).toEqual({ scheduled: 2, scheduledChanged: 1, explored: 2, exploredChanged: 2, exploredWouldRun: 1, exploredChangedWouldRun: 1, failed: 2, notScheduled: 1, budgetSkipped: 0 });
    });
});

describe('regression: H2 — leave-one-out removes everything a check produced (analyzer provenance)', () => {
    it('regression: diff-coverage moving quality only through the coverage analyzer\'s coverage.diff is credited', () => {
        // The `coverage` row the tier re-measured after diff-coverage's tests names it as producer (`producedBy`).
        const coverageDiff: MetricDelta = { ...metric('coverage.diff', 90, 50), unit: 'ratio' };
        const quality: DimensionResult = {
            id: 'quality', verdict: 'worse', reasons: [], findings: [], metrics: [coverageDiff],
            measuredBy: [ok('complexity'), { tool: 'coverage', version: '1', status: 'ok', producedBy: 'diff-coverage' }],
        };
        const performance: DimensionResult = { id: 'performance', verdict: 'same', reasons: [], findings: [], metrics: [], measuredBy: [ok('test-slower')] };
        const diffCoverage: DynamicCheckResult = {
            check: 'diff-coverage', tool: 'vitest', version: '', status: 'ok', scheduledBy: { policy: THOMPSON_POLICY },
            measurements: [{ ruleId: 'test-slower', ruleVersion: 1, dimension: 'performance', findings: { before: [], after: [] }, metrics: [] }],
        };
        expect(decisiveDimensions(diffCoverage, deltaOf([performance, quality]))).toEqual(['quality']);
        // The same coverage row measured from the tree as it was (no provenance) is not the check's.
        const unowned: DimensionResult = { ...quality, measuredBy: [ok('complexity'), ok('coverage')] };
        expect(decisiveDimensions(diffCoverage, deltaOf([performance, unowned]))).toEqual([]);
    });
});

describe('the model is the memory-engine ml task', () => {
    it('takes its identity, data threshold and exploration share from the engine model card', async () => {
        const { CHECK_SCHEDULER_MODEL_CARD, CHECK_SCHEDULER_TASK } = await import('@seanhogg/builderforce-memory-engine/ml/tasks/check-scheduler');
        expect(CHECK_SCHEDULER_MODEL_ID).toBe(CHECK_SCHEDULER_TASK.id);
        expect(CHECK_SCHEDULER_MODEL_ID).toBe(CHECK_SCHEDULER_MODEL_CARD.taskId);
        expect(CHECK_SCHEDULER_MODEL_VERSION).toBe(CHECK_SCHEDULER_MODEL_CARD.modelVersion);
        expect(MIN_CHECK_OBSERVATIONS).toBe(CHECK_SCHEDULER_MODEL_CARD.minObservations);
        expect(EXPLORATION_SHARE).toBe(CHECK_SCHEDULER_MODEL_CARD.explorationShare);
    });
});

describe('regression: M1 — the budget gate is cumulative across a run\'s checks', () => {
    it('regression: a 6-minute budget where history favours benchmark (3 min) and mutation (5 min) runs only the first', async () => {
        const { planDynamicTier } = await import('../dynamic/schedule.js');
        const { DEFAULT_DYNAMIC_POLICY } = await import('../dynamic/contract.js');
        const history = scheduleHistoryOf([
            ...observed('benchmark', ['performance'], 60, 55), ...observed('mutation', ['performance'], 60, 55),
        ]);
        const ctx = ctxOf('d', { remainingBudgetMs: 6 * 60_000 });
        const plan = planDynamicTier(ctx, DEFAULT_DYNAMIC_POLICY, { 'diff-coverage': 'tool-unavailable' }, thompsonScheduler(history));
        expect(plan.get('benchmark')).toMatchObject({ run: true, expectedMs: CHECK_EXPECTED_MS.benchmark });
        expect(plan.get('mutation')).toMatchObject({ run: false, reason: 'budget-exhausted' });
        // Alone, mutation fits the same budget: it was the benchmark's 3 minutes that left too little.
        expect(thompsonScheduler(history).decide('mutation', ctx).reason).not.toBe('budget-exhausted');
        expect(scheduleTelemetry(dynamicCheckOutcomes(ctx, [
            { check: 'mutation', tool: '', version: '', status: 'skipped', reason: 'budget-exhausted', measurements: [], scheduledBy: plan.get('mutation')!.scheduledBy },
        ], deltaOf([])))).toMatchObject({ budgetSkipped: 1, notScheduled: 0 });
    });
});

describe('regression: M2 — a regression two checks both catch credits both', () => {
    it('regression: two checks flag metric errors on one dimension; leave-one-out credits neither, "alone" credits both', () => {
        const perf: DimensionResult = {
            id: 'performance', verdict: 'worse', reasons: ['static-only'], findings: [],
            metrics: [metric('bench.a', 100, 50), metric('test.b', 100, 50)],
            measuredBy: [ok('complexity'), ok('bench.metrics'), ok('test-slower.metrics')],
        };
        const result = (check: DynamicCheckResult['check'], ruleId: string, metricId: string): DynamicCheckResult => ({
            check, tool: 't', version: '', status: 'ok', scheduledBy: { policy: THOMPSON_POLICY },
            measurements: [{ ruleId, ruleVersion: 1, dimension: 'performance', findings: { before: [], after: [] }, metrics: [metric(metricId, 100, 50)] }],
        });
        const bench = result('benchmark', 'bench', 'bench.a');
        const tests = result('diff-coverage', 'test-slower', 'test.b');
        const delta = deltaOf([perf]);
        expect(decisiveDimensions(bench, delta)).toEqual([]); // leave-one-out only: the other still catches it
        expect(decisiveDimensions(bench, delta, [bench, tests])).toEqual(['performance']);
        expect(decisiveDimensions(tests, delta, [bench, tests])).toEqual(['performance']);
        expect(dynamicCheckOutcomes({ dimensionsTouched: [] }, [bench, tests], delta).map((o) => o.changedVerdict)).toEqual([true, true]);
    });
});

describe('regression: mandated and opt-in runs are charged to the budget too', () => {
    it('regression: a mandated benchmark (3 min) leaves a 6-minute budget too small for a sampled mutation (5 min)', async () => {
        const { planDynamicTier } = await import('../dynamic/schedule.js');
        const { DEFAULT_DYNAMIC_POLICY } = await import('../dynamic/contract.js');
        const history = scheduleHistoryOf(observed('mutation', ['performance'], 60, 55));
        const policy = { ...DEFAULT_DYNAMIC_POLICY, require: { ...DEFAULT_DYNAMIC_POLICY.require, benchmark: 'always' as const } };
        const ctx = ctxOf('d', { remainingBudgetMs: 6 * 60_000 });
        const plan = planDynamicTier(ctx, policy, { 'diff-coverage': 'tool-unavailable' }, thompsonScheduler(history));
        expect(plan.get('benchmark')).toMatchObject({ run: true, scheduledBy: { policy: 'mandated' } });
        expect(plan.get('mutation')).toMatchObject({ run: false, reason: 'budget-exhausted' });
        // Without the mandated run the same mutation would be decided on its posterior.
        const alone = planDynamicTier(ctx, DEFAULT_DYNAMIC_POLICY, { 'diff-coverage': 'tool-unavailable', benchmark: 'not-configured' }, thompsonScheduler(history));
        expect(alone.get('mutation')?.reason).not.toBe('budget-exhausted');
    });
});
