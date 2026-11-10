import { describe, expect, it } from 'vitest';
import type { DimensionId, RunDelta } from '../contract.js';
import { defaultDimensionRegistry } from '../registry/dimensions.js';
import { fixture, type Files } from '../testing/fixturePorts.js';
import { computeRunDelta } from './computeRunDelta.js';
import { digestOf } from './digest.js';

const dim = (d: RunDelta, id: DimensionId) => d.dimensions.find((x) => x.id === id)!;
const GUARDED = "app.get('/api/x', requireAuth, (c) => c.json(1));\n";
const UNGUARDED = "app.get('/api/x', (c) => c.json(1));\n";

describe('computeRunDelta', () => {
    it('lists every registered dimension, sorted, with not_measured / rule-not-built where no rule exists', async () => {
        const { input, ports } = fixture({ 'a.ts': 'export const a = 1;\n' }, { 'a.ts': 'export const a = 1; // same api\n' });
        const delta = await computeRunDelta(input, defaultDimensionRegistry(), ports);
        expect(delta.dimensions.map((d) => d.id)).toEqual([...delta.dimensions.map((d) => d.id)].sort());
        expect(delta.dimensions).toHaveLength(10);
        for (const id of ['ilities.functional-suitability', 'ilities.interaction-capability', 'ilities.reliability', 'ilities.flexibility'] as const) {
            expect(dim(delta, id)).toMatchObject({ verdict: 'not_measured', reasons: ['rule-not-built'] });
        }
        expect(dim(delta, 'security').verdict).toBe('same');
        expect(delta.summary.notMeasured).toHaveLength(4);
    });

    it('excludes outside-run files from the verdicts (attribution filter)', async () => {
        const { input, ports } = fixture({ 'api/r.ts': GUARDED }, { 'api/r.ts': UNGUARDED }, { attribution: { 'api/r.ts': 'outside-run' } });
        const delta = await computeRunDelta(input, defaultDimensionRegistry(), ports);
        expect(delta.excluded).toEqual([{ path: 'api/r.ts', reason: 'changed-outside-run' }]);
        expect(delta.impact.changedFiles).toEqual([]);
        expect(dim(delta, 'security').findings).toEqual([]);
        expect(dim(delta, 'security').verdict).toBe('same');
    });

    it('excludes a file whose before side is unresolved and records the reason', async () => {
        const { input, ports } = fixture({ 'api/r.ts': GUARDED }, { 'api/r.ts': UNGUARDED }, { unresolved: { 'api/r.ts': 'preimage-too-large' } });
        const delta = await computeRunDelta(input, defaultDimensionRegistry(), ports);
        expect(delta.excluded).toEqual([{ path: 'api/r.ts', reason: 'preimage-too-large' }]);
        expect(dim(delta, 'security').verdict).toBe('not_comparable');
        expect(dim(delta, 'security').reasons).toContain('before-unresolved');
    });

    it('head-switched makes every dimension not_comparable', async () => {
        const { input, ports } = fixture({ 'api/r.ts': GUARDED }, { 'api/r.ts': UNGUARDED }, { headSwitched: true });
        const delta = await computeRunDelta(input, defaultDimensionRegistry(), ports);
        for (const d of delta.dimensions) expect(d).toMatchObject({ verdict: 'not_comparable', reasons: ['head-switched'], findings: [] });
        expect(delta.headline).toBe('not_comparable');
        expect(delta.summary.clauses.every((c) => c.code === 'head-switched')).toBe(true);
    });

    it('matches a rename so unchanged findings persist across it', async () => {
        const body = "import { x } from './x';\nexport function handler(a: string) {\n  return fetch(a);\n}\n";
        const { input, ports } = fixture({ 'old/h.ts': body }, { 'new/h.ts': body });
        const delta = await computeRunDelta(input, defaultDimensionRegistry(), ports);
        expect(delta.impact.renamed).toEqual([{ from: 'old/h.ts', to: 'new/h.ts' }]);
        expect(delta.impact.changedFiles).toEqual(['new/h.ts']);
        const caps = dim(delta, 'security').findings.filter((f) => f.ruleId === 'capability-added');
        expect(caps.map((f) => f.lineage)).toEqual(['persisting']);
        expect(dim(delta, 'ilities.compatibility').findings).toEqual([]);
    });

    describe('autonomous block policy (§12.5)', () => {
        it('guard-removed lands in blocking for an autonomous run', async () => {
            const { input, ports } = fixture({ 'api/r.ts': GUARDED }, { 'api/r.ts': UNGUARDED }, { mode: 'autonomous' });
            const delta = await computeRunDelta(input, defaultDimensionRegistry(), ports);
            expect(delta.blocking).toEqual(['guard-removed']);
        });

        it('blocking is empty for an interactive run', async () => {
            const { input, ports } = fixture({ 'api/r.ts': GUARDED }, { 'api/r.ts': UNGUARDED }, { mode: 'interactive' });
            const delta = await computeRunDelta(input, defaultDimensionRegistry(), ports);
            expect(dim(delta, 'security').verdict).toBe('worse');
            expect(delta.blocking).toEqual([]);
        });
    });

    describe('digest', () => {
        const before: Files = {
            'api/r.ts': GUARDED,
            'src/a.test.ts': "it('a', () => { expect(a()).toEqual(1); });\n",
            'lib/api.ts': 'export function f(a: string) {\n  return a;\n}\n',
        };
        const after: Files = {
            'api/r.ts': UNGUARDED,
            'src/a.test.ts': "it.skip('a', () => { expect(a()).toEqual(1); });\n",
            'lib/api.ts': 'export function f(a: number) {\n  return a;\n}\n',
            'lib/new.ts': 'export const n = 1;\n',
        };
        const crlf = (files: Files): Files => Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v?.replace(/\n/g, '\r\n')]));
        const factsOpts = (order: 1 | -1) => {
            const imports = [['api/r.ts', ['lib/api.ts', 'lib/new.ts']], ['lib/api.ts', []], ['src/a.test.ts', ['api/r.ts']]] as const;
            const list = order === 1 ? [...imports] : [...imports].reverse();
            return { imports: new Map(list.map(([k, v]) => [k, order === 1 ? [...v] : [...v].reverse()])) };
        };

        it('is the same for shuffled inputs and CRLF vs LF texts, and ignores a narrative', async () => {
            const a = fixture(before, after, { beforeFacts: factsOpts(1), afterFacts: factsOpts(1), churn: { 'api/r.ts': 3 }, pastScores: [1, 2, 3, 4, 5, 6] });
            const b = fixture(crlf(before), crlf(after), { beforeFacts: factsOpts(-1), afterFacts: factsOpts(-1), churn: { 'api/r.ts': 3 }, pastScores: [6, 5, 4, 3, 2, 1] });
            b.input.files.reverse();
            const da = await computeRunDelta(a.input, defaultDimensionRegistry(), a.ports);
            const db = await computeRunDelta(b.input, defaultDimensionRegistry(), b.ports);
            expect(db.digest).toBe(da.digest);
            expect(db).toEqual(da);
            const { digest: _d, ...body } = da;
            expect(digestOf({ ...body, narrative: { text: 'any', model: 'm', inputDigest: 'x' } })).toBe(da.digest);
            expect(da.digest).toMatch(/^[0-9a-f]{64}$/);
        });

        it('changes when a verdict-bearing fact changes', async () => {
            const a = fixture(before, after);
            const b = fixture(before, { ...after, 'api/r.ts': GUARDED });
            const da = await computeRunDelta(a.input, defaultDimensionRegistry(), a.ports);
            const db = await computeRunDelta(b.input, defaultDimensionRegistry(), b.ports);
            expect(db.digest).not.toBe(da.digest);
        });
    });
});
