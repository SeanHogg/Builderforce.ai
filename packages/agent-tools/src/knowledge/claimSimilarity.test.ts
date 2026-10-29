import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeStore, SimilarPair } from '@seanhogg/builderforce-memory/knowledge';
import { claimSimilarity } from './claimSimilarity.js';

const pairs: SimilarPair[] = [{ a: 'fact:claim:a', b: 'fact:claim:b', similarity: 0.97 }];

describe('the review\'s similarity port over a host index', () => {
    it('uses the texts the review hands in, without reading the store', async () => {
        const facts = vi.fn(async () => []);
        const index = { similar: vi.fn(async (_ids: string[], _texts?: ReadonlyMap<string, string>) => pairs) };
        const texts = new Map([['fact:claim:a', 'The lease ends on 1 June.']]);
        expect(await claimSimilarity(index, { facts } as unknown as KnowledgeStore, 'r')(['fact:claim:a'], texts)).toBe(pairs);
        expect(index.similar).toHaveBeenCalledWith(['fact:claim:a'], texts);
        expect(facts).not.toHaveBeenCalled();
    });

    it('falls back to the claims just written to the store when no texts come with the ids', async () => {
        const facts = vi.fn(async () => [{ key: 'claim:a', content: 'The lease ends on 1 June. — “quote”' }, { key: 'ent:x', content: 'x' }]);
        const index = { similar: vi.fn(async (_ids: string[], _texts?: ReadonlyMap<string, string>) => pairs) };
        await claimSimilarity(index, { facts } as unknown as KnowledgeStore, 'r')(['fact:claim:a', 'fact:ent:x']);
        const texts = index.similar.mock.calls[0]![1];
        expect([...(texts ?? [])]).toEqual([['fact:claim:a', 'The lease ends on 1 June. — “quote”']]);
    });
});
