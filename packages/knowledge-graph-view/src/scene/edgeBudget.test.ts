import { describe, expect, it } from 'vitest';
import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { edgeCaption, incidentOf, MAX_DRAWN_EDGES, pickEdges, rankEdges, rankTask } from './edgeBudget';
import { strideSample } from './stride';

const ref = (i: number) => `src:r::f${String(i).padStart(5, '0')}.ts`;
const node = (i: number, importance: number): KNode => ({ ref: ref(i) as KNode['ref'], kind: 'file', label: ref(i), pack: 'code', importance, origin: 'extracted' });
const edge = (a: number, b: number, extra: Partial<KEdge> = {}): KEdge => ({ from: ref(a) as KEdge['from'], to: ref(b) as KEdge['to'], kind: 'references', weight: 1, origin: 'extracted', ...extra });

const nodes = Array.from({ length: 200 }, (_, i) => node(i, 1 - i / 200));
const plain = Array.from({ length: 199 }, (_, i) => edge(i, i + 1));
const key = (e: KEdge) => `${e.from}>${e.to}`;

describe('strideSample', () => {
    it('takes every item under the cap, an even spread over it, and never repeats', () => {
        expect(strideSample([1, 2, 3], 5)).toEqual([1, 2, 3]);
        const s = strideSample(Array.from({ length: 100 }, (_, i) => i), 10);
        expect(s).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
        expect(strideSample([1, 2, 3], 0)).toEqual([]);
    });
});

describe('edge budget', () => {
    it('draws everything while it is under the cap', () => {
        const ranked = rankEdges(plain, nodes);
        expect(ranked.total).toBe(199);
        expect(pickEdges(ranked, null, 1000)).toHaveLength(199);
        expect(edgeCaption(199, 1000)).toEqual({ shown: 199, total: 199, capped: false });
    });

    it('puts the selected node\'s links first, then the rule-breaking and cyclic ones, then the most important', () => {
        const breaking = [edge(150, 151, { verdict: 'upward' }), edge(152, 153, { cycle: true })];
        const touching = edge(198, 199); // the only link of the last node
        const ranked = rankEdges([...plain, ...breaking], nodes);
        const picked = pickEdges(ranked, ref(199), 6).map(key);
        expect(picked[0]).toBe(key(touching));
        expect(picked.slice(1, 3).sort()).toEqual(breaking.map(key).sort());
        // The remaining slots go to the links between the most important nodes (the lowest indices).
        expect(picked.slice(3)).toContain(key(edge(0, 1)));
    });

    it('keeps every rule-breaking link visible until they alone fill the budget, then spreads them', () => {
        const many = Array.from({ length: 100 }, (_, i) => edge(i, (i + 1) % 200, { verdict: 'skips' }));
        const picked = pickEdges(rankEdges([...many, ...plain], nodes), null, 40);
        expect(picked).toHaveLength(40);
        expect(picked.every((e) => e.verdict === 'skips')).toBe(true);
    });

    it('draws every link of a selected node with more than 500 links, and never more than the budget', () => {
        const hub = Array.from({ length: 1200 }, (_, i) => node(i, 1 - i / 1200));
        const star = Array.from({ length: 1199 }, (_, i) => edge(1199, i)); // the least important node links to all others
        const around = Array.from({ length: 1199 }, (_, i) => edge(i, i + 1)); // the chain 0-1-...-1199, ending with (1198, 1199)
        const ranked = rankEdges([...star, ...around], hub);
        expect(incidentOf(ranked, ref(1199))).toHaveLength(1200); // 1,199 star links and the chain link (1198, 1199)
        const picked = pickEdges(ranked, ref(1199), 2000);
        expect(picked).toHaveLength(2000);
        expect(picked.filter((e) => e.from === ref(1199) || e.to === ref(1199))).toHaveLength(1200);
        // Over the budget, the selection fills it.
        const capped = pickEdges(ranked, ref(1199), 800);
        expect(capped).toHaveLength(800);
        expect(capped.every((e) => e.from === ref(1199) || e.to === ref(1199))).toBe(true);
    });

    it('fills the budget when the remainder is mostly the selection\'s own links', () => {
        const hub = Array.from({ length: 300 }, (_, i) => node(i, 1 - i / 300));
        const star = Array.from({ length: 299 }, (_, i) => edge(299, i));
        const others = Array.from({ length: 120 }, (_, i) => edge(i, i + 1));
        const ranked = rankEdges([...star, ...others], hub);
        // 419 links exist and the selection owns 299 of them.
        expect(ranked.total).toBe(419);
        const picked = pickEdges(ranked, ref(299), 400);
        expect(picked).toHaveLength(400);
        expect(new Set(picked).size).toBe(picked.length); // no link twice
        expect(picked.filter((e) => e.from === ref(299) || e.to === ref(299))).toHaveLength(299);
        // Under the budget everything is drawn, even though the rest is mostly the selection's links.
        expect(pickEdges(ranked, ref(299), 419)).toHaveLength(419);
    });

    it('ranks in steps to exactly the one-shot result, and refuses a result before the last step', () => {
        const dense: KEdge[] = [];
        for (let i = 0; i < 60; i++) for (let j = i + 1; j < 60; j++) dense.push(edge(i, j, j % 9 === 0 ? { cycle: true } : {}));
        const whole = rankEdges(dense, nodes);
        const task = rankTask(dense, nodes);
        expect(() => task.result()).toThrow(/before step/);
        let steps = 0;
        while (!task.step()) steps++;
        expect(steps).toBeGreaterThanOrEqual(3); // staged: no single step does the whole ranking
        const staged = task.result();
        expect(staged.total).toBe(whole.total);
        expect(staged.breaking.map(key)).toEqual(whole.breaking.map(key));
        expect(staged.rest.map(key)).toEqual(whole.rest.map(key));
        expect(staged.breaking.length).toBeGreaterThan(0);
    });

    it('orders ties in the canonical edge order (from, to, kind by ref order), whatever order they arrive in', () => {
        const same = [edge(5, 9), edge(5, 8), edge(4, 9), edge(5, 8, { kind: 'a-kind' })];
        const nodesFlat = Array.from({ length: 20 }, (_, i) => node(i, 0.5));
        const a = rankEdges(same, nodesFlat).rest.map((e) => `${key(e)}:${e.kind}`);
        const b = rankEdges([...same].reverse(), nodesFlat).rest.map((e) => `${key(e)}:${e.kind}`);
        expect(b).toEqual(a);
        expect(a[0]).toBe(`${key(edge(4, 9))}:references`);
    });

    it('coerces a NaN importance to 0 and still ranks', () => {
        const odd = [{ ...node(0, Number.NaN) }, node(1, 0.5), node(2, 0.9)];
        const ranked = rankEdges([edge(0, 1), edge(1, 2)], odd);
        expect(ranked.rest.map(key)).toEqual([key(edge(1, 2)), key(edge(0, 1))]);
    });

    it('caps at the budget', () => {
        const dense: KEdge[] = [];
        for (let i = 0; i < 200; i++) for (let j = i + 1; j < 200; j++) dense.push(edge(i, j));
        const ranked = rankEdges(dense, nodes);
        expect(ranked.total).toBe(dense.length);
        const picked = pickEdges(ranked, ref(7), 1000);
        expect(picked).toHaveLength(1000);
        expect(picked.filter((e) => e.from === ref(7) || e.to === ref(7))).toHaveLength(199);
        expect(new Set(picked).size).toBe(1000);
        expect(MAX_DRAWN_EDGES).toBe(15_000);
        expect(edgeCaption(113_975)).toEqual({ shown: 15_000, total: 113_975, capped: true });
    });

    it('skips a link whose end is not drawn', () => {
        expect(rankEdges([edge(1, 999)], nodes).total).toBe(0);
    });

    it('is deterministic and independent of the order edges arrive in', () => {
        const dense: KEdge[] = [];
        for (let i = 0; i < 100; i++) for (let j = i + 1; j < 100; j++) dense.push(edge(i, j));
        const a = pickEdges(rankEdges(dense, nodes), ref(3), 500).map(key);
        const b = pickEdges(rankEdges([...dense].reverse(), [...nodes].reverse()), ref(3), 500).map(key);
        expect(b).toEqual(a);
        expect(pickEdges(rankEdges(dense, nodes), ref(3), 500).map(key)).toEqual(a);
    });
});
