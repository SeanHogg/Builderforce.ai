import { describe, expect, it } from 'vitest';
import type { RunDelta } from '../../contract.js';
import { computeRunDelta } from '../../engine/computeRunDelta.js';
import { DEFAULT_REGISTRIES, TEST_INTEGRITY_ERROR_RULES, TEST_INTEGRITY_RULES } from '../../registry/defaults.js';
import { defaultDimensionRegistry } from '../../registry/dimensions.js';
import { fixture, type Files, type FixtureOptions } from '../../testing/fixturePorts.js';

async function run(before: Files, after: Files, opts?: FixtureOptions): Promise<RunDelta> {
    const { input, ports } = fixture(before, after, opts);
    return computeRunDelta(input, defaultDimensionRegistry(), ports);
}
const quality = (d: RunDelta) => d.dimensions.find((x) => x.id === 'quality')!;
const fresh = (d: RunDelta, ruleId: string) => quality(d).findings.filter((f) => f.ruleId === ruleId && f.lineage === 'introduced');

describe('quality rules (C8.2, C8.3, WS9)', () => {
    it('catch-all-added: a new handler that neither rethrows nor reads the error', async () => {
        const d = await run(
            { 'src/q.ts': 'export async function q() { return g(); }\n' },
            { 'src/q.ts': 'export async function q() { try { return await g(); } catch (e) { return null; } }\nexport async function r() { try { return await g(); } catch (e) { throw wrap(e); } }\n' },
        );
        const found = fresh(d, 'catch-all-added');
        expect(found.map((f) => f.evidence[0]!.line)).toEqual([1]);
        expect(found[0]!.severity).toBe('warn');
    });

    it('catch-all-added: a handler passed by reference forwards the error; function(err) and destructured params read it', async () => {
        const after = [
            'export const a = () => p.catch(reportError);',
            'export const b = (next) => p.catch(next);',
            'export const c = () => p.catch(console.error);',
            'export const d = () => p.catch(function (err) { log(err); });',
            'export const e = () => p.catch(({ code }) => code === 404 ? null : 1);',
            'export const f = () => p.catch(function () { return null; });',
            'export function g() { try { h(); } catch ({ message }) { log(message); } }',
            '',
        ].join('\n');
        const d = await run({ 'src/c.ts': 'export {};\n' }, { 'src/c.ts': after });
        expect(fresh(d, 'catch-all-added').map((f) => f.evidence[0]!.line)).toEqual([6]);
    });

    it('§12.5: every C8.2 error rule blocks an autonomous run; catch-all-added is C8.2', () => {
        expect(TEST_INTEGRITY_RULES).toContain('catch-all-added');
        for (const id of ['test-deleted', 'test-skipped', 'only-added', 'assertions-reduced', 'matcher-weakened', 'assertion-edited-with-impl']) {
            expect(TEST_INTEGRITY_ERROR_RULES).toContain(id);
            expect(DEFAULT_REGISTRIES.blocking).toContain(id);
        }
    });

    it('out-of-scope-change (C8.3): files outside the plan, by exact path, folder and glob', async () => {
        const before: Files = { 'src/a/x.ts': 'a\n', 'src/b/y.ts': 'b\n', 'docs/n.md': 'n\n', 'lib/deep/z.test.ts': 'z\n', 'README.md': 'r\n' };
        const after: Files = { 'src/a/x.ts': 'a2\n', 'src/b/y.ts': 'b2\n', 'docs/n.md': 'n2\n', 'lib/deep/z.test.ts': 'z2\n', 'README.md': 'r2\n' };
        const d = await run(before, after, { plannedPaths: ['src/a/', 'docs/n.md', 'lib/**/*.test.ts'] });
        const found = fresh(d, 'out-of-scope-change');
        expect(found.map((f) => f.params['file']).sort()).toEqual(['README.md', 'src/b/y.ts']);
        expect(found.every((f) => f.confidence === 'measured' && f.severity === 'warn')).toBe(true);
    });

    it('out-of-scope-change is not measured without a plan (skipped, no-plan), never "no drift"', async () => {
        const d = await run({ 'src/a.ts': 'a\n' }, { 'src/a.ts': 'b\n' });
        expect(fresh(d, 'out-of-scope-change')).toEqual([]);
        expect(quality(d).measuredBy.find((m) => m.tool === 'out-of-scope-change')).toMatchObject({ status: 'skipped', reason: 'no-plan' });
    });
});
