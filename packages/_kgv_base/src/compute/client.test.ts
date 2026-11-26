import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputeClient, type ComputeTaskEvent } from './client';
import { getComputeClient, setComputeProbe, setWorkerFactory } from './sharedClient';
import { FakeWorker, flush, makeGraph } from './testKit';

const RAW = { ok: 1 } as never;

function setup() {
    const workers: FakeWorker[] = [];
    const client = new ComputeClient(() => { const w = new FakeWorker(); workers.push(w); return w; });
    const calls = { done: vi.fn(), fail: vi.fn() };
    const ask = (graph = makeGraph(2)) => client.run('insights', { graph }, calls);
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
        for (let i = 0; i < 4; i++) client.residency.graphId(makeGraph(1)); // the 5th graph evicts the first
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
    it('a clone error on one request settles it in-process and keeps the worker for the next', async () => {
        const { client, ask, worker, calls } = setup();
        let first = true;
        worker().throwOn = (m) => { if (m.type !== 'run' || !first) return false; first = false; return true; };
        ask();
        await flush();
        await settled(calls);
        expect(client.isInProcess).toBe(false);
        expect(worker().terminated).toBe(false);
        ask();
        await flush();
        expect(worker().runs()).toHaveLength(1);
    });

    it('a post that finds its graph already evicted re-runs the request instead of dropping it', async () => {
        const { client, ask, worker } = setup();
        const graph = makeGraph(2);
        ask(graph);
        for (let i = 0; i < 4; i++) client.residency.graphId(makeGraph(1)); // evicts `graph` before the load settles and the run posts
        await flush();
        const runs = worker().runs();
        expect(runs.length).toBeGreaterThan(0);
        expect(runs.every((r) => client.residency.isLive(r.graph))).toBe(true);
    });

    it('a load that throws does not poison the graph or leave the request pending', async () => {
        const { client, ask, worker, calls } = setup();
        worker().throwOn = (m) => m.type === 'load-begin';
        ask();
        await flush();
        expect(client.isInProcess).toBe(false); // only that graph runs here; the worker stays
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

describe('ComputeClient probe', () => {
    const recorder = () => { const events: ComputeTaskEvent[] = []; return { events, probe: { task: (e: ComputeTaskEvent) => { events.push(e); } } }; };

    it('a run at the worker emits one worker event', async () => {
        const { client, ask } = setup();
        const { events, probe } = recorder();
        client.probe = probe;
        ask();
        await flush();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ kind: 'insights', realm: 'worker', attempt: 0 });
    });

    it('with no worker, a run emits main-idle', async () => {
        const client = new ComputeClient(() => null);
        const { events, probe } = recorder();
        client.probe = probe;
        const calls = { done: vi.fn(), fail: vi.fn() };
        client.run('insights', { graph: makeGraph(0) }, calls);
        expect(events.map((e) => e.realm)).toEqual(['main-idle']);
        await vi.waitFor(() => expect(calls.done.mock.calls.length + calls.fail.mock.calls.length).toBe(1), { timeout: 5000 });
    });

    it('runSync emits main-inline', () => {
        const client = new ComputeClient(() => null);
        const { events, probe } = recorder();
        client.probe = probe;
        client.runSync('insights', { graph: makeGraph(0) });
        expect(events).toMatchObject([{ kind: 'insights', realm: 'main-inline', attempt: 0 }]);
    });

    it('a worker failOver rerun emits main-idle after the worker event', async () => {
        const { client, ask, worker, calls } = setup();
        const { events, probe } = recorder();
        client.probe = probe;
        ask();
        await flush();
        worker().onerror?.({});
        await settled(calls);
        expect(events.map((e) => e.realm)).toEqual(['worker', 'main-idle']);
    });

    it('a probe that throws does not break the run', async () => {
        const { client, ask, calls, worker } = setup();
        client.probe = { task: () => { throw new Error('probe bug'); } };
        ask();
        await flush();
        const [run] = worker().runs();
        worker().done(run!, RAW);
        expect(calls.done).toHaveBeenCalledWith(RAW);
    });

    it('setComputeProbe reaches a client built after setWorkerFactory', () => {
        const { probe } = recorder();
        try {
            setComputeProbe(probe);
            expect(getComputeClient().probe).toBe(probe);
            setWorkerFactory(() => new FakeWorker());
            expect(getComputeClient().probe).toBe(probe);
            setComputeProbe(null);
            expect(getComputeClient().probe).toBeNull();
        } finally {
            setComputeProbe(null);
            setWorkerFactory(null);
        }
    });
});
