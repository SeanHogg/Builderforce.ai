import { describe, expect, it } from 'vitest';
import type { IndexDoc, KnowledgeSnapshot, StoredFact, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import {
    mergePacks, packFromSnapshot, parsePack, serializePack, type PortableKnowledgePack,
} from './portablePack.js';

const fixedNow = () => '2026-11-03T00:00:00.000Z';

function fact(key: string, content = `content of ${key}`): StoredFact {
    return { key, content, source: 'test', importance: 1, origin: 'model', fileAnchors: [] };
}

function relation(from: string, to: string, kind: string, weight = 1): StoredRelation {
    return { from: from as StoredRelation['from'], to: to as StoredRelation['to'], kind, weight, origin: 'model' };
}

function snapshot(partial: Partial<KnowledgeSnapshot> = {}): KnowledgeSnapshot {
    return {
        version: 1,
        scopes: [{ rootId: 'root-1', title: 'Root One', packs: ['docs'] }],
        facts: {},
        relations: {},
        extracted: {},
        ...partial,
    };
}

function pack(partial: Partial<PortableKnowledgePack> = {}): PortableKnowledgePack {
    return packFromSnapshot({
        name: 'my-folder',
        rootId: 'root-1',
        title: 'My Folder',
        snapshot: snapshot(),
        now: fixedNow,
        ...partial,
    });
}

describe('portable knowledge pack', () => {
    it('round-trips through serialize/parse byte-identically', () => {
        const p = pack({
            snapshot: snapshot({
                facts: { 'root-1': [fact('a'), fact('b')] },
                relations: { 'root-1': [relation('src:root-1::a.md', 'src:root-1::b.md', 'mentions')] },
                extracted: { 'hash-1': [{ sourceRef: 'src:root-1::a.md' as KnowledgeSnapshot['extracted'][string][number]['sourceRef'], sourceHash: 'hash-1', nodes: [], edges: [], keys: [] }] },
            }),
            cards: [{ id: 'src:root-1::a.md', text: 'a card', keys: ['a.md'] }],
        });
        const text = serializePack(p);
        expect(serializePack(parsePack(text))).toBe(text);
        expect(parsePack(text)).toEqual(p);
    });

    it('serializes canonically: unsorted input content yields equal bytes', () => {
        const a = pack({ snapshot: snapshot({ facts: { 'root-1': [fact('a'), fact('b')] } }) });
        const b = pack({ snapshot: snapshot({ facts: { 'root-1': [fact('b'), fact('a')] } }) });
        expect(serializePack(a)).toBe(serializePack(b));
    });

    it('rejects a wrong version with a clear message', () => {
        const text = JSON.stringify({ ...JSON.parse(serializePack(pack())), version: 2 });
        expect(() => parsePack(text)).toThrow(/unsupported version 2/);
    });

    it('rejects missing required string fields with a clear message', () => {
        const text = JSON.stringify({ ...JSON.parse(serializePack(pack())), name: undefined });
        expect(() => parsePack(text)).toThrow(/missing required string field "name"/);
    });

    it('rejects a malformed snapshot with a clear message', () => {
        const base = JSON.parse(serializePack(pack()));
        expect(() => parsePack(JSON.stringify({ ...base, snapshot: undefined }))).toThrow(/missing required snapshot/);
        expect(() => parsePack(JSON.stringify({ ...base, snapshot: { scopes: {} } }))).toThrow(/snapshot\.scopes must be an array/);
        expect(() => parsePack(JSON.stringify({ ...base, snapshot: { scopes: [], facts: [], relations: {}, extracted: {} } }))).toThrow(/snapshot\.facts must be a record/);
        expect(() => parsePack(JSON.stringify({ ...base, snapshot: { scopes: [], facts: { 'root-1': {} }, relations: {}, extracted: {} } }))).toThrow(/snapshot\.facts\["root-1"\] must be an array/);
    });

    it('rejects non-JSON text', () => {
        expect(() => parsePack('not json {')).toThrow(/not valid JSON/);
    });

    it('merge dedupes facts by key and relations by triple, fresh winning', () => {
        const base = pack({
            snapshot: snapshot({
                facts: { 'root-1': [fact('a', 'old a'), fact('b')] },
                relations: { 'root-1': [relation('x', 'y', 'k', 1), relation('p', 'q', 'k')] },
            }),
        });
        const fresh = pack({
            title: 'Re-reviewed',
            snapshot: snapshot({
                facts: { 'root-1': [fact('a', 'new a')] },
                relations: { 'root-1': [relation('x', 'y', 'k', 9)] },
            }),
        });
        const merged = mergePacks(base, fresh, { now: () => '2026-11-03T01:00:00.000Z' });
        expect(merged.name).toBe(base.name);
        expect(merged.rootId).toBe(base.rootId);
        expect(merged.title).toBe('Re-reviewed');
        expect(merged.createdAt).toBe('2026-11-03T01:00:00.000Z');
        expect(merged.snapshot.facts['root-1']!.map((f) => [f.key, f.content])).toEqual([['a', 'new a'], ['b', 'content of b']]);
        expect(merged.snapshot.relations['root-1']).toHaveLength(2);
        expect(merged.snapshot.relations['root-1']!.find((r) => String(r.from) === 'x')!.weight).toBe(9);
    });

    it('merge dedupes extracted by hash, fresh winning, and merges scopes by rootId', () => {
        const ext = (hash: string, count: number) => ({
            sourceRef: `src:root-1::${hash}.md` as KnowledgeSnapshot['extracted'][string][number]['sourceRef'],
            sourceHash: hash, nodes: new Array(count) as KnowledgeSnapshot['extracted'][string][number]['nodes'], edges: [], keys: [],
        });
        const base = pack({ snapshot: snapshot({ extracted: { 'h-1': [ext('h-1', 1)], 'h-2': [ext('h-2', 1)] } }) });
        const fresh = pack({
            snapshot: snapshot({
                scopes: [{ rootId: 'root-1', title: 'Root One v2', packs: ['docs'], lastDigest: 'd2' }],
                extracted: { 'h-2': [ext('h-2', 3)] },
            }),
        });
        const merged = mergePacks(base, fresh);
        expect(merged.snapshot.scopes).toHaveLength(1);
        expect(merged.snapshot.scopes[0]!.title).toBe('Root One v2');
        expect(Object.keys(merged.snapshot.extracted)).toEqual(['h-1', 'h-2']);
        expect(merged.snapshot.extracted['h-2']![0]!.nodes).toHaveLength(3);
    });

    it('merge is deterministic: both input orders of the same content serialize to identical bytes', () => {
        const baseA = pack({ snapshot: snapshot({ facts: { 'root-1': [fact('a'), fact('b')] } }) });
        const baseB = pack({ snapshot: snapshot({ facts: { 'root-1': [fact('b'), fact('a')] } }) });
        const freshA = pack({ snapshot: snapshot({ relations: { 'root-1': [relation('x', 'y', 'k'), relation('m', 'n', 'k')] } }) });
        const freshB = pack({ snapshot: snapshot({ relations: { 'root-1': [relation('m', 'n', 'k'), relation('x', 'y', 'k')] } }) });
        const now = { now: fixedNow };
        expect(serializePack(mergePacks(baseA, freshA, now))).toBe(serializePack(mergePacks(baseB, freshB, now)));
    });

    it('cards pass through on pack/parse and fresh cards win on merge', () => {
        const cards: IndexDoc[] = [{ id: 'src:root-1::a.md', text: 'a card', keys: ['a.md'], hash: 'h' }];
        const withCards = pack({ cards });
        expect(parsePack(serializePack(withCards)).cards).toEqual(cards);
        const freshCards: IndexDoc[] = [{ id: 'src:root-1::b.md', text: 'b card' }];
        expect(mergePacks(withCards, pack({ cards: freshCards })).cards).toEqual(freshCards);
        expect(mergePacks(withCards, pack()).cards).toEqual(cards);
    });
});
