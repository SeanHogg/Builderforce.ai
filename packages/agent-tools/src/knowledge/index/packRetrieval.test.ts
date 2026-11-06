import { describe, expect, it, vi } from 'vitest';
import type { Recall, RecalledHit } from './contract.js';
import {
    mergeRecalls, packRetrievalPort, withPacks, type KnowledgePackEntry, type PackRegistry, type RecallingIndex,
} from './packRetrieval.js';

const hit = (id: string, score: number, extra: Partial<RecalledHit> & { hash?: string } = {}): RecalledHit =>
    ({ id, score, tier: 'lexical', ...extra });
const recall = (hits: RecalledHit[], digest = '', tiers: Recall['tiers'] = ['lexical']): Recall => ({ hits, tiers, digest });
const index = (r: Recall): RecallingIndex => ({ recall: vi.fn(async () => r) });
const entry = (rootId: string): KnowledgePackEntry => ({ name: rootId, rootId, title: rootId, loadedAt: '2026-11-06T00:00:00.000Z' });
const registryOf = (...roots: string[]): PackRegistry => ({ list: async () => roots.map(entry) });

describe('mergeRecalls', () => {
    it('keeps the highest-scored hit per id, orders by score then id and cuts to k', () => {
        const out = mergeRecalls([
            recall([hit('b', 0.5), hit('a', 0.5), hit('c', 0.1)]),
            recall([hit('c', 0.9), hit('a', 0.2)]),
        ], 3);
        expect(out.hits.map((h) => [h.id, h.score])).toEqual([['c', 0.9], ['a', 0.5], ['b', 0.5]]);
        expect(mergeRecalls([recall([hit('a', 1), hit('b', 0.9)])], 1).hits.map((h) => h.id)).toEqual(['a']);
    });

    it('collapses hits with equal content hash, keeping the stronger', () => {
        const out = mergeRecalls([
            recall([hit('src:p1::a.md', 0.4, { hash: 'h1' }), hit('src:p1::b.md', 0.3)]),
            recall([hit('src:p2::a.md', 0.8, { hash: 'h1' })]),
        ], 5);
        expect(out.hits.map((h) => h.id)).toEqual(['src:p2::a.md', 'src:p1::b.md']);
    });

    it('unions tiers and joins the sorted non-empty digests', () => {
        const out = mergeRecalls([
            recall([], 'zz', ['lexical']),
            recall([], '', ['exact']),
            recall([], 'aa', ['exact', 'dense']),
        ], 5);
        expect(out.tiers).toEqual(['dense', 'exact', 'lexical']);
        expect(out.digest).toBe('aa|zz');
    });

    it('is order-independent', () => {
        const a = recall([hit('x', 0.5), hit('y', 0.5)], 'd1');
        const b = recall([hit('y', 0.7), hit('z', 0.1)], 'd2');
        expect(mergeRecalls([a, b], 5)).toEqual(mergeRecalls([b, a], 5));
    });
});

describe('packRetrievalPort', () => {
    it('recalls every pack index with the query and merges the hits', async () => {
        const indexes: Record<string, RecallingIndex> = {
            p1: index(recall([hit('src:p1::a.md', 0.6)], 'd1')),
            p2: index(recall([hit('src:p2::b.md', 0.9)], 'd2')),
        };
        const port = packRetrievalPort({ indexOf: (id) => indexes[id]! });
        const out = await port.recall(['p1', 'p2', 'p1'], 'termination', { k: 4 });
        expect(out.hits.map((h) => h.id)).toEqual(['src:p2::b.md', 'src:p1::a.md']);
        expect(indexes.p1!.recall).toHaveBeenCalledTimes(1);
        expect(indexes.p1!.recall).toHaveBeenCalledWith('termination', { k: 4 });
    });

    it('skips a failing pack, reports it, and still answers from the rest', async () => {
        const onError = vi.fn();
        const port = packRetrievalPort({
            indexOf: (id) => (id === 'bad' ? Promise.reject(new Error('no index')) : index(recall([hit('src:ok::a.md', 0.5)]))),
            onError,
        });
        const out = await port.recall(['bad', 'ok'], 'q');
        expect(out.hits.map((h) => h.id)).toEqual(['src:ok::a.md']);
        expect(onError).toHaveBeenCalledWith('bad', expect.any(Error));
    });

    it('an index whose recall throws is skipped the same way', async () => {
        const onError = vi.fn();
        const port = packRetrievalPort({ indexOf: () => ({ recall: async () => { throw new Error('boom'); } }), onError });
        expect((await port.recall(['p'], 'q')).hits).toEqual([]);
        expect(onError).toHaveBeenCalledOnce();
    });
});

describe('withPacks', () => {
    const port = (indexes: Record<string, RecallingIndex>) => packRetrievalPort({ indexOf: (id) => indexes[id]! });

    it('merges the primary index with the loaded packs', async () => {
        const merged = withPacks(
            index(recall([hit('src:ws::own.ts', 0.5)], 'own')),
            registryOf('pk'),
            port({ pk: index(recall([hit('src:pk::lease.md', 0.8)], 'pk')) }),
        );
        const out = await merged.recall('lease');
        expect(out.hits.map((h) => h.id)).toEqual(['src:pk::lease.md', 'src:ws::own.ts']);
        expect(out.digest).toBe('own|pk');
    });

    it('answers from the packs alone when there is no primary index (no folder open)', async () => {
        const merged = withPacks(undefined, registryOf('pk'), port({ pk: index(recall([hit('src:pk::lease.md', 0.8)])) }));
        expect((await merged.recall('lease')).hits.map((h) => h.id)).toEqual(['src:pk::lease.md']);
    });

    it('is the primary\'s own recall, untouched, when no pack is loaded', async () => {
        const own = recall([hit('a', 1), hit('b', 0.5, { expanded: true })], 'own');
        const merged = withPacks(index(own), registryOf(), port({}));
        expect(await merged.recall('q')).toBe(own);
    });

    it('is empty with neither a primary nor a pack', async () => {
        expect(await withPacks(undefined, registryOf(), port({})).recall('q')).toEqual({ hits: [], tiers: [], digest: '' });
    });

    it('a failing primary does not hide the packs, but fails when nothing else answered', async () => {
        const broken: RecallingIndex = { recall: async () => { throw new Error('workspace index down'); } };
        const packs = port({ pk: index(recall([hit('src:pk::a.md', 0.5)])) });
        expect((await withPacks(broken, registryOf('pk'), packs).recall('q')).hits).toHaveLength(1);
        await expect(withPacks(broken, registryOf(), packs).recall('q')).rejects.toThrow('workspace index down');
    });

    it('treats a failing registry as no packs', async () => {
        const registry: PackRegistry = { list: async () => { throw new Error('state gone'); } };
        const own = recall([hit('a', 1)]);
        expect(await withPacks(index(own), registry, port({})).recall('q')).toBe(own);
    });
});
