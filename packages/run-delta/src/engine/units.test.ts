import { describe, expect, it } from 'vitest';
import type { MetricDelta } from '../contract.js';
import { DEFAULT_REGISTRIES } from '../registry/defaults.js';
import { withOverrides } from '../registry/overrides.js';
import { facts } from '../testing/fixturePorts.js';
import { blastRadius, fileCentrality } from './blastRadius.js';
import { impactSet } from './impactSet.js';
import { matchRenames } from './renames.js';
import { dimensionVerdict, metricLevels, worst } from './verdict.js';

describe('matchRenames (C1)', () => {
    it('pairs exact hashes first, then token-set Jaccard ≥ 0.5, greedily', () => {
        const pairs = matchRenames(
            [{ path: 'a/one.ts', hash: 'h1' }, { path: 'a/two.ts', text: 'alpha beta gamma delta epsilon' }, { path: 'a/three.ts', text: 'zeta eta theta' }],
            [{ path: 'b/one.ts', hash: 'h1' }, { path: 'b/two.ts', text: 'alpha beta gamma delta omega' }, { path: 'b/other.ts', text: 'iota kappa lambda' }],
        );
        expect(pairs).toEqual([{ from: 'a/one.ts', to: 'b/one.ts', kind: 'exact' }, { from: 'a/two.ts', to: 'b/two.ts', kind: 'similar' }]);
    });

    it('prefers the more similar candidate, then the ascending path', () => {
        const pairs = matchRenames(
            [{ path: 'x.ts', text: 'a b c d' }, { path: 'w.ts', text: 'a b c d' }],
            [{ path: 'y.ts', text: 'a b c d e' }],
        );
        expect(pairs).toEqual([{ from: 'w.ts', to: 'y.ts', kind: 'similar' }]);
    });

    it('never pairs below the floor', () => {
        expect(matchRenames([{ path: 'a.ts', text: 'a b c' }], [{ path: 'b.ts', text: 'a x y z' }])).toEqual([]);
    });
});

describe('impactSet (C2)', () => {
    const graph = facts({
        imports: new Map([
            ['app/main.ts', ['app/router.ts']],
            ['app/router.ts', ['lib/svc.ts']],
            ['lib/svc.ts', ['lib/db.ts']],
            ['tools/cli.ts', ['lib/db.ts']],
            ['other.ts', []],
        ]),
        badges: new Map<string, Record<string, number>>([['app/main.ts', { entry: 1 }], ['other.ts', { routes: 2 }]]),
    });

    it('reverse dependents up to 2 hops and the entry points that reach a changed file', () => {
        const impact = impactSet(['lib/db.ts'], facts(), graph);
        expect(impact.dependents).toEqual(['app/router.ts', 'lib/svc.ts', 'tools/cli.ts']);
        expect(impact.entryPoints).toEqual(['app/main.ts']);
    });
});

describe('blastRadius (C10 v1)', () => {
    it('PageRank on a tiny known graph: the shared target ranks highest', () => {
        const c = fileCentrality(facts({ imports: new Map([['a', ['b']], ['c', ['b']]]) }));
        expect(c.get('b')).toBe(1);
        expect(c.get('a')).toBe(c.get('c'));
        expect(c.get('a')!).toBeLessThan(1);
    });

    it('score = Σ centrality × (1 + log2(1 + churn)) + 2 × entry points; bands from past p50/p90', () => {
        const side = facts({ imports: new Map([['a', ['b']], ['c', ['b']]]) });
        const r = blastRadius({ changedFiles: ['b'], entryPoints: ['a'], before: side, after: side, churn: new Map([['b', 3]]), pastScores: [] });
        expect(r).toEqual({ score: 5, band: 'low', formula: 'v1', reasons: ['insufficient-history'] }); // 1 × (1 + 2) + 2
        const past = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const at = (score: number) => blastRadius({ changedFiles: [], entryPoints: Array.from({ length: score }, (_, i) => `e${i}`), before: side, after: side, churn: new Map(), pastScores: past }).band;
        expect(at(2)).toBe('low'); // 4 < p50 (5)
        expect(at(4)).toBe('medium'); // 8 ≤ p90 (9)
        expect(at(5)).toBe('high'); // 10 > 9
    });
});

describe('verdict rules', () => {
    const metric = (before: number | null, after: number | null): MetricDelta => ({
        metricId: 'm', before, after, step: 1, unit: 'count', betterWhen: 'lower', threshold: { warn: 2, error: 5, kind: 'abs' },
    });

    it('worst follows HEADLINE_ORDER', () => {
        expect(worst(['same', 'better', 'not_measured'])).toBe('better');
        expect(worst(['better', 'not_comparable'])).toBe('not_comparable');
        expect(worst([])).toBe('not_measured');
    });

    it('metric levels by threshold in the worse and better direction', () => {
        expect(metricLevels(metric(1, 7))).toEqual({ regression: 'error', improvement: undefined });
        expect(metricLevels(metric(7, 4))).toEqual({ regression: undefined, improvement: 'warn' });
        expect(metricLevels(metric(null, 4))).toEqual({ regression: undefined, improvement: undefined });
    });

    it('a dimension where nothing ran is not_measured', () => {
        expect(dimensionVerdict({ id: 'ilities.reliability', ran: 0, failed: [], notComparable: [], findings: [], metrics: [], metricsNotComparable: new Set(), integrityRules: new Set() }))
            .toEqual({ verdict: 'not_measured', reasons: ['rule-not-built'] });
    });
});

describe('withOverrides', () => {
    it('merges valid keys and drops unknown keys and invalid entries', () => {
        const { registries, dropped } = withOverrides(DEFAULT_REGISTRIES, {
            guards: { requireOwner: 35, bad: 'x' },
            io: ['^kysely\\.', '('],
            blocking: ['weak-crypto'],
            benchmarks: {},
        });
        expect(registries.guards['requireOwner']).toBe(35);
        expect(registries.guards['requireAuth']).toBe(10);
        expect(registries.io).toContain('^kysely\\.');
        expect(registries.io).not.toContain('(');
        expect(registries.blocking).toEqual([...DEFAULT_REGISTRIES.blocking, 'weak-crypto']);
        expect(dropped).toEqual(['invalid:guards.bad', 'invalid:io.(', 'unknown-key:benchmarks']);
    });

    it('returns the defaults for a non-object', () => {
        expect(withOverrides(DEFAULT_REGISTRIES, 3)).toEqual({ registries: DEFAULT_REGISTRIES, dropped: ['invalid:root'] });
    });
});
