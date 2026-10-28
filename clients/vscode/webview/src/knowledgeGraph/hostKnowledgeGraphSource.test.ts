import { describe, expect, it } from 'vitest';
import type { KnowledgeGraph, ReviewPlan, ReviewReport } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeReviewEvent } from '@builderforce/knowledge-graph-view';
import type { KnowledgeCall, KnowledgeEvent } from '../../../src/knowledge/knowledgeProtocol';
import { createHostKnowledgeGraphSource, type KnowledgeTransport } from './hostKnowledgeGraphSource';

const PLAN: ReviewPlan = { rootId: 'ws', files: 2, byPack: { docs: 2 }, unchanged: 0, changed: ['a.md', 'b.md'], removed: [], skipped: [], estimatedModelCalls: 2 };
const REPORT: ReviewReport = {
  rootId: 'ws', digest: 'd', extracted: 2, judged: 2, unjudged: 0, invalidJudgements: 0, factsWritten: 2, relationsWritten: 1,
  staleMarked: 2, aborted: false, durationMs: 1,
};
const GRAPH: KnowledgeGraph = {
  scope: { rootId: 'ws', packs: ['docs'], digest: 'd' }, nodes: [], edges: [], findings: [],
  stats: { sources: 0, nodes: 0, edges: 0, stale: 0, truncated: false },
};

/** A scripted host: records every call; `run` posts progress then the report. */
function fakeHost(opts: { cancel?: boolean; fail?: boolean } = {}) {
  const calls: KnowledgeCall[] = [];
  const listeners = new Set<(e: KnowledgeEvent) => void>();
  const emit = (e: KnowledgeEvent) => { for (const l of [...listeners]) l(e); };
  const t: KnowledgeTransport = {
    async call<T>(call: KnowledgeCall): Promise<T> {
      calls.push(call);
      switch (call.op) {
        case 'plan': return (opts.cancel ? { cancelled: true } : { reviewId: 'r1', rootId: 'ws', plan: PLAN }) as T;
        case 'run':
          queueMicrotask(() => {
            emit({ stream: 'r1', type: 'progress', progress: { phase: 'extract', done: 1, total: 2, path: 'a.md' } });
            emit({ stream: 'other', type: 'failed', error: 'not mine' });
            emit(opts.fail ? { stream: 'r1', type: 'failed', error: 'disk full' } : { stream: 'r1', type: 'done', rootId: 'ws', report: REPORT });
          });
          return { started: true } as T;
        case 'factActions': return { canDelete: call.ref === 'fact:note:1' } as T;
        default: return null as T;
      }
    },
    onEvent(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
  return { t, calls, emit, listeners };
}

async function drain(it: AsyncIterable<KnowledgeReviewEvent>): Promise<KnowledgeReviewEvent[]> {
  const out: KnowledgeReviewEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const control = (answer: boolean, signal = new AbortController().signal) => ({ confirm: async () => answer, signal });

describe('the editor knowledge source — the review handshake', () => {
  it('plans, waits for the confirm, runs, and streams progress then the report', async () => {
    const host = fakeHost();
    const events = await drain(createHostKnowledgeGraphSource(host.t).review!({ rootId: 'ws' }, control(true)));
    expect(events.map((e) => e.type)).toEqual(['plan', 'progress', 'done']);
    expect(host.calls.map((c) => c.op)).toEqual(['plan', 'run']);
    expect(host.listeners.size).toBe(0);
  });

  it('writes nothing when the person cancels: the planned review is discarded', async () => {
    const host = fakeHost();
    const events = await drain(createHostKnowledgeGraphSource(host.t).review!({ force: true }, control(false)));
    expect(events.map((e) => e.type)).toEqual(['plan', 'cancelled']);
    expect(host.calls.map((c) => c.op)).toEqual(['plan', 'discard']);
  });

  it('is cancelled when no folder was picked', async () => {
    const host = fakeHost({ cancel: true });
    expect((await drain(createHostKnowledgeGraphSource(host.t).review!({ pick: true }, control(true)))).map((e) => e.type)).toEqual(['cancelled']);
  });

  it('stops the host review when the signal aborts', async () => {
    const host = fakeHost();
    const abort = new AbortController();
    const it = createHostKnowledgeGraphSource(host.t).review!({ rootId: 'ws' }, { confirm: async () => { abort.abort(); return true; }, signal: abort.signal });
    await drain(it);
    expect(host.calls.some((c) => c.op === 'stop')).toBe(true);
  });

  it('surfaces a failed review as an error', async () => {
    const host = fakeHost({ fail: true });
    await expect(drain(createHostKnowledgeGraphSource(host.t).review!({}, control(true)))).rejects.toThrow('disk full');
  });
});

describe('the editor knowledge source — the rest of the port', () => {
  it('subscribes live graphs on its own stream, with the overlay, and unsubscribes', () => {
    const host = fakeHost();
    const seen: Array<{ g: KnowledgeGraph; changed: readonly string[] }> = [];
    const source = createHostKnowledgeGraphSource(host.t, { overlay: (g, changed) => { seen.push({ g, changed }); return g; } });
    const got: KnowledgeGraph[] = [];
    const stop = source.subscribeLive!('ws', (g) => got.push(g));
    const live = host.calls.find((c) => c.op === 'live') as Extract<KnowledgeCall, { op: 'live' }>;
    host.emit({ stream: live.stream, type: 'graph', graph: GRAPH, changed: ['a.md'] });
    host.emit({ stream: 'elsewhere', type: 'graph', graph: GRAPH, changed: [] });
    stop();
    expect(got).toHaveLength(1);
    expect(seen[0]?.changed).toEqual(['a.md']);
    expect(host.calls.at(-1)).toEqual({ op: 'unlive', stream: live.stream });
  });

  it('offers Delete only on facts the host says this viewer may delete', async () => {
    const host = fakeHost();
    const source = createHostKnowledgeGraphSource(host.t);
    expect(await source.factActions!('fact:note:2')).toBeUndefined();
    const actions = await source.factActions!('fact:note:1');
    await actions?.delete?.();
    expect(host.calls.at(-1)).toEqual({ op: 'deleteFact', ref: 'fact:note:1' });
  });

  it('remembers a fact on the root it was added in', async () => {
    const host = fakeHost();
    await createHostKnowledgeGraphSource(host.t).rememberFact!({ content: 'billing is here', ref: 'src:ws::a.ts', rootId: 'ws' });
    expect(host.calls.at(-1)).toEqual({ op: 'remember', rootId: 'ws', ref: 'src:ws::a.ts', content: 'billing is here' });
  });
});
