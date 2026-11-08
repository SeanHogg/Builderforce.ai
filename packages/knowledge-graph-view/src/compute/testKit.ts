/** Fixtures for the compute tests: a small graph, and a fake worker that records what it was sent and replies when told to. */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { GraphId, WorkerIn, WorkerOut } from './protocol';
import type { WorkerLike } from './workerFactory';

/** A graph of `n` nodes in a chain; fresh arrays and objects every call. */
export function makeGraph(n = 3): KnowledgeGraph {
    const nodes = Array.from({ length: n }, (_, i) => ({ ref: `n${i}`, importance: 1, kind: 'file', label: `n${i}` }));
    const edges = nodes.slice(1).map((node, i) => ({ from: nodes[i]!.ref, to: node.ref, kind: 'references', weight: 1 }));
    return {
        scope: { rootId: 'root', packs: [], digest: '' }, nodes, edges, findings: [],
        stats: { sources: 0, nodes: n, edges: edges.length, stale: 0, truncated: false },
    } as unknown as KnowledgeGraph;
}

export class FakeWorker implements WorkerLike {
    sent: WorkerIn[] = [];
    terminated = false;
    /** Makes a post throw (a DataCloneError) when it returns true. */
    throwOn: ((message: WorkerIn) => boolean) | null = null;
    onmessage: WorkerLike['onmessage'] = null;
    onerror: WorkerLike['onerror'] = null;
    onmessageerror: WorkerLike['onmessageerror'] = null;

    postMessage(message: WorkerIn): void {
        if (this.throwOn?.(message)) throw new Error('DataCloneError');
        this.sent.push(message);
    }

    terminate(): void { this.terminated = true; }

    reply(message: WorkerOut): void { this.onmessage?.({ data: message }); }

    runs(): Array<Extract<WorkerIn, { type: 'run' }>> { return this.sent.filter((m): m is Extract<WorkerIn, { type: 'run' }> => m.type === 'run'); }

    of(type: WorkerIn['type']): WorkerIn[] { return this.sent.filter((m) => m.type === type); }

    done(run: { id: number; graph: GraphId }, raw: unknown): void { this.reply({ type: 'done', id: run.id, graph: run.graph, raw }); }
}

/** Lets the client's microtasks and zero-delay timers (the load stream) run. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
