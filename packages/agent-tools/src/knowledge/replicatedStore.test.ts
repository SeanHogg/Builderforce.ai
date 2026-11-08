import { describe, expect, it, vi } from 'vitest';
import { localSnapshotStore, srcRef, type Extracted, type KnowledgeStore } from '@seanhogg/builderforce-memory/knowledge';
import { createReplicaQueue, factKey, fileKey, memoryReplicaPersistence, relationKey } from './replicaQueue.js';
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
const dirtyOf = async (queue: ReturnType<typeof createReplicaQueue>) => (await queue.snapshot()).keys.sort();

describe('replicatedKnowledgeStore', () => {
    it('writes land in the local store first and mark KEYS dirty for the replica, never bodies', async () => {
        const local = memoryLocal();
        const queue = createReplicaQueue(memoryReplicaPersistence());
        const store = replicatedKnowledgeStore({ local, rootId: ROOT, replica: {}, queue });

        await store.write({ scope, facts: [fact], relations: [relation] });
        await store.putExtracted!('h1', [extracted('h1')]);
        await store.markStale({ rootId: ROOT }, srcRef(ROOT, 'a.md'), 'h1');

        expect(await local.facts({ rootId: ROOT })).toHaveLength(1);
        expect(await local.getExtracted!('h1')).toEqual([extracted('h1')]);
        expect(await dirtyOf(queue)).toEqual([factKey('claim:1'), fileKey('a.md', 'h1'), relationKey(relation)].sort());
        expect(JSON.stringify(await queue.snapshot())).not.toContain('"content"');
    });

    it('marks nothing for a write that changed nothing: unchanged files, facts and relations', async () => {
        const local = memoryLocal();
        const queue = createReplicaQueue(memoryReplicaPersistence());
        const known = new Map([[srcRef(ROOT, 'a.md') as string, 'h1']]);
        const store = replicatedKnowledgeStore({ local, rootId: ROOT, replica: {}, queue, knownHashes: async () => known });
        await store.markStale({ rootId: ROOT }, srcRef(ROOT, 'a.md'), 'h1');              // same hash as the last review
        await store.putExtracted!('h1', [extracted('h1')]);
        expect(await queue.size()).toBe(0);
        await store.write({ scope, facts: [fact], relations: [relation] });
        await queue.settle(await queue.snapshot(), { generation: 1, digest: 'd' });
        await store.write({ scope, facts: [fact], relations: [relation] });                 // the same rows again
        expect(await queue.size()).toBe(0);
        await store.write({ scope, facts: [{ ...fact, content: 'changed' }], relations: [] });
        expect(await dirtyOf(queue)).toEqual([factKey('claim:1')]);
        await store.markStale({ rootId: ROOT }, srcRef(ROOT, 'a.md'), 'h2');               // a real change
        expect(await dirtyOf(queue)).toContain(fileKey('a.md', 'h2'));
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

    it('marks nothing without a replica (an unlinked root)', async () => {
        const queue = createReplicaQueue(memoryReplicaPersistence());
        const store = replicatedKnowledgeStore({ local: memoryLocal(), rootId: ROOT, queue });
        await store.write({ scope, facts: [fact], relations: [] });
        await store.markStale({ rootId: ROOT }, srcRef(ROOT, 'a.md'), 'h1');
        expect(await queue.size()).toBe(0);
    });

    it('coalesces rewrites of one hash and persists the dirty set through its port', async () => {
        const persistence = memoryReplicaPersistence();
        const queue = createReplicaQueue(persistence);
        const store = replicatedKnowledgeStore({ local: memoryLocal(), rootId: ROOT, replica: {}, queue });
        await store.putExtracted!('h1', [extracted('h1')]);
        await store.putExtracted!('h1', [extracted('h1')]);
        await store.write({ scope, facts: [fact], relations: [] });
        await store.write({ scope, facts: [{ ...fact, key: 'claim:2' }], relations: [] });
        await queue.flush();
        const reopened = createReplicaQueue(persistence);
        expect(await dirtyOf(reopened)).toEqual([factKey('claim:1'), factKey('claim:2'), fileKey('a.md', 'h1')].sort());
    });

    it('calls onQueued after keys were marked, and a failing queue never fails the write', async () => {
        const onQueued = vi.fn(), onError = vi.fn();
        const queue = createReplicaQueue(memoryReplicaPersistence());
        const store = replicatedKnowledgeStore({ local: memoryLocal(), rootId: ROOT, replica: {}, queue, onQueued, onError });
        await store.write({ scope, facts: [fact], relations: [] });
        expect(onQueued).toHaveBeenCalledTimes(1);
        const broken = { ...queue, markDirty: () => { throw new Error('disk'); } };
        const bad = replicatedKnowledgeStore({ local: memoryLocal(), rootId: ROOT, replica: {}, queue: broken, onError });
        await expect(bad.write({ scope, facts: [fact], relations: [] })).resolves.toBeUndefined();
        expect(onError).toHaveBeenCalled();
    });

    it('read-through seeds the local extracted cache from the server and skips extraction for the hits, without marking them', async () => {
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

    it("the seed also copies the root's human-authored facts into the local store, once, without marking them", async () => {
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

    it('regression: an entry for a source arriving where the body was [] (or lacked that source) marks its file dirty again, at the same hash', async () => {
        const local = memoryLocal();
        const queue = createReplicaQueue(memoryReplicaPersistence());
        const known = new Map([[srcRef(ROOT, 'a.md') as string, 'h1']]);
        const store = replicatedKnowledgeStore({ local, rootId: ROOT, replica: {}, queue, knownHashes: async () => known });
        await store.putExtracted!('h1', []);                      // recorded as "nothing extracted"
        expect(await dirtyOf(queue)).toEqual([]);                 // same hash as the last review: not a change
        await store.putExtracted!('h1', [extracted('h1')]);       // now it has a real entry: the project's entry-less marker must be replaced
        expect(await dirtyOf(queue)).toEqual([fileKey('a.md', 'h1')]);
    });

    it('regression: a re-checked hash answered with [] (nothing extracted) wakes the pump too, not only a real body', async () => {
        const local = memoryLocal();
        const queue = createReplicaQueue(memoryReplicaPersistence());
        const onQueued = vi.fn();
        const known = new Map([[srcRef(ROOT, 'a.md') as string, 'h1']]);
        const store = replicatedKnowledgeStore({ local, rootId: ROOT, replica: {}, queue, onQueued, knownHashes: async () => known });
        await store.markRecheck!(['h1']);   // the pump held the file back and asked the next review about it
        await store.putExtracted!('h1', []); // the review answers: nothing to extract (a binary file)
        expect(onQueued).toHaveBeenCalledTimes(1);
        await store.putExtracted!('h9', []); // an unrelated [] wakes nothing
        expect(onQueued).toHaveBeenCalledTimes(1);
    });

    it('regression: a live edit (stale first, output after) kicks the pump again when the output lands, so a held-back file settles without a review', async () => {
        const local = memoryLocal();
        const queue = createReplicaQueue(memoryReplicaPersistence());
        const onQueued = vi.fn();
        const store = replicatedKnowledgeStore({ local, rootId: ROOT, replica: {}, queue, onQueued });

        await store.markStale({ rootId: ROOT }, srcRef(ROOT, 'a.md'), 'h2'); // as markFilesEdited does, before extractFile
        expect(onQueued).toHaveBeenCalledTimes(1);                              // the pump may now run and hold the file back
        await store.putExtracted!('h2', [{ ...extracted('h2') }]);              // the same hash: not a change, but the output the pump waited for
        expect(onQueued).toHaveBeenCalledTimes(2);

        await store.putExtracted!('h3', [{ ...extracted('h3'), sourceRef: srcRef(ROOT, 'b.md') }]); // output with nothing waiting: no extra kick beyond its own mark
        expect(onQueued.mock.calls.length).toBe(3);
    });
});
