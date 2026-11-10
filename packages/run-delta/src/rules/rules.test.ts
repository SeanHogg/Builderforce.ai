import { describe, expect, it } from 'vitest';
import type { DimensionId, RunDelta } from '../contract.js';
import { computeRunDelta } from '../engine/computeRunDelta.js';
import { defaultDimensionRegistry } from '../registry/dimensions.js';
import { fixture, type Files, type FixtureOptions } from '../testing/fixturePorts.js';

async function run(before: Files, after: Files, opts?: FixtureOptions): Promise<RunDelta> {
    const { input, ports } = fixture(before, after, opts);
    return computeRunDelta(input, defaultDimensionRegistry(), ports);
}
const introduced = (d: RunDelta, id: DimensionId) =>
    d.dimensions.find((x) => x.id === id)!.findings.filter((f) => f.lineage === 'introduced').map((f) => f.ruleId).sort();
const metric = (d: RunDelta, id: string) => d.dimensions.flatMap((x) => x.metrics).find((m) => m.metricId === id)!;

describe('security rules', () => {
    it('guard-weakened when a stronger guard is replaced by a weaker one; entry-added / entry-removed', async () => {
        const d = await run(
            { 'api/r.ts': "app.post('/api/admin', requireSuperadmin, h);\napp.get('/api/old', requireAuth, h);\n" },
            { 'api/r.ts': "app.post('/api/admin', requireAuth, h);\napp.get('/api/new', requireAuth, h);\nmap.get('/not-a-route');\n" },
        );
        expect(introduced(d, 'security')).toEqual(['entry-added', 'entry-removed', 'guard-weakened']);
        const weak = d.dimensions.find((x) => x.id === 'security')!.findings.find((f) => f.ruleId === 'guard-weakened')!;
        expect(weak.params).toMatchObject({ route: 'POST /api/admin', guard: 'requireSuperadmin', replacement: 'requireAuth' });
    });

    it('capability-added once per capability; a route word in a comment is ignored', async () => {
        const d = await run(
            { 'src/a.ts': '// app.get("/x", h)\nexport const a = 1;\n' },
            { 'src/a.ts': "import { exec } from 'node:child_process';\nexport const a = process.env.A ?? exec('ls');\nconst b = process.env.B;\n" },
        );
        expect(introduced(d, 'security')).toEqual(['capability-added', 'capability-added']);
        expect(d.dimensions.find((x) => x.id === 'security')!.verdict).toBe('worse'); // two introduced warns
    });

    it('weak-crypto and secret-added are errors; the secret never appears in the delta', async () => {
        const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
        const d = await run(
            { 'src/h.ts': 'export const h = 1;\n' },
            { 'src/h.ts': `export const h = createHash('md5').update(x).digest('hex');\nconst t = '${token}';\n` },
        );
        expect(introduced(d, 'security')).toEqual(['secret-added', 'weak-crypto']);
        expect(JSON.stringify(d)).not.toContain(token);
    });
});

describe('performance rules', () => {
    it('sync-io in non-test code; an await outside a loop is not io-in-loop', async () => {
        const d = await run(
            { 'src/p.ts': 'export async function p() { return 1; }\n' },
            { 'src/p.ts': "import { readFileSync } from 'node:fs';\nexport async function p() { const x = readFileSync('a'); return await db.query(x); }\nfor (const i of xs) { await fetch(i); }\n" },
        );
        expect(introduced(d, 'performance')).toEqual(['io-in-loop', 'sync-io']);
    });
});

describe('quality rules (C8.2) and metrics (C8.1)', () => {
    it('test-deleted, only-added, assertions-reduced, timeout-raised, suppression-added', async () => {
        const d = await run(
            { 'a.test.ts': "it('one', () => { expect(1).toBe(1); expect(2).toBe(2); });\nit('two', () => { expect(2).toBe(2); });\nit('three', () => { expect(3).toBe(3); });\n" },
            { 'a.test.ts': "it.only('one', () => { expect(1).toBe(1); });\nit('three', () => { // @ts-ignore\n expect(3).toBe(3); }, 30000);\n" },
        );
        expect(introduced(d, 'quality')).toEqual(['assertions-reduced', 'only-added', 'suppression-added', 'test-deleted', 'timeout-raised']);
        expect(d.dimensions.find((x) => x.id === 'quality')!.verdict).toBe('worse');
    });

    it('a test moved to another changed test file is not deleted', async () => {
        const t = "it('moves', () => { expect(1).toBe(1); });\n";
        const d = await run({ 'a.test.ts': t, 'b.test.ts': "it('x', () => { expect(0).toBe(0); });\n" }, { 'a.test.ts': '\n', 'b.test.ts': `${t}it('x', () => { expect(0).toBe(0); });\n` });
        expect(introduced(d, 'quality')).toEqual([]);
    });

    it('assertion-edited-with-impl and snapshot-updated-with-impl need an implementation change', async () => {
        const before: Files = { 'sum.test.ts': "it('s', () => { expect(sum(1, 1)).toBe(2); });\n", '__snapshots__/s.snap': 'a', 'sum.ts': 'export const sum = (a: number, b: number) => a + b;\n' };
        const after: Files = { 'sum.test.ts': "it('s', () => { expect(sum(1, 1)).toBe(3); });\n", '__snapshots__/s.snap': 'b', 'sum.ts': 'export const sum = (a: number, b: number) => a + b + 1;\n' };
        expect(introduced(await run(before, after), 'quality')).toEqual(['assertion-edited-with-impl', 'snapshot-updated-with-impl']);
        expect(introduced(await run(before, { ...after, 'sum.ts': before['sum.ts'] }), 'quality')).toEqual([]);
    });

    it('todo.added and any-cast.added count; complexity is not measured without badges', async () => {
        const d = await run({ 'x.ts': 'export const x = 1;\n' }, { 'x.ts': '// TODO: later\nexport const x = (y as any) as unknown;\n' });
        expect(metric(d, 'todo.added')).toMatchObject({ before: 0, after: 1 });
        expect(metric(d, 'any-cast.added')).toMatchObject({ before: 0, after: 2 });
        expect(metric(d, 'complexity.max')).toMatchObject({ before: null, after: null });
        expect(d.dimensions.find((x) => x.id === 'quality')!.reasons).toContain('metric-not-measured');
    });

    it('complexity metrics read the side badges', async () => {
        const d = await run({ 'x.ts': 'a\n' }, { 'x.ts': 'b\n' }, {
            beforeFacts: { badges: new Map([['x.ts', { complexity: 4, maxComplexity: 2 }]]) },
            afterFacts: { badges: new Map([['x.ts', { complexity: 40, maxComplexity: 15 }]]) },
        });
        expect(metric(d, 'complexity.sum')).toMatchObject({ before: 4, after: 40 });
        expect(d.dimensions.find((x) => x.id === 'quality')!.verdict).toBe('worse');
    });
});

describe('ilities rules', () => {
    it('god-file-growth, destructive-ddl, force-push, rm-rf', async () => {
        const big = 'export const a = 1;\n'.repeat(401);
        const d = await run(
            { 'big.ts': 'export const a = 1;\n', 'migrations/0002.sql': '-- DROP TABLE old;\n', 'scripts/ship.sh': 'echo hi\n' },
            { 'big.ts': big, 'migrations/0002.sql': '-- DROP TABLE old;\nALTER TABLE t DROP COLUMN c;\n', 'scripts/ship.sh': 'rm -rf dist\ngit push --force origin main\n' },
        );
        expect(introduced(d, 'ilities.maintainability')).toEqual(['god-file-growth']);
        expect(introduced(d, 'ilities.safety')).toEqual(['destructive-ddl', 'force-push', 'rm-rf']);
        expect(d.dimensions.find((x) => x.id === 'ilities.safety')!.verdict).toBe('worse');
    });

    it('an interface gaining a member is not breaking; losing one is', async () => {
        const d1 = await run({ 'i.ts': 'export interface I {\n  a: string;\n}\n' }, { 'i.ts': 'export interface I {\n  a: string;\n  b?: number;\n}\n' });
        expect(introduced(d1, 'ilities.compatibility')).toEqual([]);
        const d2 = await run({ 'i.ts': 'export interface I {\n  a: string;\n  b: number;\n}\nexport type T = "x" | "y";\n' }, { 'i.ts': 'export interface I {\n  a: string;\n}\nexport type T = "x";\n' });
        expect(introduced(d2, 'ilities.compatibility')).toEqual(['api-breaking', 'api-breaking']);
    });
});
