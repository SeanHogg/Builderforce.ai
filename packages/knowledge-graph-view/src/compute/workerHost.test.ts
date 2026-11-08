import { describe, expect, it } from 'vitest';
import type { GraphId, WorkerOut } from './protocol';
import { streamGraph } from './loader';
import { ComputeStore } from './store';
import { HANDLERS } from './tasks';
import { makeGraph } from './testKit';
import { createWorkerHost, type WorkerHost } from './workerHost';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup(handlers?: typeof HANDLERS) {
    const replies: WorkerOut[] = [];
    const host = createWorkerHost({ reply: (m) => { replies.push(m); }, tick, handlers });
    return { host, replies };
}

/** Streams a graph into the host through the real loader, as the client does. */
async function load(host: WorkerHost, id: GraphId, n = 3): Promise<ReturnType<typeof makeGraph>> {
    const graph = makeGraph(n);
    await streamGraph({ id, graph, live: true } as never, (m) => { host.handle(m); return true; });
    return graph;
}

async function settle(host: WorkerHost): Promise<void> {
    for (let i = 0; i < 50 && !host.idle(); i++) await tick();
    await tick();
}

describe('createWorkerHost', () => {
    it('runs a task against a loaded graph and replies with what the handler returns', async () => {
        const { host, replies } = setup();
        const graph = await load(host, 1);
        host.handle({ type: 'run', id: 7, graph: 1, kind: 'insights', req: { graph: 1 } });
        await settle(host);

        const direct = new ComputeStore();
        direct.adopt(1, graph);
        const task = HANDLERS.insights(direct, { graph: 1 }) as { step(): boolean; result(): unknown };
        while (!task.step());

        expect(replies).toHaveLength(1);
        expect(replies[0]).toMatchObject({ type: 'done', id: 7, graph: 1 });
        expect((replies[0] as { raw: unknown }).raw).toEqual(task.result());
        expect(host.idle()).toBe(true);
    });

    it('a cancel that arrives before the task starts yields no reply', async () => {
        const { host, replies } = setup();
        await load(host, 1);
        host.handle({ type: 'cancel', id: 3 });
        host.handle({ type: 'run', id: 3, graph: 1, kind: 'insights', req: { graph: 1 } });
        await settle(host);
        expect(replies).toHaveLength(0);
        expect(host.idle()).toBe(true);
    });

    it('a run on a graph that is not resident replies failed', async () => {
        const { host, replies } = setup();
        host.handle({ type: 'run', id: 4, graph: 99, kind: 'insights', req: { graph: 99 } });
        await settle(host);
        expect(replies).toEqual([{ type: 'failed', id: 4, graph: 99, message: 'graph 99 is not resident' }]);
        expect(host.idle()).toBe(true);
    });

    it('a dropped graph is no longer resident', async () => {
        const { host, replies } = setup();
        await load(host, 1);
        host.handle({ type: 'drop', graph: 1 });
        host.handle({ type: 'run', id: 5, graph: 1, kind: 'insights', req: { graph: 1 } });
        await settle(host);
        expect(replies[0]).toMatchObject({ type: 'failed', id: 5 });
    });

    it('uses the handlers table it was given', async () => {
        const calls: string[] = [];
        const wrapped = { ...HANDLERS, insights: ((store: ComputeStore, req: { graph: number }) => {
            calls.push('insights');
            return (HANDLERS.insights as (s: ComputeStore, r: unknown) => unknown)(store, req);
        }) } as unknown as typeof HANDLERS;
        const { host, replies } = setup(wrapped);
        await load(host, 1);
        host.handle({ type: 'run', id: 8, graph: 1, kind: 'insights', req: { graph: 1 } });
        await settle(host);
        expect(calls).toEqual(['insights']);
        expect(replies[0]).toMatchObject({ type: 'done', id: 8 });
    });
});
