import { describe, expect, it } from 'vitest';
import { pumpReplica, type PumpArgs, type ReplicaClient } from './replicaPump.js';
import { fakeServer, world, ROOT } from './replicaTestkit.test-util.js';

const SHA = 'a'.repeat(40);

/** A pump over a fresh review whose `sync` calls are recorded with the part each carried. */
async function pumped(over: Partial<PumpArgs> = {}, files = 2, bodyKb = 0) {
    const w = world();
    await (bodyKb ? w.review(0, files, 0, bodyKb) : w.review(0, files));
    const srv = fakeServer();
    const parts: Array<Parameters<ReplicaClient['sync']>[1]> = [];
    const client: ReplicaClient = { ...srv.client, sync: async (root, part) => { parts.push(part); return srv.client.sync(root, part); } };
    const state = await pumpReplica({
        queue: w.queue, local: w.local, client, signal: new AbortController().signal, rootId: ROOT, sources: async () => w.sources, projectId: 1, ...over,
    });
    return { parts, state };
}

describe('pumpReplica: the commit the review ran at', () => {
    it('sends the commit the host recorded with the pack', async () => {
        const { parts, state } = await pumped({ commitSha: async () => SHA });
        expect(parts).toHaveLength(1);
        expect(parts[0]).toMatchObject({ commitSha: SHA });
        expect(state.failed).toEqual([]);
    });

    it('sends the commit on EVERY part of a multi-part pack', async () => {
        const { parts } = await pumped({ commitSha: async () => SHA, maxPartBytes: 1000, newSyncId: () => 'sync-parts' }, 120, 8);
        expect(parts.length).toBeGreaterThan(2);
        for (const p of parts) expect(p).toMatchObject({ commitSha: SHA, syncId: 'sync-parts' });
    });

    it('sends none when nothing was recorded (not a git folder, or a dirty tree at review time) — the pack still goes', async () => {
        const { parts, state } = await pumped({ commitSha: async () => undefined });
        expect(parts).toHaveLength(1);
        expect(parts[0]).not.toHaveProperty('commitSha');
        expect(state.dirty).toBe(0);
    });

    it('a lookup that throws is REPORTED, the pack goes without a commit, and the pump is not stopped', async () => {
        const fault = new Error('review-commit file is damaged');
        const reported: Array<[string, unknown]> = [];
        const { parts, state } = await pumped({ commitSha: async () => { throw fault; }, report: (what, error) => { reported.push([what, error]); } });
        expect(reported).toEqual([['replica review commit', fault]]);
        expect(parts).toHaveLength(1);
        expect(parts[0]).not.toHaveProperty('commitSha');
        expect(state).toMatchObject({ dirty: 0, failed: [] });
    });

    it('a host that supplies no commit lookup sends none', async () => {
        const { parts } = await pumped();
        expect(parts[0]).not.toHaveProperty('commitSha');
    });
});
