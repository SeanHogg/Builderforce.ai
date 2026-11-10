/**
 * Regression tests for the Opus review of 5b3f2becf (items #1–#13), one `regression:` case per finding.
 * Fixture test files spell focus/skip markers split (`"it" + ".only("`) so the repo's skip-marker guard
 * never counts them.
 */

import { identityOf, srcRef } from '@seanhogg/builderforce-memory/knowledge';
import { describe, expect, it } from 'vitest';
import type { DimensionId, DimensionRegistry, RunDelta, SideFacts } from '../contract.js';
import { DEFAULT_REGISTRIES } from '../registry/defaults.js';
import { defaultDimensionRegistry } from '../registry/dimensions.js';
import { fixture, type Files, type FixtureOptions } from '../testing/fixturePorts.js';
import { computeRunDelta } from './computeRunDelta.js';

const dim = (d: RunDelta, id: DimensionId) => d.dimensions.find((x) => x.id === id)!;
const ruleIds = (d: RunDelta, id: DimensionId, lineage = 'introduced') => dim(d, id).findings.filter((f) => f.lineage === lineage).map((f) => f.ruleId).sort();
const GUARDED = "app.get('/api/x', requireAuth, (c) => c.json(1));\n";
const UNGUARDED = "app.get('/api/x', (c) => c.json(1));\n";
const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

async function run(before: Files, after: Files, opts?: FixtureOptions, registry: DimensionRegistry = defaultDimensionRegistry()): Promise<RunDelta> {
    const { input, ports } = fixture(before, after, opts);
    return computeRunDelta(input, registry, ports);
}

describe('regression: #1 secrets never leave through any rule', () => {
    it('a token placed in every rule input never appears in the delta', async () => {
        const t = TOKEN;
        const before: Files = {
            'api/r.ts': `app.get('/api/${t}', requireAuth, h);\n`,
            'src/a.ts': 'export const a = 1;\n',
            'src/a.test.ts': `it('${t}', () => { expect(1).toEqual(1); });\nit('k', () => { expect(2).toEqual(2); });\n`,
            'scripts/ship.sh': 'echo\n',
            'migrations/1.sql': 'select 1;\n',
        };
        const after: Files = {
            'api/r.ts': `app.get('/api/${t}', h);\n`,
            'src/a.ts': [
                `export function f(a = '${t}'): string { return a; }`,
                `export const k = process.env.K ?? '${t}';`,
                `const h = createHash('md5').update('${t}');`,
                `const s = readFileSync('${t}'); // @ts-ignore ${t}`,
                `for (const i of xs) { await fetch('https://h/?k=${t}'); }`,
                `// TODO ${t}`,
                '',
            ].join('\n'),
            'src/a.test.ts': `it('k', () => { expect(2).toBeDefined(); });\n`,
            'scripts/ship.sh': `git push --force https://x:${t}@github.com/o/r main\nrm -rf /tmp/${t}\n`,
            'migrations/1.sql': `DROP TABLE t; -- ${t}\n`,
        };
        const d = await run(before, after);
        const all = d.dimensions.flatMap((x) => x.findings.map((f) => f.ruleId));
        for (const id of ['guard-removed', 'capability-added', 'weak-crypto', 'sync-io', 'io-in-loop', 'suppression-added', 'secret-added',
            'test-deleted', 'matcher-weakened', 'force-push', 'rm-rf', 'destructive-ddl', 'api-added']) expect(all).toContain(id);
        expect(JSON.stringify(d)).not.toContain(t);
    });
});

describe('regression: #2 blocking fails closed', () => {
    for (const [name, meta] of [['truncated', { truncated: true }], ['branch', { branch: 'main' }]] as const) {
        it(`content rules still gate on ${name} meta; guard-removed still blocks`, async () => {
            const d = await run({ 'api/r.ts': GUARDED }, { 'api/r.ts': UNGUARDED }, {
                mode: 'autonomous', beforeFacts: { meta }, afterFacts: { meta: name === 'branch' ? { branch: 'agent/x' } : meta },
            });
            expect(dim(d, 'security').verdict).toBe('worse');
            expect(d.blocking).toEqual(['guard-removed']);
            expect(dim(d, 'ilities.maintainability').verdict).toBe('not_comparable'); // fact rules are gated
        });
    }

    it('head-switched blocks an autonomous run', async () => {
        const d = await run({ 'api/r.ts': GUARDED }, { 'api/r.ts': UNGUARDED }, { mode: 'autonomous', headSwitched: true });
        expect(d.blocking).toEqual(['head-switched']);
    });

    it('a blocking rule whose kind is not comparable blocks with not-comparable:<id>', async () => {
        const reg = defaultDimensionRegistry({ ...DEFAULT_REGISTRIES, blocking: [...DEFAULT_REGISTRIES.blocking, 'clone-group'] });
        const d = await run({ 'a.ts': 'a\n' }, { 'a.ts': 'b\n' }, { mode: 'autonomous', beforeFacts: { meta: { tools: { jscpd: '1' } } }, afterFacts: { meta: { tools: { jscpd: '2' } } } }, reg);
        expect(d.blocking).toEqual(['not-comparable:clone-group']);
    });

    it('a clean autonomous run does not block', async () => {
        const d = await run({ 'a.ts': 'export const a = 1;\n' }, { 'a.ts': 'export const a = 1; // ok\n' }, { mode: 'autonomous' });
        expect(d.blocking).toEqual([]);
    });
});

describe('regression: #4 guard topologies', () => {
    it('a chained receiver carries an earlier chained .use guard', async () => {
        const d = await run(
            { 'api/r.ts': "export const r = new Hono().use(requireAuth).get('/api/x', (c) => c.json(1));\n" },
            { 'api/r.ts': "export const r = new Hono().get('/api/x', (c) => c.json(1));\n" },
        );
        expect(ruleIds(d, 'security')).toContain('guard-removed');
        expect(dim(d, 'security').findings.find((f) => f.ruleId === 'guard-removed' && f.params['route'] === 'GET /api/x')).toMatchObject({ params: { via: 'chain' } });
    });

    it('app.use(g).get(...) chains onto the named receiver', async () => {
        const d = await run({ 'api/r.ts': "app.use(requireAuth).get('/api/x', h);\n" }, { 'api/r.ts': "app.get('/api/x', h);\n" });
        expect(dim(d, 'security').findings.filter((f) => f.ruleId === 'guard-removed').map((f) => f.params['via']).sort()).toEqual(['chain', 'middleware']);
    });

    it('a deleted guarded .use is its own guard-removed, keyed use <recv> <prefix>', async () => {
        const d = await run(
            { 'api/i.ts': "const api = new Hono();\napi.get('/x', (c) => c.json(1));\napp.use('/api/*', requireAuth);\napp.route('/api', api);\n" },
            { 'api/i.ts': "const api = new Hono();\napi.get('/x', (c) => c.json(1));\napp.route('/api', api);\n" },
        );
        const f = dim(d, 'security').findings.find((x) => x.ruleId === 'guard-removed')!;
        expect(f.params).toMatchObject({ route: 'use app /api/*', guard: 'requireAuth', via: 'middleware' });
        expect(dim(d, 'security').verdict).toBe('worse');
    });

    it('a re-keyed route with the same handler that lost its guard is guard-removed, not entry-added + entry-removed', async () => {
        const d = await run({ 'api/j.ts': "app.post('/api/admin/x', requireSuperadmin, h);\n" }, { 'api/j.ts': "app.post('/api/admin/x2', h);\n" }, { mode: 'autonomous' });
        expect(ruleIds(d, 'security')).toEqual(['guard-removed']);
        expect(dim(d, 'security').findings[0]!.params).toMatchObject({ route: 'POST /api/admin/x2', from: 'POST /api/admin/x', via: 'rekeyed' });
        expect(d.blocking).toEqual(['guard-removed']);
    });

    it('a new unguarded route among all-guarded siblings is guard-removed', async () => {
        const d = await run(
            { 'api/k.ts': "app.get('/a', requireAuth, ha);\napp.get('/b', requireAuth, hb);\n" },
            { 'api/k.ts': "app.get('/a', requireAuth, ha);\napp.get('/b', requireAuth, hb);\napp.get('/c', hc);\n" },
        );
        expect(ruleIds(d, 'security')).toEqual(['guard-removed']);
        expect(dim(d, 'security').findings[0]!.params).toMatchObject({ route: 'GET /c', guard: 'requireAuth', via: 'unguarded-sibling' });
    });

    it('a new guarded route stays a plain entry-added', async () => {
        const d = await run({ 'api/k.ts': "app.get('/a', requireAuth, ha);\n" }, { 'api/k.ts': "app.get('/a', requireAuth, ha);\napp.get('/c', requireAuth, hc);\n" });
        expect(ruleIds(d, 'security')).toEqual(['entry-added']);
    });
});

describe('regression: #5/#6 linear time, per-call memory', () => {
    it('a 2 MB file with many hits finishes under 2 s', async () => {
        const line = 'export const v = await fetch(x) as any; // @ts-ignore\n';
        const big = line.repeat(Math.floor(2_000_000 / line.length));
        const { input, ports } = fixture({ 'src/f.ts': big }, { 'src/f.ts': `${big}\n// x` });
        const t0 = performance.now();
        const d = await computeRunDelta(input, defaultDimensionRegistry(), ports);
        expect(performance.now() - t0).toBeLessThan(2000);
        // 37k markers per key aggregate into one finding per key and side; the count did not grow, so it persists.
        const agg = dim(d, 'quality').findings.filter((f) => f.ruleId === 'suppression-added');
        expect(agg.map((f) => [f.params['key'], f.params['aggregated'], f.lineage])).toEqual([['@ts-ignore', 1, 'persisting'], ['as any', 1, 'persisting']]);
        expect(agg[0]!.params['count']).toBeGreaterThan(30_000);
    }, 60_000);

    it('50 files × 2 MB complete within budget', async () => {
        const line = 'export function f(a: number): number { return a + 1; }\n';
        const before: Files = {}, after: Files = {};
        for (let i = 0; i < 50; i++) {
            const big = `${line.repeat(Math.floor(2_000_000 / line.length))}//${i}`;
            before[`src/f${i}.ts`] = big;
            after[`src/f${i}.ts`] = `${big}\n// x`;
        }
        const { input, ports } = fixture(before, after);
        const heap = () => (globalThis as { process?: { memoryUsage(): { heapUsed: number } } }).process?.memoryUsage().heapUsed ?? 0;
        const heap0 = heap();
        const t0 = performance.now();
        const d = await computeRunDelta(input, defaultDimensionRegistry(), ports);
        // 100 MB of source per side: linear passes only (the old quadratic line lookup took minutes on one file).
        expect(performance.now() - t0).toBeLessThan(45_000);
        expect(heap() - heap0).toBeLessThan(1_500_000_000);
        expect(d.impact.changedFiles).toHaveLength(50);
    }, 180_000);
});

describe('regression: #7 a thrown rule is not measured', () => {
    it('folds the dimension to not_comparable and blocks an autonomous run', async () => {
        const reg = defaultDimensionRegistry();
        const bad: DimensionRegistry = { ...reg, rules: reg.rules.map((r) => r.id === 'guard-removed' ? { ...r, derive: () => { throw new Error('x'); } } : r) };
        const d = await run({ 'api/r.ts': GUARDED }, { 'api/r.ts': UNGUARDED }, { mode: 'autonomous' }, bad);
        expect(dim(d, 'security').verdict).toBe('not_comparable');
        expect(dim(d, 'security').reasons).toEqual(expect.arrayContaining(['analyzer-failed:guard-removed', 'rule-failed']));
        expect(d.blocking).toEqual(['not-comparable:guard-removed']);
    });
});

describe('regression: #9 a run may not edit its own gate', () => {
    it('editing .builderforce/delta.json is a blocking delta-config-changed error', async () => {
        const d = await run({ '.builderforce/delta.json': '{"blocking":["guard-removed"]}' }, { '.builderforce/delta.json': '{"blocking":[]}' }, { mode: 'autonomous' });
        expect(dim(d, 'security').findings.find((f) => f.ruleId === 'delta-config-changed')).toMatchObject({ severity: 'error', confidence: 'measured', params: { change: 'edited' } });
        expect(d.blocking).toEqual(['delta-config-changed']);
    });
});

describe('regression: #10 global findings respect the attribution filter', () => {
    it('drops a whole-tree finding whose members all lie in outside-run files', async () => {
        const nodes = [srcRef('r', 'other/x.ts')];
        const f: SideFacts['findings'][number] = {
            identity: identityOf({ id: 'cycle:x', kind: 'cycle', pack: 'code', nodes, severity: 'warn', params: {} }), kind: 'cycle', severity: 'warn', nodes, params: {},
        };
        const d = await run({ 'other/x.ts': 'a\n', 'src/a.ts': 'a\n' }, { 'other/x.ts': 'b\n', 'src/a.ts': 'b\n' }, {
            attribution: { 'other/x.ts': 'outside-run' }, afterFacts: { findings: [f] },
        });
        expect(dim(d, 'ilities.maintainability').findings).toEqual([]);
    });
});

describe('regression: #12/#13 anchors, better, headline', () => {
    it('an unrelated edit on the same line keeps a state finding persisting (span anchor)', async () => {
        const d = await run({ 'src/s.ts': "const x = readFileSync('a'); const y = 1;\n" }, { 'src/s.ts': "const x = readFileSync('a'); const y = 2;\n" });
        expect(dim(d, 'performance').findings.map((f) => f.lineage)).toEqual(['persisting']);
    });

    it('an introduced info finding prevents better (C5: nothing introduced)', async () => {
        const before: Files = { 'api/r.ts': "const h = createHash('md5');\napp.get('/x', requireAuth, h);\n" };
        const resolvedOnly = await run(before, { 'api/r.ts': "app.get('/x', requireAuth, h);\n" });
        expect(dim(resolvedOnly, 'security').verdict).toBe('better');
        const withInfo = await run(before, { 'api/r.ts': '\n' });
        expect(ruleIds(withInfo, 'security')).toEqual(['entry-removed']);
        expect(dim(withInfo, 'security').verdict).toBe('same');
    });

    it('the not_comparable headline clause names the comparability reason, not the first alphabetical one', async () => {
        const d = await run({ 'a.ts': 'a\n' }, { 'a.ts': 'b\n' }, { beforeFacts: { meta: { tools: { jscpd: '1' } } }, afterFacts: { meta: { tools: { jscpd: '2' } } } });
        expect(dim(d, 'ilities.maintainability').reasons[0]).toBe('not-comparable');
        expect(d.summary.clauses.find((c) => c.dimension === 'ilities.maintainability')).toMatchObject({ code: 'tool-version-changed:jscpd' });
    });

    it('focus markers count only-added (fixture split so the skip guard ignores it)', async () => {
        const d = await run({ 'a.test.ts': "it('a', () => { expect(1).toBe(1); });\n" }, { 'a.test.ts': 'it' + ".only('a', () => { expect(1).toBe(1); });\n" });
        expect(ruleIds(d, 'quality')).toEqual(['only-added']);
    });
});
