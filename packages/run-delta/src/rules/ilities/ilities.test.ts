import { describe, expect, it } from 'vitest';
import type { DimensionId, RunDelta } from '../../contract.js';
import { computeRunDelta } from '../../engine/computeRunDelta.js';
import { defaultDimensionRegistry } from '../../registry/dimensions.js';
import { fixture, type Files, type FixtureOptions } from '../../testing/fixturePorts.js';

async function run(before: Files, after: Files, opts?: FixtureOptions): Promise<RunDelta> {
    const { input, ports } = fixture(before, after, opts);
    return computeRunDelta(input, defaultDimensionRegistry(), ports);
}
const dim = (d: RunDelta, id: DimensionId) => d.dimensions.find((x) => x.id === id)!;
const fresh = (d: RunDelta, id: DimensionId, ruleId: string) => dim(d, id).findings.filter((f) => f.lineage === 'introduced' && f.ruleId === ruleId);
const keys = (d: RunDelta, id: DimensionId, ruleId: string) => fresh(d, id, ruleId).map((f) => String(f.params['key'])).sort();

describe('-ilities rules (C7, WS9)', () => {
    it('untested-change: a code change no changed test imports; a comment-only change does not count', async () => {
        const test = (n: number) => `import { n } from './n';\nit('n', () => { expect(n).toBe(${n}); });\n`;
        const d = await run(
            { 'src/m.ts': 'export const m = 1;\n', 'src/n.ts': 'export const n = 1;\n', 'src/n.test.ts': test(1), 'src/o.ts': 'export const o = 1;\n' },
            { 'src/m.ts': 'export const m = 2;\n', 'src/n.ts': 'export const n = 2;\n', 'src/n.test.ts': test(2), 'src/o.ts': 'export const o = 1; // note\n' },
        );
        expect(fresh(d, 'ilities.functional-suitability', 'untested-change').map((f) => f.params['file'])).toEqual(['src/m.ts']);
        expect(dim(d, 'ilities.functional-suitability').verdict).toBe('same'); // one introduced warn
    });

    it('env-var-added and env-var-removed (both info) over the changed files', async () => {
        const d = await run(
            { 'src/e.ts': 'export const a = process.env.OLD_KEY;\nexport const b = env.KEEP;\n' },
            { 'src/e.ts': "export const a = process.env['NEW_KEY'];\nexport const b = env.KEEP;\n" },
        );
        expect(fresh(d, 'ilities.compatibility', 'env-var-added').map((f) => [f.params['name'], f.severity])).toEqual([['NEW_KEY', 'info']]);
        expect(fresh(d, 'ilities.compatibility', 'env-var-removed').map((f) => [f.params['name'], f.severity])).toEqual([['OLD_KEY', 'info']]);
    });

    it('engines-changed when package.json engines differ', async () => {
        const d = await run({ 'package.json': '{"name":"x","engines":{"node":">=18"}}\n' }, { 'package.json': '{"name":"x","engines":{"node":">=20"}}\n' });
        expect(fresh(d, 'ilities.compatibility', 'engines-changed').map((f) => [f.params['before'], f.params['after']])).toEqual([['node >=18', 'node >=20']]);
    });

    it('route-schema-changed when a route validator schema declaration changes', async () => {
        const route = "app.post('/api/x', zValidator('json', Body), h);\n";
        const d = await run(
            { 'api/r.ts': `const Body = z.object({ a: z.string() });\n${route}app.get('/api/y', h);\n` },
            { 'api/r.ts': `const Body = z.object({ a: z.number() });\n${route}app.get('/api/y', h);\n` },
        );
        expect(fresh(d, 'ilities.compatibility', 'route-schema-changed').map((f) => f.params['route'])).toEqual(['POST /api/x']);
    });

    it('a11y-violation: img alt, input label, clickable div role, unnamed button', async () => {
        const d = await run(
            { 'src/A.tsx': 'export const A = () => null;\n' },
            { 'src/A.tsx': 'export const A = () => <div onClick={go}><img src="a.png" /><input /><label>Name <input /></label><button><Icon /></button><button>Save</button></div>;\n' },
        );
        expect(keys(d, 'ilities.interaction-capability', 'a11y-violation')).toEqual(['button-name', 'click-role', 'img-alt', 'input-label']);
        expect(dim(d, 'ilities.interaction-capability').verdict).toBe('worse');
    });

    it('catch-swallowed: an empty catch clause and an empty .catch handler', async () => {
        const d = await run(
            { 'src/c.ts': 'export async function f() { await g(); }\n' },
            { 'src/c.ts': 'export async function f() { try { await g(); } catch { /* ignore */ } p.catch(() => {}); try { h(); } catch (e) { log(e); } }\n' },
        );
        expect(keys(d, 'ilities.reliability', 'catch-swallowed')).toEqual(['.catch', 'catch']);
    });

    it('floating-promise: a bare fetch and an unhandled .then; void, await, return and assignment are not', async () => {
        const after = [
            'export function f() {',
            "  fetch('/x');",
            '  load().then(use);',
            "  void fetch('/y');",
            "  const r = fetch('/z');",
            '  load().then(use).catch(report);',
            '  return load().then(use);',
            '}',
            '',
        ].join('\n');
        const d = await run({ 'src/f.ts': 'export {};\n' }, { 'src/f.ts': after });
        expect(keys(d, 'ilities.reliability', 'floating-promise')).toEqual(['fetch', 'then']);
    });

    it('error-handling-removed when a file loses a catch', async () => {
        const d = await run(
            { 'src/h.ts': 'export async function h() { try { await g(); } catch (e) { log(e); } }\n' },
            { 'src/h.ts': 'export async function h() { await g(); }\n' },
        );
        expect(fresh(d, 'ilities.reliability', 'error-handling-removed').map((f) => [f.params['before'], f.params['after']])).toEqual([[1, 0]]);
    });

    it('timeout-retry-changed: a removed timeout is a warning, an added backoff is info', async () => {
        const d = await run(
            { 'src/t.ts': 'export const t = () => call({ timeoutMs: 5000, maxRetries: 3 });\n' },
            { 'src/t.ts': 'export const t = () => { setTimeout(x, 1); return call({ maxRetries: 3, backoff: 2 }); };\n' },
        );
        expect(fresh(d, 'ilities.reliability', 'timeout-retry-changed').map((f) => [f.params['name'], f.params['change'], f.severity]))
            .toEqual([['backoff', 'added', 'info'], ['timeoutMs', 'removed', 'warn']]);
    });

    it('process-exit in library code, not in a CLI entry or a #! executable', async () => {
        const body = 'export function die() { process.exit(1); }\n';
        const d = await run(
            { 'src/lib.ts': 'export {};\n', 'bin/cli.ts': 'export {};\n', 'src/run.ts': 'export {};\n' },
            { 'src/lib.ts': body, 'bin/cli.ts': body, 'src/run.ts': `#!/usr/bin/env node\n${body}` },
        );
        expect(fresh(d, 'ilities.reliability', 'process-exit').map((f) => f.params['file'])).toEqual(['src/lib.ts']);
    });

    it('platform-specific-api: drive paths, POSIX paths and shell, backslash separators', async () => {
        const after = String.raw`export const a = 'C:\\temp';
export const b = '/tmp/x';
export const c = (s) => s.split('\\');
export const d = () => execSync('rm -rf out');
// '/tmp/in-a-comment'
`;
        const d = await run({ 'src/p.ts': 'export {};\n' }, { 'src/p.ts': after });
        expect(keys(d, 'ilities.flexibility', 'platform-specific-api')).toEqual(['backslash-separator', 'posix-path', 'posix-shell', 'windows-path']);
    });

    it('node-only-import: any builtin in browser code, only unsupported builtins in Worker code', async () => {
        const d = await run(
            { 'src/w.client.ts': 'export {};\n', 'workers/api.ts': 'export {};\n' },
            {
                'src/w.client.ts': "import fs from 'node:fs';\nimport type { X } from 'path';\n",
                'workers/api.ts': "import { exec } from 'child_process';\nimport path from 'node:path';\n",
            },
        );
        expect(keys(d, 'ilities.flexibility', 'node-only-import')).toEqual(['browser:fs', 'worker:child_process']);
    });

    it('untested-change: an alias import touches; an npm package never does; config, scripts and type-only modules are skipped', async () => {
        const test = (n: number) => `import { a } from '@/lib/a';\nimport { b } from 'b';\nit('a', () => { expect(a + b).toBe(${n}); });\n`;
        const d = await run(
            {
                'src/lib/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 1;\n', 'a.test.ts': test(1),
                'vite.config.ts': 'export default { a: 1 };\n', 'scripts/gen.ts': 'export const g = 1;\n', 'src/types.ts': 'export type T = string;\n',
                'src/shapes.ts': 'export interface S { a: string }\n',
            },
            {
                'src/lib/a.ts': 'export const a = 2;\n', 'src/b.ts': 'export const b = 2;\n', 'a.test.ts': test(3),
                'vite.config.ts': 'export default { a: 2 };\n', 'scripts/gen.ts': 'export const g = 2;\n', 'src/types.ts': 'export type T = number;\n',
                'src/shapes.ts': 'export interface S { a: number }\n',
            },
        );
        expect(fresh(d, 'ilities.functional-suitability', 'untested-change').map((f) => f.params['file'])).toEqual(['src/b.ts']);
    });

    it('floating-promise: a two-arg .then handles; a property value is held; semicolon-free statements are read by ASI', async () => {
        const after = [
            'export function f() {',
            '  load().then(ok, fail);',
            '  const o = { a: load().then(use), b: 1 };',
            '  init()',
            '  fetch(url)',
            '  load().then(use)',
            '  return o',
            '}',
            '',
        ].join('\n');
        const d = await run({ 'src/f.ts': 'export {};\n' }, { 'src/f.ts': after });
        expect(keys(d, 'ilities.reliability', 'floating-promise')).toEqual(['fetch', 'then']);
        expect(fresh(d, 'ilities.reliability', 'floating-promise').map((f) => f.evidence[0]!.line).sort()).toEqual([5, 6]);
    });

    it('a11y-violation: a string VALUE naming an attribute is not that attribute', async () => {
        const d = await run({ 'src/I.tsx': 'export const I = () => null;\n' }, { 'src/I.tsx': 'export const I = () => <img title="alt aria-label" src="a.png" />;\n' });
        expect(keys(d, 'ilities.interaction-capability', 'a11y-violation')).toEqual(['img-alt']);
    });

    it('coupling.efferent reads the import facts of the changed files; no facts on either side emits no metric', async () => {
        const d = await run({ 'src/a.ts': 'export const a = 1;\n' }, { 'src/a.ts': 'export const a = 2;\n' }, {
            beforeFacts: { imports: new Map([['src/a.ts', ['src/b.ts']]]) },
            afterFacts: { imports: new Map([['src/a.ts', ['src/b.ts', 'src/c.ts', 'src/d.ts']]]) },
        });
        expect(dim(d, 'ilities.maintainability').metrics.find((m) => m.metricId === 'coupling.efferent')).toMatchObject({ before: 1, after: 3 });
        const none = await run({ 'src/a.ts': 'export const a = 1;\n' }, { 'src/a.ts': 'export const a = 2;\n' });
        expect(dim(none, 'ilities.maintainability').metrics.find((m) => m.metricId === 'coupling.efferent')).toBeUndefined();
    });

    it('coupling: Ce is the max per changed file (not a sum); Ca and instability from reverse edges', async () => {
        const files = { 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 1;\n' };
        const d = await run(files, { 'src/a.ts': 'export const a = 2;\n', 'src/b.ts': 'export const b = 2;\n' }, {
            beforeFacts: { imports: new Map([['src/a.ts', ['src/x.ts']], ['src/b.ts', ['src/x.ts']], ['src/u.ts', ['src/a.ts']]]) },
            afterFacts: { imports: new Map([['src/a.ts', ['src/x.ts', 'src/y.ts']], ['src/b.ts', ['src/x.ts']], ['src/u.ts', ['src/a.ts']], ['src/v.ts', ['src/a.ts']]]) },
        });
        const m = (id: string) => dim(d, 'ilities.maintainability').metrics.find((x) => x.metricId === id);
        expect(m('coupling.efferent')).toMatchObject({ before: 1, after: 2 }); // max(1, 1) → max(2, 1), never 2 → 3
        expect(m('coupling.afferent')).toMatchObject({ before: 1, after: 2 });
        // b: Ce 1, Ca 0 → I = 1.00 on both sides (the max).
        expect(m('coupling.instability')).toMatchObject({ before: 100, after: 100, step: 0.01 });
    });

    it('hotspot.touched is churn × complexity of the riskiest changed file; no churn emits no row', async () => {
        const badges = (c: number) => new Map([['src/a.ts', { complexity: c }]]);
        const d = await run({ 'src/a.ts': 'a\n' }, { 'src/a.ts': 'b\n' }, { churn: { 'src/a.ts': 12 }, beforeFacts: { badges: badges(5) }, afterFacts: { badges: badges(15) } });
        expect(dim(d, 'ilities.maintainability').metrics.find((x) => x.metricId === 'hotspot.touched')).toMatchObject({ before: 60, after: 180 });
        expect(dim(d, 'ilities.maintainability').verdict).toBe('worse'); // +200% is past the 100% error threshold
        const noChurn = await run({ 'src/a.ts': 'a\n' }, { 'src/a.ts': 'b\n' }, { beforeFacts: { badges: badges(5) }, afterFacts: { badges: badges(15) } });
        expect(dim(noChurn, 'ilities.maintainability').metrics.find((x) => x.metricId === 'hotspot.touched')).toBeUndefined();
    });

    it('with the built-in registry none of the four once-empty ilities dimensions reports rule-not-built', async () => {
        const d = await run({ 'a.ts': 'export const a = 1;\n' }, { 'a.ts': 'export const a = 1; // same api\n' });
        for (const id of ['ilities.functional-suitability', 'ilities.interaction-capability', 'ilities.reliability', 'ilities.flexibility'] as const) {
            expect(dim(d, id).reasons).not.toContain('rule-not-built');
            expect(dim(d, id).verdict).not.toBe('not_measured');
        }
    });
});
