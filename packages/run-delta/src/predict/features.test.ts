import { describe, expect, it } from 'vitest';
import {
    FEATURE_IDS, FeatureLeakageError, changeEntropy, featureDigest, freezeRunFeatures, lineDelta, type FeatureDef, type RunFeatureInputs,
} from './features.js';

const FINALIZED = '2026-11-01T00:00:00.000Z';
const day = (n: number): string => new Date(Date.parse(FINALIZED) + n * 86_400_000).toISOString();

const base: RunFeatureInputs = {
    runId: 'run-1', repository: 'https://example.test/r.git', finalizedAt: FINALIZED, entryPoint: 'vscode', mode: 'autonomous',
    fileLines: [{ path: 'src/a.ts', at: FINALIZED, added: 6, deleted: 2 }, { path: 'src/a.test.ts', at: FINALIZED, added: 8, deleted: 0 }],
};

const fix = (eventAt: string) => ({ kind: 'followup-fix' as const, value: true, status: 'censored' as const, eventAt });

describe('RunFeatures (PRD 41 §D1)', () => {
    it('writes every feature id, null where not measured (never zero)', () => {
        const f = freezeRunFeatures(base);
        expect(Object.keys(f.values)).toEqual([...FEATURE_IDS]);
        expect(f.values['size.linesAdded']).toBe(14);
        expect(f.values['size.filesTouched']).toBe(2);
        expect(f.values['delta.testsChanged']).toBe(1);
        expect(f.values['run.autonomous']).toBe(1);
        expect(f.values['history.churn90d']).toBeNull();
        expect(f.values['delta.security.introduced']).toBeNull();
        expect(f.schemaVersion).toBe(1);
        expect(f.digest).toBe(featureDigest(f.values));
    });

    it('computes change entropy (D2.1)', () => {
        expect(changeEntropy([8, 8])).toEqual({ entropy: 1, normalized: 1 });
        expect(changeEntropy([5])).toEqual({ entropy: 0, normalized: 0 });
        expect(changeEntropy([])).toEqual({ entropy: 0, normalized: 0 });
    });

    it('is point in time: history after finalizedAt changes nothing', () => {
        const past = {
            ...base,
            fileCommits: [{ path: 'src/a.ts', at: day(-10), linesChanged: 5 }, { path: 'src/a.ts', at: day(-100), linesChanged: 50 }],
            // A true follow-up fix whose event happened before run end counts even while its window is open.
            pastLabels: [
                { at: day(-5), paths: ['src/a.ts'], label: fix(day(-6)) },
                // Computed before run end but its event is after it: not known at run end.
                { at: day(-1), paths: ['src/a.ts'], label: fix(day(4)) },
            ],
            fileBirths: [{ path: 'src/a.ts', at: day(-20) }],
            experience: { priorRuns: [{ at: day(-3) }], priorChanges: [{ path: 'src/a.ts', at: day(-2) }], firstSeen: { at: day(-30) } },
        };
        const withFuture = {
            ...past,
            fileCommits: [...past.fileCommits, { path: 'src/a.ts', at: day(5), linesChanged: 99 }],
            // A follow-up fix labelled AFTER the run ended is exactly the leak the guard exists for.
            pastLabels: [...past.pastLabels, { at: day(3), paths: ['src/a.ts'], label: fix(day(-2)) }],
            fileBirths: [...past.fileBirths, { path: 'src/a.test.ts', at: day(1) }],
            experience: { ...past.experience, priorRuns: [...past.experience.priorRuns, { at: day(2) }] },
        };
        const a = freezeRunFeatures(past);
        const b = freezeRunFeatures(withFuture);
        expect(b.values).toEqual(a.values);
        expect(a.values['history.churn90d']).toBe(5);
        expect(a.values['history.pastFollowupFixes']).toBe(1);
        expect(a.values['history.ageDaysMean']).toBe(20);
        expect(a.values['people.priorRunsInRepo']).toBe(1);
        expect(a.values['people.tenureDays']).toBe(30);
    });

    it('the leakage guard fails a feature that reads data later than finalizedAt', () => {
        const leaky: FeatureDef = {
            id: 'fixture-leaky-fix-time',
            compute(ctx) {
                // A timestamp INSIDE a value (a past label's event time), declared as read: the event lies after run end.
                const times = (ctx.inputs.pastLabels ?? []).flatMap((l) => (l.label.eventAt ? [l.label.eventAt] : []));
                for (const at of times) ctx.source(at);
                return { 'history.pastFollowupFixes': times.length };
            },
        };
        const inputs = { ...base, pastLabels: [{ at: day(-3), paths: ['src/a.ts'], label: fix(day(-4)) }, { at: day(-1), paths: ['src/a.ts'], label: fix(day(2)) }] };
        expect(() => freezeRunFeatures(inputs, [leaky])).toThrow(FeatureLeakageError);
        expect(() => freezeRunFeatures({ ...inputs, pastLabels: inputs.pastLabels.slice(0, 1) }, [leaky])).not.toThrow();
    });

    it('is structural: a def reading ctx.inputs directly never sees the future', () => {
        const direct: FeatureDef = {
            id: 'fixture-direct-churn',
            compute: (ctx) => ({ 'history.churn90d': (ctx.inputs.fileCommits ?? []).reduce((n, c) => n + c.linesChanged, 0) }),
        };
        const inputs = { ...base, fileCommits: [{ path: 'src/a.ts', at: day(-1), linesChanged: 1 }, { path: 'src/a.ts', at: day(2), linesChanged: 9 }] };
        expect(freezeRunFeatures(inputs, [direct]).values['history.churn90d']).toBe(1);
    });

    it('counts a file change by line multisets (the run\'s own before/after, not the working tree)', () => {
        expect(lineDelta('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual({ added: 2, deleted: 1 });
        expect(lineDelta(undefined, 'x\r\ny')).toEqual({ added: 2, deleted: 0 });
        expect(lineDelta('x\n', undefined)).toEqual({ added: 0, deleted: 1 });
    });

    it('refuses a def that writes an unknown feature id', () => {
        const rogue: FeatureDef = { id: 'rogue', compute: () => ({ ['nope' as 'run.steps']: 1 }) };
        expect(() => freezeRunFeatures(base, [rogue])).toThrow(/feature_unknown/);
    });

    it('gives the same digest for the same inputs (reproducible)', () => {
        expect(freezeRunFeatures(base).digest).toBe(freezeRunFeatures({ ...base }).digest);
    });
});
