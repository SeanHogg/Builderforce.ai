import { describe, expect, it, vi } from 'vitest';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { groupAntiPatterns } from './antiPatternGroups';
import { APPLY_CONCURRENCY, applyAntiPatterns, mapBounded } from './antiPatternApply';

const unused = (i: number): Finding => ({ id: `u${i}`, kind: 'unused-export', pack: 'code', nodes: [`src:sys::f${i}.ts` as Finding['nodes'][number]], severity: 'info', params: {} });
const source = (applyFix: (f: Finding) => Promise<{ changed: string[] }>) => ({ scopes: async () => [], load: async () => null, applyFix });

describe('mapBounded', () => {
    it('never has more than the limit in flight, keeps results in item order, and runs every item', async () => {
        let inFlight = 0, peak = 0;
        const out = await mapBounded([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], APPLY_CONCURRENCY, async (n) => {
            peak = Math.max(peak, ++inFlight);
            await new Promise((r) => setTimeout(r, 2));
            inFlight--;
            return n * 2;
        });
        expect(peak).toBeLessThanOrEqual(APPLY_CONCURRENCY);
        expect(peak).toBeGreaterThan(1);
        expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    });

    it('stops starting new items once stopped, letting the ones in flight finish', async () => {
        let started = 0;
        const out = await mapBounded(Array.from({ length: 20 }, (_, i) => i), 2, async (n) => { started++; await new Promise((r) => setTimeout(r, 1)); return n; }, () => started >= 4);
        expect(started).toBeLessThan(20);
        expect(out.filter((v) => v !== undefined).length).toBe(started);
    });
});

describe('applyAntiPatterns', () => {
    const groups = groupAntiPatterns([unused(1), unused(2), unused(3)]);
    const deps = { labels: L, index: new Map() };

    it('reports progress for every host call', async () => {
        const progress = vi.fn();
        const out = await applyAntiPatterns(groups, { ...deps, source: source(async () => ({ changed: [] })), onProgress: progress });
        expect(out.applied).toHaveLength(3);
        expect(progress.mock.calls.map((c) => c[0]).sort()).toEqual([1, 2, 3]);
        expect(progress).toHaveBeenLastCalledWith(3, 3);
    });

    it('returns the findings whose codemod failed when there is no composer', async () => {
        const out = await applyAntiPatterns(groups, { ...deps, source: source(async (f) => { if (f.id === 'u2') throw new Error('x'); return { changed: [] }; }) });
        expect(out.applied.map((a) => a.finding.id)).toEqual(['u1', 'u3']);
        expect(out.failed.map((f) => f.id)).toEqual(['u2']);
    });

    it('hands a failed codemod to the agent in the ONE request when there is a composer', async () => {
        const onCompose = vi.fn();
        const out = await applyAntiPatterns(groups, { ...deps, onCompose, source: source(async () => { throw new Error('x'); }) });
        expect(onCompose).toHaveBeenCalledTimes(1);
        expect(out.failed).toEqual([]);
        expect(out.composed).toHaveLength(3);
    });

    it('Cancel stops after the calls in flight and sends nothing to the agent', async () => {
        const many = groupAntiPatterns(Array.from({ length: 30 }, (_, i) => unused(i)));
        let calls = 0;
        const onCompose = vi.fn();
        const out = await applyAntiPatterns(many, { ...deps, onCompose, source: source(async () => { calls++; await new Promise((r) => setTimeout(r, 1)); return { changed: [] }; }), cancelled: () => calls >= 5 });
        expect(out.cancelled).toBe(true);
        expect(calls).toBeLessThan(30);
        expect(onCompose).not.toHaveBeenCalled();
    });
});
