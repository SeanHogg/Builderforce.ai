import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputeClient } from './client';
import { FakeWorker, flush, makeGraph } from './testKit';

const RAW = { ok: 1 } as never;

function setup() {
    const workers: FakeWorker[] = [];
    const client = new ComputeClient(() => { const w = new FakeWorker(); workers.push(w); return w; });
    const calls = { done: vi.fn(), fail: vi.fn() };
    const ask = (graph = makeGraph(0)) => client.run('insights', { graph }, calls);
    return { client, workers, calls, ask, worker: () => workers[workers.length - 1]! };
}

/** Waits until exactly one callback has been called. */
const settled = (calls: { done: ReturnType<typeof vi.fn>; fail: ReturnType<typeof vi.fn> }) =>
    vi.waitFor(() => expect(calls.done.mock.calls.length + calls.fail.mock.calls.length).toBe(1), { timeout: 5000 });

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('ComputeClient cancel', () => {
    it('cancelled before the post: nothing is posted and nothing delivered', async () => {
        const { ask, worker, calls } = setup();
        ask()();
        await flush();
        expect(worker().runs()).toHaveLength(0);
        expect(calls.done).not.toHaveBeenCalled();
    });

    it('cancelled after the post: the worker is told, and a late reply is ignored', async () => {
        const { ask, worker, calls } = setup();
        const cancel = ask();
        await flush();
        const [run] = worker().runs();
        cancel();
        expect(worker().of('cancel')).toEqual([{ type: 'cancel', id: run!.id }]);
        worker().done(run!, RAW);
        expect(calls.done).not.toHaveBeenCalled();
    });
});

describe('ComputeClient replies', () => {
    it('delivers once; an unknown id and a repeated reply are ignored', async () => {
        const { ask, worker, calls } = setup();
        ask();
        await flush();
        const [run] = worker().runs();
        worker().reply({ type: 'done', id: 9999, graph: run!.graph, raw: RAW });
        worker().done(run!, RAW);
        worker().done(run!, RAW);
        expect(calls.done).toHaveBeenCalledTimes(1);
        expect(calls.done).toHaveBeenCalledWith(RAW);
    });

    it('a failed reply fails the caller', async () => {
        const { ask, worker, calls } = setup();
        ask();
        await flush();
        const [run] = worker().runs();
        worker().reply({ type: 'failed', id: run!.id, graph: run!.graph, message: 'boom' });
        expect(calls.fail).toHaveBeenCalledTimes(1);
    });

    it('a reply for a graph evicted mid-flight re-runs the request instead of dropping it', async () => {
        const { client, ask, worker, calls } = setup();
        ask();
        await flush();
        const [first] = worker().runs();
        for (let i = 0; i < 3; i++) client.residency.graphId(makeGraph(1)); // the 4th graph evicts the first
        await Promise.resolve();
        expect(client.residency.isLive(first!.graph)).toBe(false);
        worker().done(first!, RAW);
        expect(calls.done).not.toHaveBeenCalled();
        await flush();
        const runs = worker().runs();
        expect(runs).toHaveLength(2);
        expect(runs[1]!.graph).not.toBe(first!.graph);
        worker().done(runs[1]!, RAW);
        expect(calls.done).toHaveBeenCalledWith(RAW);
    });
});

describe('ComputeClient failure', () => {
    it('a post that throws fails the worker over and the request still settles in-process', async () => {
        const { client, ask, worker, calls } = setup();
        worker().throwOn = (m) => m.type === 'run';
        ask();
        await flush();
        expect(client.isInProcess).toBe(true);
        expect(worker().terminated).toBe(true);
        await settled(calls);
    });

    it('a load that throws does not poison the graph or leave the request pending', async () => {
        const { client, ask, worker, calls } = setup();
        worker().throwOn = (m) => m.type === 'load-begin';
        ask();
        await flush();
        expect(client.isInProcess).toBe(true);
        await settled(calls);
    });

    it.each(['onerror', 'onmessageerror'] as const)('%s re-runs the work the worker owed, in-process', async (hook) => {
        const { client, ask, worker, calls } = setup();
        ask();
        await flush();
        expect(worker().runs()).toHaveLength(1);
        worker()[hook]?.({});
        expect(client.isInProcess).toBe(true);
        expect(worker().terminated).toBe(true);
        await settled(calls);
        expect(console.warn).toHaveBeenCalledTimes(1);
    });
});

describe('ComputeClient lifecycle', () => {
    it('retire re-runs what is owed in-process; a revive streams the graph to the new worker', async () => {
        vi.useFakeTimers();
        const { client, workers, calls } = setup();
        const graph = makeGraph(0);
        client.retain();
        client.run('insights', { graph }, calls);
        await vi.advanceTimersByTimeAsync(0);
        client.release();
        await vi.advanceTimersByTimeAsync(10_001);
        expect(workers[0]!.terminated).toBe(true);
        await vi.advanceTimersByTimeAsync(100);
        expect(calls.done.mock.calls.length + calls.fail.mock.calls.length).toBe(1);
        expect(client.isInProcess).toBe(false);

        client.retain();
        expect(workers).toHaveLength(2);
        client.run('insights', { graph }, { done: vi.fn(), fail: vi.fn() });
        await vi.advanceTimersByTimeAsync(0);
        expect(workers[1]!.of('load-begin')).toHaveLength(1);
        expect(workers[1]!.runs()).toHaveLength(1);
    });
});

describe('ComputeClient in-process fallback', () => {
    it('with no Worker, warns ONCE naming the reason and computes on the main thread', async () => {
        const client = new ComputeClient(() => null);
        const calls = { done: vi.fn(), fail: vi.fn() };
        expect(client.isInProcess).toBe(true);
        client.run('insights', { graph: makeGraph(0) }, calls);
        client.run('insights', { graph: makeGraph(0) }, calls);
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(String((console.warn as unknown as { mock: { calls: string[][] } }).mock.calls[0]![0])).toContain('no Worker');
        await vi.waitFor(() => expect(calls.done.mock.calls.length + calls.fail.mock.calls.length).toBe(2), { timeout: 5000 });
    });

    it('a spawn that throws falls back and says why', () => {
        const client = new ComputeClient(() => { throw new Error('CSP blocked the worker'); });
        expect(client.isInProcess).toBe(true);
        expect(String((console.warn as unknown as { mock: { calls: string[][] } }).mock.calls[0]![0])).toContain('CSP blocked the worker');
    });
});
