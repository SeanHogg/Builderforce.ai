import { describe, expect, it, vi } from 'vitest';
import { localSnapshotStore, srcRef, type Extracted, type StoredFact } from '@seanhogg/builderforce-memory/knowledge';
import { createReplicaQueue, memoryReplicaPersistence } from './replicaQueue.js';
import { replicatedKnowledgeStore } from './replicatedStore.js';
import { pumpReplica, type ReplicaClient, type ReplicaState } from './replicaPump.js';

const ROOT = 'docs';
const scope = { rootId: ROOT, title: 'docs', packs: ['docs'] };
const fact = (key: string): StoredFact => ({ key, content: 'c', source: 'knowledge-review', importance: 0.5, origin: 'model', fileAnchors: [{ path: 'a.md' }] });
const extracted = (hash: string): Extracted => ({ sourceRef: srcRef(ROOT, 'a.md'), sourceHash: hash, nodes: [], edges: [], keys: [] });

/** An error shaped like the knowledge client's. */
const apiError = (status: number, retryAfterMs?: number) => Object.assign(new Error(`knowledge API ${status}`), { status, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });

async function setup(opts: { facts?: number; projectId?: number; persistence?: ReturnType<typeof memoryReplicaPersistence> } = {}) {
    let text: string | undefined;
    const local = localSnapshotStore({ read: async () => text, write: async (t) => { text = t; } });
    const persistence = opts.persistence ?? memoryReplicaPersistence();
    const queue = createReplicaQueue(persistence);
    const store = replicatedKnowledgeStore({ local, replica: { projectId: opts.projectId ?? 1 }, queue });
    await store.putExtracted!('h1', [extracted('h1')]);
    await store.markStale({ rootId: ROOT }, srcRef(ROOT, 'a.md'), 'h1');
    await store.write({ scope, facts: Array.from({ length: opts.facts ?? 1 }, (_, i) => fact(`claim:${i}`)), relations: [] });
    return { local, queue, persistence };
}

type Calls = { writeRows?: (rows: { facts: unknown[]; relations: unknown[] }) => Promise<void>; putExtracted?: () => Promise<void>; markStale?: () => Promise<void>; scope?: () => Promise<void> };
function client(over: Calls = {}) {
    const calls = {
        scope: vi.fn(over.scope ?? (async () => undefined)),
        writeRows: vi.fn(over.writeRows ?? (async () => undefined)),
        putExtracted: vi.fn(over.putExtracted ?? (async () => undefined)),
        markStale: vi.fn(over.markStale ?? (async () => undefined)),
    };
    const c: ReplicaClient = {
        store: { write: calls.scope as never, markStale: calls.markStale as never },
        putExtracted: calls.putExtracted as never,
        putAnalysis: async () => undefined,
        writeRows: ((_root: string, rows: { facts: unknown[]; relations: unknown[] }) => calls.writeRows(rows)) as never,
    };
    return { c, calls };
}
const run = (a: Parameters<typeof pumpReplica>[0]) => pumpReplica(a);
const live = () => new AbortController().signal;

describe('pumpReplica', () => {
    it('sends the queue (bodies read from the local store), the scope last, then reports an empty queue', async () => {
        const { local, queue } = await setup();
        const { c, calls } = client();
        const states: ReplicaState[] = [];
        const state = await run({ queue, local, client: c, signal: live(), projectId: 1, onState: (s) => states.push(s) });
        expect(calls.putExtracted).toHaveBeenCalledWith('h1', [extracted('h1')]);
        expect(calls.writeRows).toHaveBeenCalledWith({ facts: [expect.objectContaining({ key: 'claim:0' })], relations: [] });
        expect(calls.scope).toHaveBeenCalledWith({ scope, facts: [], relations: [] });
        expect(calls.scope.mock.invocationCallOrder[0]!).toBeGreaterThan(calls.writeRows.mock.invocationCallOrder[0]!);
        expect(state).toMatchObject({ queued: 0, sending: false, skipped: 0, failed: [] });
        expect(state.lastSyncAt).toBeTruthy();
        expect(states.some((s) => s.sending)).toBe(true);
    });

    it('429 on every call keeps the queue, waits Retry-After, never throws, and sends once the server answers', async () => {
        const { local, queue } = await setup();
        let rejected = 0;
        const { c, calls } = client({ putExtracted: async () => { if (rejected++ < 3) throw apiError(429, 2000); } });
        const waits: number[] = [];
        const state = await run({ queue, local, client: c, signal: live(), sleep: async (ms) => { waits.push(ms); } });
        expect(waits).toEqual([2000, 2000, 2000]);
        expect(calls.putExtracted).toHaveBeenCalledTimes(4);
        expect(state.queued).toBe(0);
        expect(state.failed).toEqual([]);
    });

    it('never spins on Retry-After 0, and otherwise backs off 1s doubling to 60s with no cap on attempts', async () => {
        const { local, queue } = await setup();
        const { c } = client({ putExtracted: async () => { throw apiError(429); } });
        const abort = new AbortController();
        const waits: number[] = [];
        const states: ReplicaState[] = [];
        const state = await run({
            queue, local, client: c, signal: abort.signal, onState: (s) => states.push(s),
            sleep: async (ms) => { waits.push(ms); if (waits.length === 9) abort.abort(); },
        });
        expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
        expect(state.queued).toBe(4);
        expect(state.failed).toEqual([]);
        expect(states.some((s) => s.waitingUntil !== undefined && s.waitingFor === '429')).toBe(true);
        const zero = client({ putExtracted: async () => { throw apiError(429, 0); } });
        const stop = new AbortController();
        const seen: number[] = [];
        await run({ queue, local, client: zero.c, signal: stop.signal, sleep: async (ms) => { seen.push(ms); stop.abort(); } });
        expect(seen[0]).toBeGreaterThan(0);
    });

    it('an unreachable server (status 0) waits like a 429 instead of losing the op', async () => {
        const { local, queue } = await setup();
        const { c } = client({ putExtracted: async () => { throw apiError(0); } });
        const abort = new AbortController();
        const state = await run({ queue, local, client: c, signal: abort.signal, sleep: async () => { abort.abort(); } });
        expect(state.queued).toBe(4);
    });

    it('stops after maxTransientStreak transient failures in a row (paused: unreachable) and keeps the queue', async () => {
        const { local, queue } = await setup();
        const { c } = client({ putExtracted: async () => { throw apiError(503); } });
        const state = await run({ queue, local, client: c, signal: live(), sleep: async () => undefined, maxTransientStreak: 3 });
        expect(state.paused).toBe('unreachable');
        expect(state.queued).toBe(4);
    });

    it('an expired token (401/403) pauses and keeps the WHOLE queue; the next run resumes', async () => {
        const { local, queue } = await setup();
        const denied = client({ putExtracted: async () => { throw apiError(401); } });
        const paused = await run({ queue, local, client: denied.c, signal: live() });
        expect(paused).toMatchObject({ paused: 'auth', pausedStatus: 401, queued: 4, failed: [], skipped: 0 });
        expect(denied.calls.writeRows).not.toHaveBeenCalled();
        const ok = client();
        const resumed = await run({ queue, local, client: ok.c, signal: live(), initial: paused });
        expect(resumed).toMatchObject({ queued: 0, failed: [] });
        expect(resumed.paused).toBeUndefined();
    });

    it('a 400 is a permanent failure: recorded and removed while the rest goes on', async () => {
        const { local, queue } = await setup();
        const { c, calls } = client({ markStale: async () => { throw apiError(400); } });
        const state = await run({ queue, local, client: c, signal: live() });
        expect(state.failed).toEqual([{ op: 'markStale', reason: 'knowledge API 400', status: 400 }]);
        expect(calls.scope).toHaveBeenCalledTimes(1);
        expect(state.queued).toBe(0);
    });

    it('a 413 splits a write in half and retries down to one row; only the row that is still refused is skipped, and the scope is written', async () => {
        const { local, queue } = await setup({ facts: 1200 });
        const { c, calls } = client({
            writeRows: async (rows) => {
                if (rows.facts.length > 1 || (rows.facts[0] as StoredFact | undefined)?.key === 'claim:700') throw apiError(413);
            },
        });
        const state = await run({ queue, local, client: c, signal: live() });
        expect(state.skipped).toBe(1);
        expect(state.skippedOps).toEqual([{ op: 'write', key: 'claim:700' }]);
        const sentKeys = calls.writeRows.mock.calls.filter(([rows]) => rows.facts.length === 1 && (rows.facts[0] as StoredFact).key !== 'claim:700').length;
        expect(sentKeys).toBe(1199);
        expect(calls.scope).toHaveBeenCalledTimes(1);
        expect(state.queued).toBe(0);
        expect(state.failed).toEqual([]);
    });

    it('a 429 mid-sequence resumes at the failed chunk, not chunk 0', async () => {
        const { local, queue } = await setup({ facts: 1200 });
        const seen: string[] = [];
        let failedOnce = false;
        const { c } = client({
            writeRows: async (rows) => {
                const first = (rows.facts[0] as StoredFact).key;
                if (first === 'claim:500' && !failedOnce) { failedOnce = true; throw apiError(429, 1000); }
                seen.push(first);
            },
        });
        await run({ queue, local, client: c, signal: live(), sleep: async () => undefined });
        // chunk 0 is sent once; chunk 1 failed once and was retried; chunk 0 was not re-sent.
        expect(seen).toEqual(['claim:0', 'claim:500', 'claim:1000']);
    });

    it('sends in queue order: a stale-marking queued after a write never reaches the server before its rows', async () => {
        let text: string | undefined;
        const local = localSnapshotStore({ read: async () => text, write: async (t) => { text = t; } });
        const queue = createReplicaQueue(memoryReplicaPersistence());
        const store = replicatedKnowledgeStore({ local, replica: {}, queue });
        await store.write({ scope, facts: [fact('claim:0')], relations: [] });
        await store.markStale({ rootId: ROOT }, srcRef(ROOT, 'a.md'), 'h2');
        const { c, calls } = client();
        await run({ queue, local, client: c, signal: live() });
        expect(calls.writeRows.mock.invocationCallOrder[0]!).toBeLessThan(calls.markStale.mock.invocationCallOrder[0]!);
    });

    it('stops the moment the queue belongs to another project, sending nothing of it', async () => {
        const { local, queue } = await setup({ projectId: 1 });
        await queue.adopt(2); // the workspace moved to project 2: project 1's ops are gone
        const { c, calls } = client();
        const state = await run({ queue, local, client: c, signal: live(), projectId: 1 });
        expect(calls.putExtracted).not.toHaveBeenCalled();
        expect(calls.writeRows).not.toHaveBeenCalled();
        expect(state.queued).toBe(0);
    });

    it('waits out a running review before each send', async () => {
        const { local, queue } = await setup();
        const { c, calls } = client();
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const pumped = run({ queue, local, client: c, signal: live(), idle: () => gate });
        await new Promise((r) => setTimeout(r, 10));
        expect(calls.putExtracted).not.toHaveBeenCalled();
        release();
        await pumped;
        expect(calls.putExtracted).toHaveBeenCalledTimes(1);
    });

    it('resumes from the persisted queue after the pump (or the process) stopped', async () => {
        const first = await setup();
        const refusing = client({ putExtracted: async () => { throw apiError(429, 1); } });
        const abort = new AbortController();
        await run({ queue: first.queue, local: first.local, client: refusing.c, signal: abort.signal, sleep: async () => { abort.abort(); } });
        await first.queue.flush();
        const reopened = createReplicaQueue(first.persistence);
        expect(await reopened.size()).toBe(4);
        const { c, calls } = client();
        const state = await run({ queue: reopened, local: first.local, client: c, signal: live() });
        expect(calls.putExtracted).toHaveBeenCalledTimes(1);
        expect(calls.writeRows).toHaveBeenCalledTimes(1);
        expect(state.queued).toBe(0);
    });

    it('never throws, whatever the client or the listener does', async () => {
        const { local, queue } = await setup();
        const { c } = client({ writeRows: async () => { throw new TypeError('boom'); } });
        const state = await run({ queue, local, client: c, signal: live(), onState: () => { throw new Error('listener'); } });
        expect(state.failed.map((f) => f.reason)).toContain('boom');
    });

    it('clears an earlier run\'s failures once a run drains the queue without a new one', async () => {
        const { local, queue } = await setup();
        const { c } = client();
        const earlier: ReplicaState = { queued: 0, sending: false, skipped: 0, skippedOps: [], failed: [{ op: 'markStale', reason: 'old' }] };
        const state = await run({ queue, local, client: c, signal: live(), initial: earlier });
        expect(state.failed).toEqual([]);
    });
});
