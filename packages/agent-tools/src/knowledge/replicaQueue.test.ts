import { describe, expect, it, vi } from 'vitest';
import { REPLICA_WRITE_ROWS, createReplicaQueue, memoryReplicaPersistence } from './replicaQueue.js';

const scope = { rootId: 'r', title: 'r', packs: [] as string[] };
const keys = (n: number, p = 'f') => Array.from({ length: n }, (_, i) => `${p}${i}`);

describe('replica queue', () => {
    it('splits a write into chunks of at most 500 rows, with the scope as its own final op', async () => {
        const queue = createReplicaQueue(memoryReplicaPersistence());
        await queue.enqueueWrite({ rootId: 'r', scope, facts: keys(900), relations: keys(300, 'rel') });
        const ops = await queue.peek(10);
        expect(ops.map((o) => o.op)).toEqual(['write', 'write', 'write', 'scope']);
        expect(ops.slice(0, 3).map((o) => (o.op === 'write' ? o.facts.length + o.relations.length : 0))).toEqual([REPLICA_WRITE_ROWS, REPLICA_WRITE_ROWS, 200]);
    });

    it('a later write of the same rows supersedes the queued copy, and the scope stays last', async () => {
        const queue = createReplicaQueue(memoryReplicaPersistence());
        await queue.enqueueWrite({ rootId: 'r', scope, facts: ['a', 'b'], relations: [] });
        await queue.enqueueWrite({ rootId: 'r', scope: { ...scope, title: 'new' }, facts: ['b', 'c'], relations: [] });
        const ops = await queue.peek(10);
        expect(ops.map((o) => o.op)).toEqual(['write', 'scope']);
        expect(ops[0]).toMatchObject({ facts: ['a', 'b', 'c'] });
        expect(ops[1]).toMatchObject({ scope: { title: 'new' } });
    });

    it('is bound to one project: adopting another discards the first project\'s ops', async () => {
        const persistence = memoryReplicaPersistence();
        const queue = createReplicaQueue(persistence);
        expect(await queue.adopt(7)).toBe(false);
        await queue.enqueue({ op: 'putExtracted', hash: 'h1' });
        await queue.flush();
        const again = createReplicaQueue(persistence);
        expect(await again.projectId()).toBe(7);
        expect(await again.adopt(7)).toBe(false);
        expect(await again.size()).toBe(1);
        expect(await again.adopt(8)).toBe(true);
        expect(await again.size()).toBe(0);
    });

    it('keeps an unparsable file aside, reports it, and starts empty', async () => {
        const writes: string[] = [];
        const onCorrupt = vi.fn(), onError = vi.fn();
        const queue = createReplicaQueue({
            read: async () => '{ not json', write: async (t) => { writes.push(t); },
            keepAside: async (t) => { writes.push(`aside:${t}`); },
        }, { onCorrupt, onError });
        expect(await queue.size()).toBe(0);
        expect(onCorrupt).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalled();
        expect(writes).toEqual(['aside:{ not json']);
    });

    it('merges the ops another window added when it saves, without bringing back what this one sent', async () => {
        let disk: string | undefined;
        const persistence = { read: async () => disk, write: async (t: string) => { disk = t; } };
        const a = createReplicaQueue(persistence);
        await a.adopt(1);
        await a.enqueue({ op: 'putExtracted', hash: 'sent' });
        await a.flush();
        const b = createReplicaQueue(persistence);
        await b.adopt(1);
        await b.enqueue({ op: 'putExtracted', hash: 'theirs' });
        await b.flush();
        // Window A sends its op, then saves: B's op survives, A's sent op does not come back.
        await a.remove(await a.peek(1));
        await a.flush();
        const final = createReplicaQueue(persistence);
        expect((await final.peek(10)).map((o) => (o.op === 'putExtracted' ? o.hash : ''))).toEqual(['theirs']);
    });
});
