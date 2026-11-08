import { describe, expect, it } from 'vitest';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { createReviewRecorder, graphCounts, repoGraphEdgeCount, reviewRecordStore, type RecordPersistence, type ReviewRecord } from './reviewRecord.js';

const PLAN = {
    byPack: { code: 7, docs: 3 },
    skipped: [
        // A pre-2026.10.60 stored plan still carries 'binary'; the record keeps any reason string verbatim.
        { path: 'img.png', reason: 'binary' as unknown as 'ignored' },
        { path: 'node_modules/x.js', reason: 'ignored' as const },
    ],
};

describe('the review recorder', () => {
    it('records the plan counts, the plan skips (not "ignored"), folders and coverage skips', () => {
        const store = reviewRecordStore();
        const recorder = createReviewRecorder({
            rootId: 'r', store, folders: () => [{ path: 'vendor-clone', reason: 'nested-checkout' }], now: () => 't',
        });
        recorder.planned(PLAN);
        recorder.begin();
        recorder.signals([{ path: 'coverage/lcov.info', reason: 'stale' }]);
        recorder.finish();
        expect(store.get('r')).toEqual({
            counts: { files: 7, docs: 3 },
            skipped: [
                { path: 'img.png', reason: 'binary' },
                { path: 'vendor-clone', reason: 'nested-checkout' },
                { path: 'coverage/lcov.info', reason: 'coverage-stale' },
            ],
            at: 't',
        });
    });

    it('records the repo map edge count, and keeps the last measured one when a review builds no map', () => {
        const store = reviewRecordStore();
        const recorder = createReviewRecorder({ rootId: 'r', store });
        recorder.planned({ byPack: { code: 1 }, skipped: [] });
        recorder.begin();
        recorder.edges(repoGraphEdgeCount({ graph: { out: [[[1, 1], [2, 1]], [], [[0, 1]]] } }));
        recorder.finish();
        expect(store.get('r')?.counts.edges).toBe(3);
        recorder.begin(); // a cached analysis: no map built
        recorder.finish();
        expect(store.get('r')?.counts.edges).toBe(3);
        expect(createReviewRecorder({ rootId: 'other', store }).finish()).toBeUndefined();
        expect(store.get('other')?.counts).toEqual({ files: 0, docs: 0 });
    });

    it('answers "unknown" (no record) before any review, and reads a persisted record after a reload', () => {
        const disk = new Map<string, unknown>();
        const persistence: RecordPersistence = { read: (k) => disk.get(k), write: (k, v) => { disk.set(k, v); } };
        expect(reviewRecordStore(persistence).get('r')).toBeUndefined();
        const record: ReviewRecord = { counts: { files: 1, docs: 2 }, skipped: [{ path: 'a', reason: 'binary' }], at: 't' };
        reviewRecordStore(persistence).set('r', record);
        // A new store (a reload) finds it; garbage does not pass for a record.
        expect(reviewRecordStore(persistence).get('r')).toEqual(record);
        disk.set('builderforce.knowledge.review.bad', { nope: true });
        expect(reviewRecordStore(persistence).get('bad')).toBeUndefined();
    });

    it('still answers from memory when persistence throws', () => {
        const store = reviewRecordStore({ read: () => { throw new Error('no storage'); }, write: () => { throw new Error('no storage'); } });
        expect(store.get('r')).toBeUndefined();
        store.set('r', { counts: { files: 1, docs: 0 }, skipped: [], at: 't' });
        expect(store.get('r')?.counts.files).toBe(1);
    });
});

const graph = (stats: Partial<KnowledgeGraph['stats']>, nodes: Array<[string, string]>): KnowledgeGraph => ({
    scope: { rootId: 'r', packs: [], digest: 'd' },
    nodes: nodes.map(([pack, ref]) => ({ ref, kind: 'file', label: ref, pack, importance: 0, origin: 'extracted' })),
    edges: [],
    findings: [],
    stats: { sources: 0, nodes: 0, edges: 0, stale: 0, truncated: false, ...stats },
} as unknown as KnowledgeGraph);

describe('graphCounts', () => {
    it('counts edges from the stats and splits files from docs by pack', () => {
        expect(graphCounts(graph({ edges: 9, sources: 3 }, [['code', 'src:r::a'], ['code', 'src:r::b'], ['docs', 'src:r::c']])))
            .toEqual({ files: 2, docs: 1, edges: 9 });
    });

    it('takes the total from the stats when the graph is truncated, and says so', () => {
        expect(graphCounts(graph({ edges: 90, sources: 500, truncated: true }, [['code', 'src:r::a'], ['docs', 'src:r::c']])))
            .toEqual({ files: 499, docs: 1, edges: 90, truncated: true });
    });
});
