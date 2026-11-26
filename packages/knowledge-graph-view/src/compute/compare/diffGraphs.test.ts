import { describe, expect, it } from 'vitest';
import type { KEdge, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { surfaceFixture } from '../../testing';
import { diffGraphs, diffKindOf } from './diffGraphs';

const ref = (path: string) => `src:sys::${path}`;
const edge = (from: string, to: string, kind = 'references'): KEdge =>
    ({ from: ref(from) as KEdge['from'], to: ref(to) as KEdge['to'], kind, weight: 1, origin: 'extracted' });
const clone = (g: KnowledgeGraph): KnowledgeGraph => structuredClone(g);

describe('diffGraphs (PRD 43 C5)', () => {
    it('identical graphs differ in nothing', () => {
        const g = surfaceFixture();
        expect(diffGraphs(g, clone(g))).toEqual({ added: [], removed: [], changed: [], edgesAdded: [], edgesRemoved: [] });
    });

    it('a node only in after is added, only in before is removed; both lists are sorted', () => {
        const before = surfaceFixture();
        const after = clone(before);
        const gone = after.nodes.filter((n) => n.kind === 'file').slice(-2);
        after.nodes = after.nodes.filter((n) => !gone.includes(n));
        after.edges = after.edges.filter((e) => !gone.some((n) => n.ref === e.from || n.ref === e.to));
        after.nodes.push({ ...gone[0]!, ref: ref('z/new.ts') as never }, { ...gone[0]!, ref: ref('a/new.ts') as never });
        const d = diffGraphs(before, after);
        expect(d.removed).toEqual(gone.map((n) => n.ref).sort());
        expect(d.added).toEqual([ref('a/new.ts'), ref('z/new.ts')]);
    });

    it('a node in both is changed by its badges, its sourceHash, its findings or its incident edges', () => {
        const before = surfaceFixture();
        const badges = clone(before); badges.nodes.find((n) => n.ref === ref('api/useCase.ts'))!.badges = { complexity: 99 };
        expect(diffGraphs(before, badges).changed).toEqual([ref('api/useCase.ts')]);

        const hash = clone(before); hash.nodes.find((n) => n.ref === ref('web/page.tsx'))!.sourceHash = 'other';
        expect(diffGraphs(before, hash).changed).toEqual([ref('web/page.tsx')]);

        const found = clone(before); found.findings = found.findings.filter((f) => f.kind !== 'clone-group');
        expect(diffGraphs(before, found).changed).toEqual([ref('api/routes.ts'), ref('db/repo.ts')]);

        const wired = clone(before); wired.edges.push(edge('web/main.tsx', 'db/repo.ts'));
        const d = diffGraphs(before, wired);
        expect(d.changed).toEqual([ref('db/repo.ts'), ref('web/main.tsx')]);
        expect(d.edgesAdded).toEqual([[ref('web/main.tsx'), ref('db/repo.ts')]]);
        expect(d.edgesRemoved).toEqual([]);
    });

    it('badge key order alone is not a change', () => {
        const before = surfaceFixture(), after = clone(before);
        const n = after.nodes.find((x) => x.ref === ref('api/useCase.ts'))!;
        n.badges = Object.fromEntries(Object.entries(n.badges!).reverse());
        expect(diffGraphs(before, after).changed).toEqual([]);
    });

    it('edges removed are listed, deduped by pair, sorted', () => {
        const before = surfaceFixture(), after = clone(before);
        after.edges = after.edges.filter((e) => !(e.from === ref('cron/job.ts')));
        const d = diffGraphs(before, after);
        expect(d.edgesRemoved).toEqual([[ref('cron/job.ts'), ref('api/useCase.ts')]]);
        expect(d.changed).toEqual([ref('api/useCase.ts'), ref('cron/job.ts')]);
    });

    it('diffKindOf: the before side shows removed, the after side added, both show changed', () => {
        const d = { added: ['a'], removed: ['r'], changed: ['c'], edgesAdded: [], edgesRemoved: [] };
        expect([...diffKindOf(d, 'before')]).toEqual([['r', 'removed'], ['c', 'changed']]);
        expect([...diffKindOf(d, 'after')]).toEqual([['a', 'added'], ['c', 'changed']]);
    });
});
