import { describe, expect, it, vi } from 'vitest';
import { localSnapshotStore, srcRef, type Extracted, type KnowledgeStore } from '@seanhogg/builderforce-memory/knowledge';
import { createReplicaQueue, memoryReplicaPersistence, relationKey } from './replicaQueue.js';
import { replicatedKnowledgeStore } from './replicatedStore.js';

const ROOT = 'docs';
const scope = { rootId: ROOT, title: 'docs', packs: ['docs'] };
const fact = { key: 'claim:1', content: 'c', source: 'knowledge-review', importance: 0.5, origin: 'model' as const, fileAnchors: [{ path: 'a.md' }] };
const relation = { from: 'fact:claim:1' as never, to: srcRef(ROOT, 'a.md'), kind: 'about', weight: 1, origin: 'model' as const };
const extracted = (hash: string): Extracted => ({ sourceRef: srcRef(ROOT, 'a.md'), sourceHash: hash, nodes: [], edges: [], keys: [] });

function memoryLocal(): KnowledgeStore {
    let text: string | undefined;
    return localSnapshotStore({ read: async () => text, write: async (t) => { text = t; } });
}

describe('replicatedKnowledgeStore', () => {
    it('writes land in the local store first and are queued for the replica by key and hash, never by body', async () => {
        const local = memoryLocal();
        const queue = createReplicaQueue(memoryReplicaPersistence());
        const store = replicatedKnowledgeStore({ local, replica: {}, queue });

        await store.write({ scope, facts: [fact], relations: [relation] });
        await store.putExtracted!('h1', [extracted('h1')]);
        await store.markStale({ rootId: ROOT }, srcRef(ROOT, 'a.md'), 'h1');

        expect(await local.facts({ rootId: ROOT })).toHaveLength(1);
        expect(await local.getExtracted!('h1')).toEqual([extracted('h1')]);
        const ops = await queue.peek(10);
        // Queue order is the order of the calls above (write, then the scope op it brought, then the hash ops):
        // rows by key (≤ 500 per op), the scope as its own op. (My earlier expectation listed the hash ops first, which was
        // the wrong order for this test's calls — the store was queuing all four.)
        expect(ops).toEqual([
            { op: 'write', rootId: ROOT, facts: ['claim:1'], relations: [relationKey(relation)] },
            { op: 'scope', scope },
            { op: 'putExtracted', hash: 'h1' },
            { op: 'markStale', rootId: ROOT, sourceRef: srcRef(ROOT, 'a.md'), hash: 'h1' },
        ]);
        expect(JSON.stringify(ops)).not.toContain('"content"');
    });

    it('reads come from the local store only', async () => {
        const local = memoryLocal();
        await local.write({ scope, facts: [fact], relations: [] });
        const spy = vi.spyOn(local, 'facts');
        const queue = createReplicaQueue(memoryReplicaPersistence());
        const store = replicatedKnowledgeStore({ local, replica: {}, queue });
        expect(await store.facts({ rootId: ROOT })).toHaveLength(1);
        expect(await store.scopes()).toHaveLength(1);
        expect(spy).toHaveBeenCalled();
        expect(await queue.size()).toBe(0);
    });

    it('queues nothing without a replica (an unlinked root)', async () => {
        const queue = createReplicaQueue(memoryReplicaPersistence());
        const store = replicatedKnowledgeStore({ local: memoryLocal(), queue });
        await store.write({ scope, facts: [fact], relations: [] });
        expect(await queue.size()).toBe(0);
    });

    it('coalesces rewrites of one hash and persists the queue through its port', async () => {
        const persistence = memoryReplicaPersistence();
        const queue = createReplicaQueue(persistence);
        const store = replicatedKnowledgeStore({ local: memoryLocal(), replica: {}, queue });
        await store.putExtracted!('h1', [extracted('h1')]);
        await store.putExtracted!('h1', [extracted('h1')]);
        await store.write({ scope, facts: [fact], relations: [] });
        await store.write({ scope, facts: [{ ...fact, key: 'claim:2' }], relations: [] });
        await queue.flush();
        const reopened = createReplicaQueue(persistence);
        const ops = await reopened.peek(10);
        expect(ops.map((o) => o.op)).toEqual(['putExtracted', 'write', 'scope']);
        expect(ops[1]).toMatchObject({ facts: ['claim:1', 'claim:2'] });
    });

    it('read-through seeds the local extracted cache from the server and skips extraction for the hits, without queueing them', async () => {
        const local = memoryLocal();
        const queue = createReplicaQueue(memoryReplicaPersistence());
        const server = new Map<string, Extracted[]>([['h-server', [extracted('h-server')]]]);
        const readThrough = {
            preloadExtracted: vi.fn(async () => undefined),
            getExtracted: vi.fn(async (hash: string) => server.get(hash)),
        };
        const store = replicatedKnowledgeStore({ local, replica: { readThrough }, queue });

        await store.preloadExtracted!(['h-server', 'h-miss']);

        expect(readThrough.preloadExtracted).toHaveBeenCalledWith(['h-server', 'h-miss']);
        expect(await store.getExtracted!('h-server')).toEqual([extracted('h-server')]);
        expect(await store.getExtracted!('h-miss')).toBeUndefined();
        expect(await queue.size()).toBe(0);
    });

    it("the seed also copies the root's human-authored facts into the local store, once, without queueing them", async () => {
        const local = memoryLocal();
        const queue = createReplicaQueue(memoryReplicaPersistence());
        const note = { ...fact, key: 'note:1', origin: 'human' as const };
        const humanKnowledge = vi.fn(async () => ({ facts: [note], relations: [] }));
        const store = replicatedKnowledgeStore({
            local, rootId: ROOT, replica: { readThrough: { humanKnowledge, getExtracted: async () => undefined, preloadExtracted: async () => undefined } }, queue,
        });
        await store.preloadExtracted!(['h1']);
        await store.preloadExtracted!(['h2']);
        expect((await local.facts({ rootId: ROOT })).map((f) => f.key)).toEqual(['note:1']);
        expect(humanKnowledge).toHaveBeenCalledTimes(1);
        expect(await queue.size()).toBe(0);
    });

    it('a server that cannot be reached ends the seed quietly: the review extracts as usual', async () => {
        const onError = vi.fn();
        const readThrough = {
            preloadExtracted: vi.fn(async () => undefined),
            getExtracted: vi.fn(async () => { throw new Error('offline'); }),
        };
        const store = replicatedKnowledgeStore({
            local: memoryLocal(), replica: { readThrough }, queue: createReplicaQueue(memoryReplicaPersistence()), onError,
        });
        await expect(store.preloadExtracted!(['h1', 'h2'])).resolves.toBeUndefined();
        expect(readThrough.getExtracted).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledTimes(1);
    });
});
