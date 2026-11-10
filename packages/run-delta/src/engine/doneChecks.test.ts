/**
 * PRD 41 §8 Part C done-checks this pass can meet, as fixture runs through `computeRunDelta`.
 */

import { identityOf, srcRef } from '@seanhogg/builderforce-memory/knowledge';
import { describe, expect, it } from 'vitest';
import type { DimensionId, RunDelta, SideFacts } from '../contract.js';
import { defaultDimensionRegistry } from '../registry/dimensions.js';
import { fixture } from '../testing/fixturePorts.js';
import { computeRunDelta } from './computeRunDelta.js';

const dim = (d: RunDelta, id: DimensionId) => d.dimensions.find((x) => x.id === id)!;

function cloneFinding(id: string, files: string[]): SideFacts['findings'][number] {
    const nodes = files.map((f) => srcRef('r', f));
    const identity = identityOf({ id, kind: 'clone-group', pack: 'code', nodes, severity: 'warn', params: {}, anchor: 'cloneGroup:g1', anchorKind: 'group' });
    return { identity, kind: 'clone-group', severity: 'warn', nodes, params: { members: files.length } };
}

describe('PRD 41 Part C done-checks', () => {
    it('a clone group gaining a member reads as changed (grew), not resolved plus introduced', async () => {
        const { input, ports } = fixture({ 'src/c.ts': 'export const c = 1;\n' }, { 'src/c.ts': 'export const c = 2;\n' }, {
            beforeFacts: { findings: [cloneFinding('clone-group:ab', ['src/a.ts', 'src/b.ts'])] },
            afterFacts: { findings: [cloneFinding('clone-group:abc', ['src/a.ts', 'src/b.ts', 'src/c.ts'])] },
        });
        const delta = await computeRunDelta(input, defaultDimensionRegistry(), ports);
        const clone = dim(delta, 'ilities.maintainability').findings.filter((f) => f.ruleId === 'clone-group');
        expect(clone).toHaveLength(1);
        expect(clone[0]).toMatchObject({ lineage: 'changed', change: 'grew', confidence: 'measured' });
    });

    it('removing requireAuth from a route gives security worse with guard-removed and the route key in evidence', async () => {
        const before = "app.get('/api/projects/:id', requireAuth, async (c) => c.json(await load(c)));\n";
        const after = "app.get('/api/projects/:id', async (c) => c.json(await load(c)));\n";
        const { input, ports } = fixture({ 'api/routes.ts': before }, { 'api/routes.ts': after });
        const delta = await computeRunDelta(input, defaultDimensionRegistry(), ports);
        const security = dim(delta, 'security');
        expect(security.verdict).toBe('worse');
        expect(security.reasons).toContain('heuristic');
        const removed = security.findings.find((f) => f.ruleId === 'guard-removed')!;
        expect(removed).toMatchObject({ lineage: 'introduced', severity: 'error', params: { route: 'GET /api/projects/:id', guard: 'requireAuth' } });
        expect(removed.evidence.some((e) => e.note?.includes('GET /api/projects/:id'))).toBe(true);
        expect(delta.summary.clauses[0]).toMatchObject({ dimension: 'security', verdict: 'worse', code: 'guard-removed', count: 1 });
    });

    it('a guard inherited from app.use counts on the chain', async () => {
        const before = "app.use('/api/*', requireAuth);\napp.post('/api/x', async (c) => c.json(1));\n";
        const after = "app.post('/api/x', async (c) => c.json(1));\n";
        const { input, ports } = fixture({ 'api/x.ts': before }, { 'api/x.ts': after });
        const delta = await computeRunDelta(input, defaultDimensionRegistry(), ports);
        expect(dim(delta, 'security').findings.map((f) => f.ruleId)).toContain('guard-removed');
    });

    it('.skip added plus a loosened matcher gives quality worse and the "tests were weakened" headline', async () => {
        const before = [
            "describe('sum', () => {",
            "  it('adds', () => { expect(sum(1, 2)).toEqual(3); });",
            "  it('zero', () => { expect(sum(0, 0)).toEqual(0); });",
            '});',
        ].join('\n');
        const after = [
            "describe('sum', () => {",
            "  it" + ".skip('adds', () => { expect(sum(1, 2)).toEqual(3); });",
            "  it('zero', () => { expect(sum(0, 0)).toBeDefined(); });",
            '});',
        ].join('\n');
        const { input, ports } = fixture({ 'src/sum.test.ts': before }, { 'src/sum.test.ts': after });
        const delta = await computeRunDelta(input, defaultDimensionRegistry(), ports);
        const quality = dim(delta, 'quality');
        expect(quality.verdict).toBe('worse');
        expect(quality.reasons).toContain('tests-weakened');
        expect(quality.findings.filter((f) => f.lineage === 'introduced').map((f) => f.ruleId).sort()).toEqual(['matcher-weakened', 'test-skipped']);
        expect(delta.headline).toBe('worse');
        expect(delta.summary.clauses).toContainEqual({ dimension: 'quality', verdict: 'worse', code: 'tests-weakened', count: 2 });
    });

    it('an awaited DB call inside .map gives io-in-loop', async () => {
        const before = 'export async function load(ids: string[]) {\n  return db.select().from(users);\n}\n';
        const after = 'export async function load(ids: string[]) {\n  return Promise.all(ids.map(async (id) => await db.select().from(users).where(eq(users.id, id))));\n}\n';
        const { input, ports } = fixture({ 'api/load.ts': before }, { 'api/load.ts': after });
        const delta = await computeRunDelta(input, defaultDimensionRegistry(), ports);
        const perf = dim(delta, 'performance');
        const io = perf.findings.find((f) => f.ruleId === 'io-in-loop')!;
        expect(io).toMatchObject({ lineage: 'introduced', severity: 'warn', params: { loop: 'map' } });
        expect(perf.reasons).toContain('static-only');
    });

    it('a changed exported signature gives ilities.compatibility api-breaking', async () => {
        const { input, ports } = fixture(
            { 'lib/api.ts': 'export function total(a: string): number {\n  return 1;\n}\n' },
            { 'lib/api.ts': 'export function total(a: number, b: number): number {\n  return a + b;\n}\nexport const extra = 1;\n' },
        );
        const delta = await computeRunDelta(input, defaultDimensionRegistry(), ports);
        const compat = dim(delta, 'ilities.compatibility');
        expect(compat.verdict).toBe('worse');
        expect(compat.findings.find((f) => f.ruleId === 'api-breaking')).toMatchObject({ severity: 'error', params: { symbol: 'total', change: 'changed' } });
        expect(compat.findings.find((f) => f.ruleId === 'api-added')).toMatchObject({ severity: 'info', params: { symbol: 'extra' } });
    });

    it('a tool version bump between sides makes that kind not_comparable with no introduced or resolved entries', async () => {
        const { input, ports } = fixture({ 'src/c.ts': 'export const c = 1;\n' }, { 'src/c.ts': 'export const c = 2;\n' }, {
            beforeFacts: { findings: [cloneFinding('clone-group:old', ['src/c.ts', 'src/x.ts'])], meta: { tools: { jscpd: '4.0.0' } } },
            afterFacts: { findings: [cloneFinding('clone-group:new', ['src/c.ts', 'src/y.ts', 'src/z.ts'])], meta: { tools: { jscpd: '4.1.0' } } },
        });
        const delta = await computeRunDelta(input, defaultDimensionRegistry(), ports);
        const maint = dim(delta, 'ilities.maintainability');
        expect(maint.verdict).toBe('not_comparable');
        expect(maint.reasons).toContain('tool-version-changed:jscpd');
        const clone = maint.findings.filter((f) => f.ruleId === 'clone-group');
        expect(clone.some((f) => f.lineage === 'introduced' || f.lineage === 'resolved')).toBe(false);
        expect(clone).toHaveLength(1);
        expect(clone[0]).toMatchObject({ presentNow: true });
        // Content rules are not gated by that tool.
        expect(dim(delta, 'security').verdict).not.toBe('not_comparable');
    });
});
