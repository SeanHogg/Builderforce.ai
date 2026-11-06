import { describe, expect, it } from 'vitest';
import { hashText } from '@seanhogg/builderforce-memory/ingest';
import type { IndexDoc, KnowledgeSnapshot, StoredFact, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import {
    mergePacks, packFromSnapshot, parsePack, rebasePackRoot, serializePack, type PortableKnowledgePack,
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

    it('merge drops a file\'s older extracted record when fresh re-extracted it at a new hash', () => {
        const ext = (hash: string, file: string) => ({
            sourceRef: `src:root-1::${file}` as KnowledgeSnapshot['extracted'][string][number]['sourceRef'],
            sourceHash: hash, nodes: [], edges: [], keys: [],
        });
        const base = pack({ snapshot: snapshot({ extracted: { old: [ext('old', 'a.md')], keep: [ext('keep', 'b.md')] } }) });
        const fresh = pack({ snapshot: snapshot({ extracted: { next: [ext('next', 'a.md')] } }) });
        expect(Object.keys(mergePacks(base, fresh).snapshot.extracted)).toEqual(['keep', 'next']);
    });

    it('merge is deterministic: both input orders of the same content serialize to identical bytes', () => {
        const baseA = pack({ snapshot: snapshot({ facts: { 'root-1': [fact('a'), fact('b')] } }) });
        const baseB = pack({ snapshot: snapshot({ facts: { 'root-1': [fact('b'), fact('a')] } }) });
        const freshA = pack({ snapshot: snapshot({ relations: { 'root-1': [relation('x', 'y', 'k'), relation('m', 'n', 'k')] } }) });
        const freshB = pack({ snapshot: snapshot({ relations: { 'root-1': [relation('m', 'n', 'k'), relation('x', 'y', 'k')] } }) });
        const now = { now: fixedNow };
        expect(serializePack(mergePacks(baseA, freshA, now))).toBe(serializePack(mergePacks(baseB, freshB, now)));
    });

    it('orders relations by the NUL-separated triple, as memory\'s localSnapshotStore does', () => {
        // 'a\0x\0k' sorts before 'a/b\0x\0k' (NUL < '/'); a literal backslash-u0000 would sort it after.
        const text = serializePack(pack({
            snapshot: snapshot({ relations: { 'root-1': [relation('a/b', 'x', 'k'), relation('a', 'x', 'k')] } }),
        }));
        const froms = parsePack(text).snapshot.relations['root-1']!.map((r) => String(r.from));
        expect(froms).toEqual(['a', 'a/b']);
    });

    it('merges relations that share a triple across the NUL separator without colliding', () => {
        const base = pack({ snapshot: snapshot({ relations: { 'root-1': [relation('a', 'bx', 'k'), relation('ab', 'x', 'k')] } }) });
        const merged = mergePacks(base, pack());
        expect(merged.snapshot.relations['root-1']).toHaveLength(2);
    });

    describe('rebasePackRoot', () => {
        const OLD = 'vscode:f-old';
        const NEW = 'vscode:f-new';
        const ref = (root: string, p: string) => `src:${root}::${p}` as StoredRelation['from'];
        const extractedOf = (root: string) => ({
            sourceRef: ref(root, 'a.md'), sourceHash: 'h-a',
            nodes: [{ ref: ref(root, 'a.md'), kind: 'file', label: 'a.md', pack: 'docs', partition: 'doc', tier: 'T', hash: 'h-a' }],
            edges: [{ from: ref(root, 'a.md#s'), to: ref(root, 'a.md'), kind: 'about', weight: 1 }],
            keys: [{ ref: ref(root, 'a.md'), key: 'a.md' }],
        }) as unknown as KnowledgeSnapshot['extracted'][string][number];
        const old = () => pack({
            rootId: OLD,
            snapshot: snapshot({
                scopes: [{ rootId: OLD, title: 'Old', packs: ['docs'] }],
                facts: { [OLD]: [{ ...fact('f1'), fileAnchors: [{ ref: ref(OLD, 'a.md') }] } as unknown as StoredFact] },
                relations: { [OLD]: [relation(ref(OLD, 'a.md'), 'ent:docs:lease', 'mentions')] },
                extracted: { 'h-a': [extractedOf(OLD)] },
            }),
            cards: [{ id: ref(OLD, 'a.md'), text: 'mentions src: nothing', keys: ['a.md'], hash: 'card-hash' }],
        });

        it('re-keys the root, scopes, per-root records and every source ref of the old root', () => {
            const out = rebasePackRoot(old(), NEW);
            expect(out.rootId).toBe(NEW);
            expect(out.snapshot.scopes.map((s) => s.rootId)).toEqual([NEW]);
            expect(Object.keys(out.snapshot.facts)).toEqual([NEW]);
            expect(Object.keys(out.snapshot.relations)).toEqual([NEW]);
            expect(String(out.snapshot.relations[NEW]![0]!.from)).toBe(`src:${NEW}::a.md`);
            expect(out.snapshot.relations[NEW]![0]!.to).toBe('ent:docs:lease');
            expect(Object.keys(out.snapshot.extracted)).toEqual(['h-a']);
            expect(JSON.stringify(out)).not.toContain(OLD);
            const card = out.cards![0]!;
            expect(card.id).toBe(`src:${NEW}::a.md`);
            expect(card.hash).toBe('card-hash');
        });

        it('is a no-op for equal root ids and leaves the input untouched otherwise', () => {
            const p = old();
            expect(rebasePackRoot(p, OLD)).toBe(p);
            const before = serializePack(p);
            rebasePackRoot(p, NEW);
            expect(serializePack(p)).toBe(before);
        });

        it('lets a rebased fresh review merge onto the pack, keeping the new facts under the pack root', () => {
            const base = old();
            const fresh = rebasePackRoot(
                pack({ rootId: NEW, snapshot: snapshot({ facts: { [NEW]: [fact('brand-new')] }, relations: { [NEW]: [] } }) }),
                OLD,
            );
            const merged = mergePacks(base, fresh);
            expect(merged.snapshot.facts[OLD]!.map((f) => f.key).sort()).toEqual(['brand-new', 'f1']);
            expect(Object.keys(merged.snapshot.facts)).toEqual([OLD]);
        });
    });

    it('serializes repeats of one fact key or relation triple once (the last wins)', () => {
        const text = serializePack(pack({
            snapshot: snapshot({
                facts: { 'root-1': [fact('a', 'first'), fact('a', 'second')] },
                relations: { 'root-1': [relation('x', 'y', 'k', 1), relation('x', 'y', 'k', 5)] },
            }),
        }));
        const parsed = parsePack(text);
        expect(parsed.snapshot.facts['root-1']!.map((f) => f.content)).toEqual(['second']);
        expect(parsed.snapshot.relations['root-1']!.map((r) => r.weight)).toEqual([5]);
    });

    describe('a moved folder\'s update', () => {
        const OLD = 'vscode:f-old';
        const NEW = 'vscode:f-new';
        // The key the judge writes (builderforce-memory judge.ts): hash of the section ref and the triple.
        const claimKey = (root: string) => `claim:${hashText([`src:${root}::lease.md#termination`, 'lease', 'ends', 'with notice'].join('\u0000'))}`;
        const claimPack = (root: string, extra: StoredFact[] = []) => {
            const key = claimKey(root);
            const section = `src:${root}::lease.md#termination`;
            return pack({
                rootId: root,
                snapshot: snapshot({
                    scopes: [{ rootId: root, title: 'Lease', packs: ['docs'] }],
                    facts: { [root]: [{ ...fact(key, 'lease ends with notice ⟦30 days⟧'), fileAnchors: [{ path: 'lease.md' }] }, ...extra] },
                    relations: { [root]: [relation(`fact:${key}`, section, 'about')] },
                }),
            });
        };

        it('holds each claim once after rebase + merge, though the keys hash different root ids', () => {
            expect(claimKey(OLD)).not.toBe(claimKey(NEW));
            const merged = mergePacks(claimPack(OLD), rebasePackRoot(claimPack(NEW), OLD));
            const claims = merged.snapshot.facts[OLD]!.filter((f) => f.key.startsWith('claim:'));
            expect(claims.map((f) => f.key)).toEqual([claimKey(NEW)]);
            const about = merged.snapshot.relations[OLD]!.filter((r) => r.kind === 'about');
            expect(about).toHaveLength(1);
            expect(String(about[0]!.from)).toBe(`fact:${claimKey(NEW)}`);
            expect(String(about[0]!.to)).toBe(`src:${OLD}::lease.md#termination`);
        });

        it('keeps a base claim that fresh did not judge again, and a claim with other words', () => {
            const other = { ...fact('claim:other', 'something else ⟦q⟧'), fileAnchors: [{ path: 'lease.md' }] } as StoredFact;
            const merged = mergePacks(claimPack(OLD, [other]), rebasePackRoot(claimPack(NEW), OLD));
            expect(merged.snapshot.facts[OLD]!.map((f) => f.key).sort()).toEqual([claimKey(NEW), 'claim:other'].sort());
        });
    });

    describe('mirror (Update): the pack follows the folder', () => {
        const ext = (file: string) => ({
            sourceRef: `src:root-1::${file}` as KnowledgeSnapshot['extracted'][string][number]['sourceRef'],
            sourceHash: `h-${file}`, nodes: [], edges: [], keys: [],
        });
        const anchored = (key: string, ...paths: string[]) => ({ ...fact(key), fileAnchors: paths.map((path) => ({ path })) }) as StoredFact;
        const base = () => pack({
            snapshot: snapshot({
                facts: { 'root-1': [anchored('only-gone', 'gone.md'), anchored('both', 'gone.md', 'kept.md'), anchored('kept', 'kept.md')] },
                relations: { 'root-1': [
                    relation('fact:only-gone', 'src:root-1::gone.md', 'about'),
                    relation('src:root-1::kept.md', 'src:root-1::gone.md', 'links'),
                    relation('fact:kept', 'src:root-1::kept.md', 'about'),
                ] },
                extracted: { 'h-gone.md': [ext('gone.md')], 'h-kept.md': [ext('kept.md')] },
            }),
        });
        const fresh = () => pack({ snapshot: snapshot({ extracted: { 'h-kept.md': [ext('kept.md')] } }) });

        it('forgets a deleted file with the facts and relations anchored only to it', () => {
            const merged = mergePacks(base(), fresh(), { mirror: true });
            expect(Object.keys(merged.snapshot.extracted)).toEqual(['h-kept.md']);
            expect(merged.snapshot.facts['root-1']!.map((f) => f.key)).toEqual(['both', 'kept']);
            expect(merged.snapshot.relations['root-1']!.map((r) => String(r.from))).toEqual(['fact:kept']);
        });

        it('forgets nothing without mirror, nor when fresh extracted nothing at all', () => {
            expect(Object.keys(mergePacks(base(), fresh()).snapshot.extracted)).toEqual(['h-gone.md', 'h-kept.md']);
            const empty = mergePacks(base(), pack(), { mirror: true });
            expect(Object.keys(empty.snapshot.extracted)).toEqual(['h-gone.md', 'h-kept.md']);
            expect(empty.snapshot.facts['root-1']).toHaveLength(3);
        });
    });

    describe('provenance', () => {
        const prov = { reviewedBy: 'Ada', judgeModel: 'm-1', policy: 'docs', reviewedAt: '2026-11-06T00:00:00.000Z' };

        it('a pack without it serializes exactly as before (no provenance key at all)', () => {
            const text = serializePack(pack());
            expect(text).not.toContain('provenance');
            expect(serializePack({ ...pack(), provenance: undefined })).toBe(text);
            expect(serializePack({ ...pack(), provenance: {} })).toBe(text);
            expect(parsePack(text).provenance).toBeUndefined();
        });

        it('round-trips, sorted, dropping undefined fields', () => {
            const p = { ...pack(), provenance: { ...prov, policy: undefined } };
            const text = serializePack(p);
            expect(text).toContain('"provenance":{"judgeModel":"m-1","reviewedAt":"2026-11-06T00:00:00.000Z","reviewedBy":"Ada"}');
            expect(parsePack(text).provenance).toEqual({ judgeModel: 'm-1', reviewedAt: '2026-11-06T00:00:00.000Z', reviewedBy: 'Ada' });
            expect(serializePack(parsePack(text))).toBe(text);
        });

        it('rejects a provenance that is not an object of strings', () => {
            const base = JSON.parse(serializePack(pack()));
            expect(() => parsePack(JSON.stringify({ ...base, provenance: 'me' }))).toThrow(/provenance must be an object/);
            expect(() => parsePack(JSON.stringify({ ...base, provenance: [] }))).toThrow(/provenance must be an object/);
            expect(() => parsePack(JSON.stringify({ ...base, provenance: { reviewedBy: 3 } }))).toThrow(/provenance\.reviewedBy must be a string/);
            expect(parsePack(JSON.stringify({ ...base, provenance: { reviewedBy: 'x' } })).provenance).toEqual({ reviewedBy: 'x' });
        });

        it('merge: fresh wins, else the base\'s is kept, else none', () => {
            const withBase = { ...pack(), provenance: prov };
            const withFresh = { ...pack(), provenance: { reviewedBy: 'Bo' } };
            expect(mergePacks(withBase, withFresh).provenance).toEqual({ reviewedBy: 'Bo' });
            expect(mergePacks(withBase, pack()).provenance).toEqual(prov);
            expect(mergePacks(pack(), pack()).provenance).toBeUndefined();
        });

        it('rebasePackRoot leaves it unchanged', () => {
            const p = { ...pack({ rootId: 'root-1' }), provenance: { ...prov, policy: 'root-1' } };
            expect(rebasePackRoot(p, 'root-2').provenance).toEqual({ ...prov, policy: 'root-1' });
        });
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
