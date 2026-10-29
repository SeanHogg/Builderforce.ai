import { describe, expect, it } from 'vitest';
import { createKnowledgeIndex, srcRef } from '@seanhogg/builderforce-memory/knowledge';
import { resolveWarmEmbedder } from './embedderChain.js';
import { createHostKnowledgeIndex, SIMILAR_PAIRS_PER_ID } from './hostIndex.js';
import { indexFileName, knowledgeIndexPath, writeIndexAtomic } from './persistence.js';
import { createKnowledgeIndexRegistry } from './registry.js';
import { chunkByArea, extractFromSymbols, seedCodeCards } from './seedCode.js';
import { bucketEmbedder, manualIdle, memoryFiles, WORKSPACE_FILES } from './testkit.test-util.js';

const ROOT = 'repo';
const PATH = knowledgeIndexPath('/ws', ROOT);

function host(over: Partial<Parameters<typeof createHostKnowledgeIndex>[0]> = {}) {
    const files = memoryFiles();
    const idle = manualIdle();
    const index = createHostKnowledgeIndex({ rootId: ROOT, path: PATH, files, idle, ...over });
    return { files, idle, index };
}

describe('host knowledge index — lazy load', () => {
    it('reads nothing until the first call, then reads the stored file once', async () => {
        const { files, index } = host();
        expect(files.reads).toEqual([]);
        await index.search('anything');
        await index.search('again');
        expect(files.reads).toEqual([PATH]);
    });

    it('loads what an earlier session persisted', async () => {
        const first = host();
        await seedCodeCards(first.index, WORKSPACE_FILES);
        await first.index.flush();
        const second = createHostKnowledgeIndex({ rootId: ROOT, path: PATH, files: first.files, idle: manualIdle() });
        expect(await second.digest()).toBe(await first.index.digest());
        expect((await second.search('retryPolicy'))[0]).toMatchObject({ id: srcRef(ROOT, 'src/net/retryPolicy.ts'), tier: 'exact' });
    });

    it('a corrupt file is no index, never a failure', async () => {
        const { files, index } = host();
        files.store.set(PATH, new Uint8Array([1, 2, 3]));
        expect(await index.size()).toBe(0);
    });
});

describe('host knowledge index — persist', () => {
    it('writes atomically (temp + rename) on the idle pass, and only when the digest moved', async () => {
        const { files, idle, index } = host();
        await seedCodeCards(index, WORKSPACE_FILES);
        expect(idle.pending()).toBe(true);
        await idle.run();
        expect(files.renames).toHaveLength(1);
        expect(files.renames[0]![1]).toBe(PATH);
        expect(files.renames[0]![0]).toMatch(/\.tmp$/);
        expect(files.store.has(PATH)).toBe(true);
        await index.flush();
        expect(files.renames).toHaveLength(1);
    });

    it('names the file after the root id, collision-free', () => {
        expect(indexFileName('repo')).toMatch(/^repo-[0-9a-f]{10}\.idx$/);
        expect(indexFileName('a/b')).not.toBe(indexFileName('a_b'));
    });

    it('a failed rename removes its temp file', async () => {
        const files = memoryFiles();
        files.rename = async () => { throw new Error('locked'); };
        await expect(writeIndexAtomic(files, PATH, new Uint8Array([1]), 'abcdef0123456789')).rejects.toThrow('locked');
        expect([...files.store.keys()]).toEqual([]);
    });
});

describe('host knowledge index — fingerprints', () => {
    it('a stored index of another fingerprint schedules a re-embed (compact) on idle, and never mixes', async () => {
        const files = memoryFiles();
        const old = createKnowledgeIndex({ embedder: bucketEmbedder('old-model') });
        await old.upsert([{ id: 'src:repo::a.ts', text: 'alpha billing' }, { id: 'src:repo::b.ts', text: 'beta auth' }]);
        await old.compact();
        files.store.set(PATH, old.serialize());

        const embedder = bucketEmbedder('new-model');
        const idle = manualIdle();
        const index = createHostKnowledgeIndex({ rootId: ROOT, path: PATH, files, idle, embedder: async () => embedder });
        const hits = await index.search('billing');
        expect(hits.every((h) => h.tier !== 'dense')).toBe(true);
        expect(idle.pending()).toBe(true);
        expect(embedder.calls).toBe(0);
        await idle.run();
        expect(embedder.calls).toBeGreaterThan(0);
        expect((await index.recall('billing')).tiers).toContain('dense');
    });

    it('no warm embedder ⇒ exact + lexical only, said in the tiers', async () => {
        const { index } = host();
        await seedCodeCards(index, WORKSPACE_FILES);
        const r = await index.recall('billing invoice');
        expect(r.tiers).toEqual(['exact', 'lexical']);
        expect(r.hits.every((h) => h.tier !== 'dense')).toBe(true);
    });

    it('the chain takes Synapse before Evermind, and only a warm one', async () => {
        const synapse = bucketEmbedder('synapse');
        const evermind = bucketEmbedder('evermind');
        const ev = { id: 'evermind' as const, warm: () => true, port: () => evermind };
        expect(await resolveWarmEmbedder([ev, { id: 'synapse', warm: () => true, port: () => synapse }])).toBe(synapse);
        expect(await resolveWarmEmbedder([ev, { id: 'synapse', warm: () => false, port: () => synapse }])).toBe(evermind);
        expect(await resolveWarmEmbedder([{ ...ev, warm: () => false }])).toBeUndefined();
    });
});

describe('host knowledge index — search and recall', () => {
    it('is deterministic for a fixture: the same hits in the same order, whatever the upsert order', async () => {
        const a = host();
        const b = host();
        await seedCodeCards(a.index, WORKSPACE_FILES);
        await seedCodeCards(b.index, [...WORKSPACE_FILES].reverse());
        for (const q of ['billing', 'createInvoice', 'retry backoff', 'webhook stripe']) {
            expect(await b.index.search(q)).toEqual(await a.index.search(q));
        }
        expect(await b.index.digest()).toBe(await a.index.digest());
    });

    it('finds a file by its exported symbol (the code pack\'s exact keys)', async () => {
        const { index } = host();
        await seedCodeCards(index, WORKSPACE_FILES);
        expect((await index.search('handleStripeWebhook'))[0]).toMatchObject({ id: srcRef(ROOT, 'src/billing/stripeWebhook.ts'), tier: 'exact', score: 1 });
    });

    it('recall expands one hop over the graph\'s edges and marks what it added', async () => {
        const { index } = host();
        const a = srcRef(ROOT, 'a.ts'), b = srcRef(ROOT, 'b.ts');
        await index.upsertFromGraph({
            scope: { rootId: ROOT, packs: ['code'], digest: 'd' },
            nodes: [
                { ref: a, kind: 'file', label: 'a.ts', pack: 'code', importance: 0.5, origin: 'extracted' },
                { ref: b, kind: 'file', label: 'b.ts', pack: 'code', importance: 0.5, origin: 'extracted' },
            ],
            edges: [{ from: a, to: b, kind: 'references', weight: 1, origin: 'extracted' }],
            findings: [], stats: { sources: 2, nodes: 2, stale: 0, truncated: false },
        } as never);
        const r = await index.recall('a.ts', { k: 1 });
        expect(r.hits.map((h) => [h.id, !!h.expanded])).toEqual([[a, false], [b, true]]);
        expect(r.hits[0]).toMatchObject({ path: 'a.ts', meta: { kind: 'file' } });
    });

    it('a seeded file that disappears is removed on the next seed', async () => {
        const { index } = host();
        const first = await seedCodeCards(index, WORKSPACE_FILES);
        await seedCodeCards(index, WORKSPACE_FILES.filter((f) => !f.path.includes('retry')), { previous: first });
        await index.flush();
        expect(await index.search('retryPolicy')).toEqual([]);
    });

    it('similar() keeps only pairs that touch the ids asked about', async () => {
        const embedder = bucketEmbedder();
        const { index } = host({ embedder: async () => embedder });
        await seedCodeCards(index, WORKSPACE_FILES);
        await index.flush();
        const ids = [srcRef(ROOT, 'src/billing/invoice.ts'), srcRef(ROOT, 'src/auth/session.ts')];
        for (const p of await index.similar(ids)) expect(ids.some((id) => id === p.a || id === p.b)).toBe(true);
    });

    describe('the new claims of a review', () => {
        const graphOf = (claims: Array<[string, string]>) => ({
            scope: { rootId: ROOT, packs: ['docs'], digest: 'd' },
            nodes: claims.map(([ref, label]) => ({ ref, kind: 'claim', label, pack: 'docs', importance: 0.5, origin: 'judged' })),
            edges: [], findings: [], stats: { sources: 0, nodes: claims.length, stale: 0, truncated: false },
        } as never);
        const OLD = 'fact:claim:old';
        const NEW = 'fact:claim:new';
        const OTHER = 'fact:claim:other';

        async function indexedWithOld() {
            const embedder = bucketEmbedder();
            const h = host({ embedder: async () => embedder });
            await h.index.upsertFromGraph(graphOf([[OLD, 'The lease ends on 1 June.']]));
            await h.index.flush();
            return h;
        }

        it('pairs a claim that is not indexed yet with one that already is', async () => {
            const { index } = await indexedWithOld();
            expect(await index.size()).toBe(1);
            const pairs = await index.similar([NEW], new Map([[NEW, 'The lease ends on 1 July.']]));
            expect(pairs.map((p) => [p.a, p.b].sort())).toEqual([[NEW, OLD].sort()]);
            expect(pairs[0]!.similarity).toBeGreaterThanOrEqual(0.92);
        });

        it('pairs new claims among themselves, and leaves an unrelated one out', async () => {
            const { index } = await indexedWithOld();
            const texts = new Map([[NEW, 'The tenant pays rent monthly.'], [OTHER, 'The tenant pays rent monthly!'], ['fact:claim:odd', 'zzzz qqqq xxxx 9999']]);
            const pairs = await index.similar([...texts.keys()], texts);
            expect(pairs.some((p) => [p.a, p.b].includes(NEW) && [p.a, p.b].includes(OTHER))).toBe(true);
            expect(pairs.some((p) => [p.a, p.b].includes('fact:claim:odd'))).toBe(false);
        });

        it('keeps the best pairs for each asked claim, however many pairs the rest of the index has', async () => {
            const embedder = bucketEmbedder();
            const h = host({ embedder: async () => embedder });
            await h.index.upsertFromGraph(graphOf(Array.from({ length: 30 }, (_, i): [string, string] => [`fact:claim:o${i}`, `The lease ends on 1 June ${i}.`])));
            await h.index.flush();
            const pairs = await h.index.similar([NEW], new Map([[NEW, 'The lease ends on 1 June.']]));
            expect(pairs.length).toBeGreaterThan(0);
            expect(pairs.length).toBeLessThanOrEqual(SIMILAR_PAIRS_PER_ID);
            // Every pair is the asked claim's — the 30 indexed claims' pairs among themselves are not returned.
            for (const p of pairs) expect([p.a, p.b]).toContain(NEW);
        });

        it('leaves nothing behind when the review stops before writing the claim: no phantom hit, and the next graph drops the card', async () => {
            const { index } = await indexedWithOld();
            await index.similar([NEW], new Map([[NEW, 'Termination requires ninety days written notice.']]));
            // Added only so it could be compared: it answers no search…
            expect((await index.search('ninety days written notice')).map((h) => h.id)).not.toContain(NEW);
            expect((await index.recall('ninety days written notice')).hits.map((h) => h.id)).not.toContain(NEW);
            expect(await index.size()).toBe(2);
            // …and the next graph, which does not hold it (the review never wrote it), removes it.
            await index.upsertFromGraph(graphOf([[OLD, 'The lease ends on 1 June.']]));
            expect(await index.size()).toBe(1);
        });

        it('keeps the card once the graph holds the claim, and it is found', async () => {
            const { index } = await indexedWithOld();
            await index.similar([NEW], new Map([[NEW, 'Termination requires ninety days written notice.']]));
            await index.upsertFromGraph(graphOf([[OLD, 'The lease ends on 1 June.'], [NEW, 'Termination requires ninety days written notice.']]));
            expect(await index.size()).toBe(2);
            expect((await index.search('ninety days written notice')).map((h) => h.id)).toContain(NEW);
        });

        it('without a warm embedder there is nothing to pair, and nothing is dropped as compared by a throw', async () => {
            const { index } = host();
            await index.upsertFromGraph(graphOf([[OLD, 'The lease ends on 1 June.']]));
            expect(await index.similar([NEW], new Map([[NEW, 'The lease ends on 1 July.']]))).toEqual([]);
        });
    });
});

describe('code seed', () => {
    it('carries code files only, through the code pack\'s own parser', () => {
        const ex = extractFromSymbols(ROOT, WORKSPACE_FILES);
        expect(ex.map((e) => e.sourceRef)).not.toContain(srcRef(ROOT, 'README.md'));
        expect(ex.find((e) => e.sourceRef.endsWith('invoice.ts'))!.keys.map((k) => k.key)).toContain('createInvoice');
    });

    it('chunks whole areas, splitting only an area larger than a chunk', () => {
        const ex = extractFromSymbols(ROOT, WORKSPACE_FILES);
        expect(chunkByArea(ex, 2).every((c) => c.length <= 2)).toBe(true);
        expect(chunkByArea(ex, 100)).toHaveLength(1);
    });
});

describe('registry', () => {
    it('seeds the workspace root on first use and stores it under the workspace', async () => {
        const files = memoryFiles();
        const idle = manualIdle();
        const registry = createKnowledgeIndexRegistry({
            workspaceRoots: () => ['/ws/repo'], rootIdOf: (r) => r.split('/').pop()!,
            symbolFiles: async () => WORKSPACE_FILES, files, idle,
        });
        const index = registry.forWorkspace('/ws/repo');
        await index.search('x');
        // The seed runs in the background of the first call.
        for (let i = 0; i < 100 && (await index.size()) === 0; i++) await new Promise((r) => setTimeout(r, 5));
        await index.flush();
        expect(await index.size()).toBeGreaterThan(0);
        expect([...files.store.keys()]).toEqual([knowledgeIndexPath('/ws/repo', 'repo')]);
        expect(registry.get('repo')).toBe(index);
    });
});
