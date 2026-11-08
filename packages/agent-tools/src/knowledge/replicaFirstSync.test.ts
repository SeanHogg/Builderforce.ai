import { describe, expect, it, vi } from 'vitest';
import { localSnapshotStore, srcRef, type Extracted } from '@seanhogg/builderforce-memory/knowledge';
import { createReplicaQueue, memoryReplicaPersistence } from './replicaQueue.js';
import { enqueueSources } from './replicaFirstSync.js';
import { pumpReplica } from './replicaPump.js';
import { fakeServer } from './replicaTestkit.test-util.js';

describe('the first-sync case (a pack, or a root reviewed before it was linked)', () => {
    it("owes a reconcile, counts what the local store holds, and the pump sends ONE full pack of what it holds; a file never extracted is held, dirty, not sent", async () => {
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
        const current = [{ ref, hash: 'h1' }, { ref: srcRef(root, 'missing.md'), hash: 'h9' }];
        const out = await enqueueSources({ rootId: root, local, queue, current, onProgress: progress });
        expect(out).toEqual({ sources: 1, facts: 1, relations: 0 });
        expect(progress.mock.calls).toEqual([[2, 2]]);
        expect(await queue.ack()).toBeUndefined();

        const srv = fakeServer();
        const state = await pumpReplica({ queue, local, client: srv.client, signal: new AbortController().signal, rootId: root, sources: async () => current });
        // One manifest read to learn the project holds nothing, then one pack.
        expect(srv.log.filter((l) => l.kind === 'sync')).toHaveLength(1);
        const pack = srv.syncs()[0]!.pack!;
        expect(pack.baseGeneration).toBe(0);
        expect(pack.files?.map((f) => f.path).sort()).toEqual(['a.md', 'missing.md']);
        expect(pack.extracted).toEqual([{ kind: 'full', hash: 'h1', entries: [ex] }]);
        expect(pack.facts?.map((f) => f.key)).toEqual(['claim:1']);
        expect(pack.scope).toMatchObject({ rootId: root, title: 'Docs' });
        expect(state.dirty).toBe(0);
    });
});
