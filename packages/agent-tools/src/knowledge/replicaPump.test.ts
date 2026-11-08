import { describe, expect, it } from 'vitest';
import { createReplicaQueue } from './replicaQueue.js';
import { pumpReplica, type ReplicaClient, type ReplicaState } from './replicaPump.js';
import { apiError, fakeServer, world, ROOT } from './replicaTestkit.test-util.js';

const live = () => new AbortController().signal;

function pump(w: Awaited<ReturnType<typeof ready>>, client: ReplicaClient, over: Partial<Parameters<typeof pumpReplica>[0]> = {}) {
    return pumpReplica({ queue: w.queue, local: w.local, client, signal: live(), rootId: ROOT, sources: async () => w.sources, projectId: 1, ...over });
}
async function ready(files = 1) {
    const w = world();
    await w.review(0, files);
    return w;
}
/** A client whose sync always fails with `error`; everything else is the fake server's. */
const failing = (srv: ReturnType<typeof fakeServer>, error: () => unknown): ReplicaClient => ({ ...srv.client, sync: async () => { throw error(); } });

describe('pumpReplica', () => {
    it('sends ONE pack built from the local store, then reports an empty dirty set and the ack', async () => {
        const w = await ready(5);
        const srv = fakeServer();
        const states: ReplicaState[] = [];
        const state = await pump(w, srv.client, { onState: (s) => states.push(s) });
        expect(srv.syncs()).toHaveLength(1);
        expect([...srv.s.files.keys()].sort()).toEqual(w.sources.map((s) => s.ref.slice(`src:${ROOT}::`.length)).sort());
        expect(srv.s.facts.size).toBe(3);
        expect(state).toMatchObject({ dirty: 0, sending: false, failed: [] });
        expect(state.lastSyncAt).toBeTruthy();
        expect(state.lastPack).toMatchObject({ mode: 'full', parts: 1, files: 5 });
        expect(state.lastPack!.bytes).toBeLessThan(state.lastPack!.jsonBytes);
        expect(states.some((s) => s.sending)).toBe(true);
        expect(await w.queue.ack()).toMatchObject({ generation: 1 });
    });

    it('429 keeps the dirty set, waits Retry-After, never throws, and sends once the server answers', async () => {
        const w = await ready();
        const srv = fakeServer();
        for (let i = 0; i < 3; i++) srv.s.failSync.push(() => apiError(429, { retryAfterMs: 2000 }));
        const waits: number[] = [];
        const state = await pump(w, srv.client, { sleep: async (ms) => { waits.push(ms); } });
        expect(waits).toEqual([2000, 2000, 2000]);
        expect(srv.s.files.size).toBe(1);
        expect(state.dirty).toBe(0);
        expect(state.failed).toEqual([]);
    });

    it('never spins on Retry-After 0, and otherwise backs off 1s doubling to 60s with no cap on attempts', async () => {
        const w = await ready();
        const srv = fakeServer();
        const abort = new AbortController();
        const waits: number[] = [];
        const states: ReplicaState[] = [];
        const state = await pump(w, failing(srv, () => apiError(429)), {
            signal: abort.signal, onState: (s) => states.push(s), sleep: async (ms) => { waits.push(ms); if (waits.length === 9) abort.abort(); },
        });
        expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
        expect(state.dirty).toBeGreaterThan(0);
        expect(state.failed).toEqual([]);
        expect(states.some((s) => s.waitingUntil !== undefined && s.waitingFor === '429')).toBe(true);
        const stop = new AbortController();
        const seen: number[] = [];
        await pump(w, failing(srv, () => apiError(429, { retryAfterMs: 0 })), { signal: stop.signal, sleep: async (ms) => { seen.push(ms); stop.abort(); } });
        expect(seen[0]).toBeGreaterThan(0);
    });

    it('an unreachable server (status 0) waits like a 429 instead of losing the work', async () => {
        const w = await ready();
        const abort = new AbortController();
        const state = await pump(w, failing(fakeServer(), () => apiError(0)), { signal: abort.signal, sleep: async () => { abort.abort(); } });
        expect(state.dirty).toBeGreaterThan(0);
    });

    it('stops after maxTransientStreak transient failures in a row (paused: unreachable) and keeps the dirty set', async () => {
        const w = await ready();
        const state = await pump(w, failing(fakeServer(), () => apiError(503)), { sleep: async () => undefined, maxTransientStreak: 3 });
        expect(state.paused).toBe('unreachable');
        expect(state.dirty).toBeGreaterThan(0);
    });

    it('an expired token (401/403) pauses and keeps the WHOLE dirty set; the next run resumes', async () => {
        const w = await ready(3);
        const srv = fakeServer();
        const paused = await pump(w, failing(srv, () => apiError(401)));
        expect(paused).toMatchObject({ paused: 'auth', pausedStatus: 401, failed: [] });
        expect(paused.dirty).toBeGreaterThan(0);
        expect(srv.s.files.size).toBe(0);
        const resumed = await pump(w, srv.client, { initial: paused });
        expect(resumed).toMatchObject({ dirty: 0, failed: [] });
        expect(resumed.paused).toBeUndefined();
        expect(srv.s.files.size).toBe(3);
    });

    it('a 400 is recorded, the dirty set is kept for the next run, and the pump stops instead of spinning', async () => {
        const w = await ready();
        const state = await pump(w, failing(fakeServer(), () => apiError(400)));
        expect(state.failed).toEqual([{ reason: 'knowledge API 400', status: 400 }]);
        expect(state.dirty).toBeGreaterThan(0);
    });

    it('a 413 pack_too_large cuts the pack in half (by files) until it fits; nothing is lost', async () => {
        const w = await ready(8);
        const srv = fakeServer();
        srv.s.rejectOver = 3;
        const state = await pump(w, srv.client);
        expect(state.failed).toEqual([]);
        expect(state.dirty).toBe(0);
        expect(srv.s.files.size).toBe(8);
        expect(srv.syncs().length).toBeGreaterThan(2);
        expect(srv.s.generation).toBeGreaterThan(2);   // each slice that fits is one acknowledged pack (the refused ones are not)
    });

    it('stops the moment the dirty set belongs to another project, sending nothing of it', async () => {
        const w = await ready();
        await w.queue.adopt(2); // the workspace moved to project 2
        const srv = fakeServer();
        const state = await pump(w, srv.client, { projectId: 1 });
        expect(srv.log).toEqual([]);
        expect(state.paused).toBe('project');
        expect(state.dirty).toBe(0);
    });

    it('waits out a running review before each request', async () => {
        const w = await ready();
        const srv = fakeServer();
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const pumped = pump(w, srv.client, { idle: () => gate });
        await new Promise((r) => setTimeout(r, 10));
        expect(srv.log).toEqual([]);
        release();
        await pumped;
        expect(srv.syncs()).toHaveLength(1);
    });

    it('resumes from the persisted dirty set after the pump (or the process) stopped', async () => {
        const w = await ready(2);
        const abort = new AbortController();
        await pump(w, failing(fakeServer(), () => apiError(429, { retryAfterMs: 1 })), { signal: abort.signal, sleep: async () => { abort.abort(); } });
        await w.queue.flush();
        const reopened = createReplicaQueue(w.persistence);
        expect(await reopened.size()).toBeGreaterThan(0);
        const srv = fakeServer();
        const state = await pumpReplica({ queue: reopened, local: w.local, client: srv.client, signal: live(), rootId: ROOT, sources: async () => w.sources });
        expect(srv.syncs()).toHaveLength(1);
        expect(state.dirty).toBe(0);
    });

    it('never throws, whatever the client or the listener does', async () => {
        const w = await ready();
        const state = await pump(w, failing(fakeServer(), () => new TypeError('boom')), { onState: () => { throw new Error('listener'); } });
        expect(state.failed.map((f) => f.reason)).toContain('boom');
    });

    it("clears an earlier run's failures once a run drains the set without a new one", async () => {
        const w = await ready();
        const earlier: ReplicaState = { dirty: 0, sending: false, failed: [{ reason: 'old' }] };
        const state = await pump(w, fakeServer().client, { initial: earlier });
        expect(state.failed).toEqual([]);
    });
});
