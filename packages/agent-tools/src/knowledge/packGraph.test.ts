import { describe, expect, it, vi } from 'vitest';
import { InMemoryIngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { localSnapshotStore } from '@seanhogg/builderforce-memory/knowledge';
import { mergePacksWithCards, packFromStore, packGraph, reviewHasWork } from './packGraph.js';
import { memorySource } from './reviewRunner.fixtures.test-util.js';
import { planKnowledgeReviewDetail, runKnowledgeReview } from './reviewRunner.js';
import { parsePack, serializePack } from './portablePack.js';
import { PACK_CLOCK, PACK_DOCS, reviewedDocs } from './packFixtures.test-util.js';

describe('packFromStore', () => {
    it('packs the root\'s scope, facts, relations, extracted cache and the cards of its graph', async () => {
        const { pack, extracted } = await reviewedDocs();
        expect(pack.rootId).toBe('docs');
        expect(pack.snapshot.scopes.every((s) => s.rootId === 'docs')).toBe(true);
        expect(Object.keys(pack.snapshot.facts)).toEqual(['docs']);
        expect(Object.keys(pack.snapshot.relations)).toEqual(['docs']);
        expect(Object.keys(pack.snapshot.extracted).length).toBeGreaterThan(0);
        expect(pack.snapshot.extracted).toEqual(extracted);
        const ids = (pack.cards ?? []).map((c) => c.id);
        expect(ids).toContain('src:docs::lease.md');
        expect(ids).toContain('src:docs::guide/moving.md');
    });

    it('records the provenance it is given, and none when it is not', async () => {
        const { store, manifest, extracted } = await reviewedDocs();
        const provenance = { reviewedBy: 'Ada', judgeModel: 'm-1', reviewedAt: '2026-11-06T00:00:00.000Z' };
        const withIt = await packFromStore({ name: 'docs', rootId: 'docs', title: 'docs', store, manifest, extracted, provenance });
        expect(parsePack(serializePack(withIt)).provenance).toEqual(provenance);
        const without = await packFromStore({ name: 'docs', rootId: 'docs', title: 'docs', store, manifest, extracted });
        expect(serializePack(without)).not.toContain('provenance');
    });

    it('does not leak another root\'s scope from a shared store', async () => {
        const { store, manifest, extracted } = await reviewedDocs();
        await store.write({ scope: { rootId: 'other', title: 'Other', packs: ['docs'] }, facts: [], relations: [] });
        expect((await store.scopes()).map((s) => s.rootId)).toContain('other');
        const pack = await packFromStore({ name: 'docs', rootId: 'docs', title: 'docs', store, manifest, extracted, now: PACK_CLOCK });
        expect(pack.snapshot.scopes.map((s) => s.rootId)).not.toContain('other');
        expect(pack.createdAt).toBe('2026-11-06T00:00:00.000Z');
    });

    it('carries only the extracted hashes the root holds now, not every hash a file ever had', async () => {
        const { store, manifest, extracted } = await reviewedDocs();
        const stale = { ...extracted, 'old-hash': [{ sourceRef: 'src:docs::lease.md', sourceHash: 'old-hash', nodes: [], edges: [], keys: [] }] };
        const pack = await packFromStore({ name: 'docs', rootId: 'docs', title: 'docs', store, manifest, extracted: stale as typeof extracted });
        expect(Object.keys(pack.snapshot.extracted)).not.toContain('old-hash');
    });

    it('omits cards, surfacing the error, when the graph cannot be built', async () => {
        const { store, manifest, extracted } = await reviewedDocs();
        let calls = 0;
        const flaky = Object.assign(Object.create(store), {
            facts: (scope: { rootId: string }) => (++calls > 1 ? Promise.reject(new Error('boom')) : store.facts(scope)),
        });
        const onError = vi.fn();
        const pack = await packFromStore({ name: 'docs', rootId: 'docs', title: 'docs', store: flaky, manifest, extracted, onError });
        expect(pack.cards).toBeUndefined();
        expect(pack.snapshot.scopes.every((s) => s.rootId === 'docs')).toBe(true);
        expect(onError).toHaveBeenCalledTimes(1);
    });
});

describe('packGraph', () => {
    it('rebuilds the graph from the pack alone, after a serialize/parse round trip', async () => {
        const { pack } = await reviewedDocs();
        const moved = parsePack(serializePack(pack));
        const graph = await packGraph(moved);
        expect(graph?.nodes.some((n) => n.ref === 'src:docs::lease.md')).toBe(true);
        expect(graph?.nodes.some((n) => n.ref === 'src:docs::guide/moving.md')).toBe(true);
    });

    it('honours maxNodes and focus', async () => {
        const { pack } = await reviewedDocs();
        const full = await packGraph(pack);
        const capped = await packGraph(pack, { maxNodes: 2 });
        expect(full!.nodes.length).toBeGreaterThan(2);
        // `maxNodes` is the number of top-by-importance nodes kept; truncateGraph (memory engine,
        // dist/knowledge/truncate.js) ALSO keeps focus nodes, every node a finding names, changed
        // nodes and the 1-hop neighbours of all of those, up to a hard cap of 2000 — so the real
        // nodes of a capped graph may exceed `maxNodes`. Everything else folds into area nodes.
        expect(full!.stats.truncated).toBe(false);
        expect(capped!.stats.truncated).toBe(true);
        // The `maxNodes` most important nodes are always among those kept.
        const top2 = [...full!.nodes].sort((a, b) => b.importance - a.importance || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)).slice(0, 2);
        for (const n of top2) expect(capped!.nodes.some((c) => c.ref === n.ref)).toBe(true);
        const focused = await packGraph(pack, { focus: ['src:docs::lease.md'] });
        expect(focused?.nodes.some((n) => n.ref === 'src:docs::lease.md')).toBe(true);
    });

    it('is null for a pack that holds nothing extracted', async () => {
        const { pack } = await reviewedDocs();
        expect(await packGraph({ ...pack, snapshot: { ...pack.snapshot, extracted: {} } })).toBeNull();
    });
});

describe('mergePacksWithCards', () => {
    it('rebuilds the cards from the merged snapshot: a new file is carded, a stale card is gone', async () => {
        const base = (await reviewedDocs(PACK_DOCS, 'docs')).pack;
        const withNew = (await reviewedDocs({ ...PACK_DOCS, 'extra.md': '# Extra\n\nA brand new document.\n' }, 'docs')).pack;
        const merged = await mergePacksWithCards(base, withNew, { now: PACK_CLOCK });
        const ids = merged.cards!.map((c) => c.id);
        expect(ids).toContain('src:docs::extra.md');
        expect(ids).toContain('src:docs::lease.md');
        // fresh's cards alone would be wrong if fresh were partial: here fresh lacks a base file.
        const partial = (await reviewedDocs({ 'extra.md': '# Extra\n\nA brand new document.\n' }, 'docs')).pack;
        const kept = await mergePacksWithCards(base, partial, { now: PACK_CLOCK });
        expect(kept.cards!.map((c) => c.id)).toContain('src:docs::lease.md');
        expect(kept.cards!.map((c) => c.id)).toContain('src:docs::extra.md');
    });

    it('with mirror, a deleted file leaves the pack: extracted, graph and cards', async () => {
        const base = (await reviewedDocs(PACK_DOCS, 'docs')).pack;
        const { 'policy.md': _removed, ...rest } = PACK_DOCS;
        const fresh = (await reviewedDocs(rest, 'docs')).pack;
        const merged = await mergePacksWithCards(base, fresh, { mirror: true });
        const refs = Object.values(merged.snapshot.extracted).flat().map((e) => e.sourceRef);
        expect(refs).not.toContain('src:docs::policy.md');
        expect(refs).toContain('src:docs::lease.md');
        expect(merged.cards!.map((c) => c.id).some((id) => id.includes('policy.md'))).toBe(false);
        const unmirrored = await mergePacksWithCards(base, fresh);
        expect(unmirrored.cards!.map((c) => c.id).some((id) => id.includes('policy.md'))).toBe(true);
    });
});

describe('reviewHasWork', () => {
    it('is true for a never-reviewed folder and false once the review is current', async () => {
        let snapshot: string | undefined;
        const ports = {
            source: memorySource(PACK_DOCS),
            store: localSnapshotStore({ read: async () => snapshot, write: async (s) => { snapshot = s; } }),
            manifest: new InMemoryIngestManifest(),
        };
        expect(reviewHasWork(await planKnowledgeReviewDetail(ports))).toBe(true);
        await runKnowledgeReview(ports);
        expect(reviewHasWork(await planKnowledgeReviewDetail(ports))).toBe(false);
        ports.source = memorySource({ ...PACK_DOCS, 'lease.md': `${PACK_DOCS['lease.md']}\nMore.\n` });
        expect(reviewHasWork(await planKnowledgeReviewDetail(ports))).toBe(true);
    });
});
