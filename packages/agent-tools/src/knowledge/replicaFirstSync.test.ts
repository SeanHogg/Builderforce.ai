import { describe, expect, it, vi } from 'vitest';
import { localSnapshotStore, srcRef, type Extracted } from '@seanhogg/builderforce-memory/knowledge';
import { createReplicaQueue, memoryReplicaPersistence } from './replicaQueue.js';
import { enqueueSources } from './replicaFirstSync.js';
import { pumpReplica, type ReplicaClient } from './replicaPump.js';

describe('the first-sync case (a pack, or a root reviewed before it was linked)', () => {
    it("queues a pack's sources, then its facts and relations with the scope, reporting progress, and the pump sends them", async () => {
        const root = 'pack:docs';
        const ref = srcRef(root, 'a.md');
        const ex: Extracted = { sourceRef: ref, sourceHash: 'h1', nodes: [], edges: [], keys: [] };
        const snapshot = {
            scopes: [{ rootId: root, title: 'Docs', packs: [] }],
            extracted: { h1: [ex] },
            facts: { [root]: [{ key: 'claim:1', content: 'c', source: 'knowledge-review', importance: 0.5, origin: 'model', fileAnchors: [{ path: 'a.md' }] }] },
            relations: { [root]: [] },
        };
        const local = localSnapshotStore({ read: async () => JSON.stringify(snapshot), write: async () => undefined });
        const queue = createReplicaQueue(memoryReplicaPersistence());
        const progress = vi.fn();
        const out = await enqueueSources({ rootId: root, local, queue, current: [{ ref, hash: 'h1' }, { ref: srcRef(root, 'missing.md'), hash: 'h9' }], onProgress: progress });
        expect(out).toEqual({ sources: 1, facts: 1, relations: 0 });
        // Every source processed is counted, so the last call reaches the total even past a skipped one.
        expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);

        const write = vi.fn(async () => undefined), markStale = vi.fn(async () => undefined), putExtracted = vi.fn(async () => undefined);
        const writeRows = vi.fn(async () => undefined);
        const client: ReplicaClient = { store: { write, markStale }, putExtracted, putAnalysis: async () => undefined, writeRows };
        await pumpReplica({ queue, local, client, signal: new AbortController().signal });
        expect(putExtracted).toHaveBeenCalledWith('h1', [ex]);
        expect(markStale).toHaveBeenCalledWith({ rootId: root }, ref, 'h1');
        expect(writeRows).toHaveBeenCalledWith(root, { facts: [expect.objectContaining({ key: 'claim:1' })], relations: [] });
        // The scope rides its own final op.
        expect(write).toHaveBeenCalledWith(expect.objectContaining({ scope: expect.objectContaining({ rootId: root, title: 'Docs' }) }));
    });
});
