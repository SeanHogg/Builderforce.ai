import { describe, expect, it, vi } from 'vitest';
import { createReplicaQueue, factKey, fileKey, memoryReplicaPersistence, relationKey } from './replicaQueue.js';

const keys = (n: number) => Array.from({ length: n }, (_, i) => fileKey(`src/dir${i % 50}/file-${i}.ts`, ''));

describe('replica dirty set', () => {
    it('deduplicates keys and counts them', async () => {
        const queue = createReplicaQueue(memoryReplicaPersistence());
        queue.markDirty(['f:a', 'f:b']);
        queue.markDirty(['f:b', 'a:claim:1']);
        expect(await queue.size()).toBe(3);
    });

    it('settles only the keys that were not marked again after the pump read them', async () => {
        const queue = createReplicaQueue(memoryReplicaPersistence());
        queue.markDirty(['f:a', 'f:b']);
        const snap = await queue.snapshot();
        queue.markDirty(['f:b']);                        // changed again while the pack was in flight
        await queue.settle(snap, { generation: 3, digest: 'd' });
        expect((await queue.snapshot()).keys).toEqual(['f:b']);
        expect(await queue.ack()).toEqual({ generation: 3, digest: 'd' });
    });

    it('is bound to one project: adopting another discards the first project\'s keys and ack', async () => {
        const persistence = memoryReplicaPersistence();
        const queue = createReplicaQueue(persistence);
        expect(await queue.adopt(7)).toBe(false);
        queue.markDirty(['f:a']);
        await queue.settle(await queue.snapshot(), { generation: 1, digest: 'd' }, []);
        await queue.flush();
        const again = createReplicaQueue(persistence);
        expect(await again.projectId()).toBe(7);
        expect(await again.adopt(7)).toBe(false);
        expect(await again.size()).toBe(1);
        expect(await again.adopt(8)).toBe(true);
        expect(await again.size()).toBe(0);
        expect(await again.ack()).toBeUndefined();
    });

    it('keeps an unparsable file aside, reports it, and starts empty with no ack (the next sync reconciles)', async () => {
        const writes: string[] = [];
        const onCorrupt = vi.fn(), onError = vi.fn();
        const queue = createReplicaQueue({
            read: async () => '{ not json', write: async (t) => { writes.push(t); },
            keepAside: async (t) => { writes.push(`aside:${t}`); },
        }, { onCorrupt, onError });
        expect(await queue.size()).toBe(0);
        expect(await queue.ack()).toBeUndefined();
        expect(onCorrupt).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalled();
        expect(writes).toEqual(['aside:{ not json']);
    });

    it('saves at most once per interval and only when something changed, never inside a mark', async () => {
        vi.useFakeTimers();
        try {
            const writes: string[] = [];
            const queue = createReplicaQueue({ read: async () => undefined, write: async (t) => { writes.push(t); } }, { saveEveryMs: 1000 });
            for (let i = 0; i < 500; i++) queue.markDirty([`f:${i}`]);
            await vi.advanceTimersByTimeAsync(999);
            expect(writes).toHaveLength(0);
            await vi.advanceTimersByTimeAsync(2);
            expect(writes).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(5000);
            expect(writes).toHaveLength(1);
        } finally { vi.useRealTimers(); }
    });

    it('the saved set for an 18,838-file root is under 1 MB', async () => {
        let saved = '';
        const queue = createReplicaQueue({ read: async () => undefined, write: async (t) => { saved = t; } });
        queue.markDirty(keys(18_838));
        await queue.flush();
        expect(saved.length).toBeLessThan(1024 * 1024);
        expect(JSON.parse(saved).dirty).toHaveLength(18_838);
    });

    it('converts an op log left by an older version to dirty keys (keys only), then deletes it', async () => {
        const oldLog = JSON.stringify({
            version: 1, projectId: 4,
            ops: [
                { op: 'write', rootId: 'r', facts: ['claim:1'], relations: [relationKey({ from: 'a', to: 'b', kind: 'about' }).slice(2)] },
                { op: 'scope', scope: { rootId: 'r', title: 'r', packs: [] } },
                { op: 'putExtracted', hash: 'h1' },
                { op: 'markStale', rootId: 'r', sourceRef: 'src:r::docs/a.md', hash: 'h1' },
            ],
        });
        const remove = vi.fn(async () => undefined);
        const queue = createReplicaQueue(memoryReplicaPersistence(), { legacy: { read: async () => oldLog, remove } });
        const snap = await queue.snapshot();
        expect(snap.keys.sort()).toEqual([factKey('claim:1'), relationKey({ from: 'a', to: 'b', kind: 'about' }), fileKey('docs/a.md', '')].sort());
        expect(snap.ack).toBeUndefined();
        expect(await queue.projectId()).toBe(4);
        expect(remove).toHaveBeenCalledTimes(1);
    });

    it('converts an op log found in its own file too, and rewrites it as a dirty set', async () => {
        let disk: string | undefined = JSON.stringify({ version: 1, ops: [{ op: 'write', rootId: 'r', facts: ['k'], relations: [] }] });
        const queue = createReplicaQueue({ read: async () => disk, write: async (t) => { disk = t; } });
        expect(await queue.size()).toBe(1);
        await queue.flush();
        expect(JSON.parse(disk!)).toMatchObject({ version: 2, dirty: ['a:k'] });
    });

    it('carries the analysis snapshot until a pack that held it is acknowledged', async () => {
        const queue = createReplicaQueue(memoryReplicaPersistence());
        queue.setAnalysis({ sha: 's1', snapshot: { nodes: [] } });
        const snap = await queue.snapshot();
        expect(snap.analysis?.sha).toBe('s1');
        await queue.settle(snap, { generation: 1, digest: 'd' }, [], true);
        expect((await queue.snapshot()).analysis).toBeUndefined();
    });

    it('replaceDirty makes the set exactly what a reconcile decided', async () => {
        const queue = createReplicaQueue(memoryReplicaPersistence());
        queue.markDirty(['f:a', 'f:b', 'f:c']);
        await queue.replaceDirty(['f:b']);
        expect((await queue.snapshot()).keys).toEqual(['f:b']);
    });
});
