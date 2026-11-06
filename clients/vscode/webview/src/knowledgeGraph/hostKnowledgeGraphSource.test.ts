import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeGraph, ReviewPlan, ReviewReport } from '@seanhogg/builderforce-memory/knowledge';
import { ReviewFailure, type KnowledgeReviewEvent } from '@builderforce/knowledge-graph-view';
import type { KnowledgeCall, KnowledgeEvent } from '../../../src/knowledge/knowledgeProtocol';
import { ABORT_GRACE_MS, createHostKnowledgeGraphSource, reviewCount, type KnowledgeTransport } from './hostKnowledgeGraphSource';

const PLAN: ReviewPlan = { rootId: 'ws', files: 2, byPack: { docs: 2 }, unchanged: 0, changed: ['a.md', 'b.md'], removed: [], skipped: [], estimatedModelCalls: 2 };
const REPORT: ReviewReport = {
  rootId: 'ws', digest: 'd', extracted: 2, judged: 2, unjudged: 0, invalidJudgements: 0, factsWritten: 2, relationsWritten: 1,
  staleMarked: 2, aborted: false, durationMs: 1, readErrors: 0,
};
const GRAPH: KnowledgeGraph = {
  scope: { rootId: 'ws', packs: ['docs'], digest: 'd' }, nodes: [], edges: [], findings: [],
  stats: { sources: 0, nodes: 0, edges: 0, stale: 0, truncated: false },
};

/** A scripted host: records every call; `run` posts progress then the report. */
function fakeHost(opts: { cancel?: boolean; fail?: boolean; holdPlan?: boolean; silentRun?: boolean; failPlan?: boolean; failCheck?: string; failDetail?: { detail: string; host: string; rootPath: string } } = {}) {
  const calls: KnowledgeCall[] = [];
  const listeners = new Set<(e: KnowledgeEvent) => void>();
  const emit = (e: KnowledgeEvent) => { for (const l of [...listeners]) l(e); };
  const t: KnowledgeTransport = {
    async call<T>(call: KnowledgeCall): Promise<T> {
      calls.push(call);
      switch (call.op) {
        case 'plan': {
          // Answers at once (null); the outcome is an EVENT on the caller's stream.
          const { stream } = call;
          if (!opts.holdPlan) {
            queueMicrotask(() => emit(opts.failPlan
              ? { stream, type: 'failed', error: 'planning blew up' }
              : { stream, type: 'planned', reply: opts.cancel ? { cancelled: true } : { reviewId: 'r1', rootId: 'ws', plan: PLAN } }));
          }
          return null as T;
        }
        case 'run':
          if (opts.silentRun) return { started: true } as T;
          queueMicrotask(() => {
            emit({ stream: 'r1', type: 'progress', progress: { phase: 'extract', done: 1, total: 2, path: 'a.md' } });
            emit({ stream: 'other', type: 'failed', error: 'not mine' });
            emit(opts.fail ? { stream: 'r1', type: 'failed', error: 'disk full', ...opts.failDetail } : { stream: 'r1', type: 'done', rootId: 'ws', report: REPORT });
          });
          return { started: true } as T;
        case 'factActions': return { canDelete: call.ref === 'fact:note:1' } as T;
        case 'runFixCheck':
          if (opts.failCheck === call.check) throw new Error('the host went away');
          return { status: 'pass' } as T;
        default: return null as T;
      }
    },
    onEvent(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
  const planStream = (): string => (calls.find((c) => c.op === 'plan') as Extract<KnowledgeCall, { op: 'plan' }>).stream;
  return { t, calls, emit, listeners, planStream };
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

  it('carries the host detail (stack, build, folder) on the thrown error', async () => {
    const failDetail = { detail: 'Error: disk full\n    at write (store.ts:1)', host: 'BuilderForce for VS Code 1.2.3', rootPath: '/work/docs' };
    const host = fakeHost({ fail: true, failDetail });
    const err = await drain(createHostKnowledgeGraphSource(host.t).review!({}, control(true))).then(() => undefined, (e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewFailure);
    expect(err).toMatchObject({ message: 'disk full', ...failDetail });
  });

  it('throws a failure without detail when the host sent none', async () => {
    const host = fakeHost({ fail: true });
    const err = await drain(createHostKnowledgeGraphSource(host.t).review!({}, control(true))).then(() => undefined, (e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewFailure);
    expect((err as ReviewFailure).detail).toBeUndefined();
  });
});

describe('the editor knowledge source — planning rides the stream, not a request', () => {
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('is answered only by an event: the plan call itself carries no plan', async () => {
    const host = fakeHost({ holdPlan: true });
    const it = createHostKnowledgeGraphSource(host.t).review!({ rootId: 'ws' }, control(true));
    const first = it.next();
    await tick();
    expect(host.calls.map((c) => c.op)).toEqual(['plan']);
    let settled = false;
    void first.then(() => { settled = true; });
    await tick();
    expect(settled).toBe(false); // no request answered it; only the event can
    host.emit({ stream: host.planStream(), type: 'planned', reply: { reviewId: 'r1', rootId: 'ws', plan: PLAN } });
    expect((await first).value).toMatchObject({ type: 'plan' });
    await it.return(undefined);
  });

  it('surfaces a failed plan as a ReviewFailure', async () => {
    const host = fakeHost({ failPlan: true });
    const err = await drain(createHostKnowledgeGraphSource(host.t).review!({}, control(true))).then(() => undefined, (e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewFailure);
    expect(err).toMatchObject({ message: 'planning blew up' });
    expect(host.listeners.size).toBe(0);
  });

  it('discards the host session when the review is stopped while planning', async () => {
    const host = fakeHost({ holdPlan: true });
    const abort = new AbortController();
    const done = drain(createHostKnowledgeGraphSource(host.t).review!({}, control(true, abort.signal)));
    await tick();
    abort.abort();
    expect(await done).toEqual([]); // Stop ends the run quietly: no `cancelled` over the consumer's 'aborted'
    host.emit({ stream: host.planStream(), type: 'planned', reply: { reviewId: 'r9', rootId: 'ws', plan: PLAN } });
    await tick();
    expect(host.calls.at(-1)).toEqual({ op: 'discard', reviewId: 'r9' });
    expect(host.listeners.size).toBe(0);
  });

  it('reports the review active from its start to its end, however it ends', async () => {
    const host = fakeHost();
    const seen: boolean[] = [];
    const source = createHostKnowledgeGraphSource(host.t, { onReviewActive: (a) => seen.push(a) });
    await drain(source.review!({}, control(false)));
    await expect(drain(createHostKnowledgeGraphSource(fakeHost({ failPlan: true }).t, { onReviewActive: (a) => seen.push(a) }).review!({}, control(true)))).rejects.toThrow();
    expect(seen).toEqual([true, false, true, false]);
  });

  it('keeps the flag held while a superseding review is live after the first one ends', async () => {
    const host = fakeHost();
    const seen: boolean[] = [];
    const source = createHostKnowledgeGraphSource(host.t, { onReviewActive: (a) => seen.push(a) });
    const first = source.review!({}, control(true));
    const second = source.review!({}, control(true));
    await first.next(); // plan yielded: first is live
    await second.next(); // second is live too
    await first.return(undefined); // the superseded one ends while the second is live
    let count = 0;
    const counts = seen.map((a) => (count = reviewCount(count, a)));
    expect(seen).toEqual([true, true, false]);
    expect(counts).toEqual([1, 2, 1]); // never 0 while the second review is live
    await second.return(undefined);
    expect(reviewCount(counts.at(-1)!, false)).toBe(0);
  });
});

describe('the editor knowledge source — Stop with a silent host', () => {
  const abortAtConfirm = () => {
    const abort = new AbortController();
    return { confirm: async () => { abort.abort(); return true; }, signal: abort.signal };
  };
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('lets go once the grace period passes without a terminal event', async () => {
    const host = fakeHost({ silentRun: true });
    const seen: boolean[] = [];
    const source = createHostKnowledgeGraphSource(host.t, { onReviewActive: (a) => seen.push(a) });
    let events: KnowledgeReviewEvent[] | undefined;
    void drain(source.review!({}, abortAtConfirm())).then((e) => { events = e; });
    await vi.advanceTimersByTimeAsync(ABORT_GRACE_MS - 1);
    expect(events).toBeUndefined();
    expect(seen).toEqual([true]);
    await vi.advanceTimersByTimeAsync(1);
    expect(events?.map((e) => e.type)).toEqual(['plan']);
    expect(seen).toEqual([true, false]);
    expect(host.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(host.calls.some((c) => c.op === 'stop')).toBe(true);
  });

  it('still yields a done report that arrives inside the grace period', async () => {
    const host = fakeHost({ silentRun: true });
    let events: KnowledgeReviewEvent[] | undefined;
    void drain(createHostKnowledgeGraphSource(host.t).review!({}, abortAtConfirm())).then((e) => { events = e; });
    await vi.advanceTimersByTimeAsync(ABORT_GRACE_MS / 2);
    host.emit({ stream: 'r1', type: 'done', rootId: 'ws', report: { ...REPORT, aborted: true } });
    await vi.advanceTimersByTimeAsync(0);
    expect(events?.map((e) => e.type)).toEqual(['plan', 'done']);
    expect(events?.[1]).toMatchObject({ report: { aborted: true } });
    expect(host.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
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

  it('asks the host for the last-seen graph, and reads a failed call as nothing remembered', async () => {
    const host = fakeHost();
    expect(await createHostKnowledgeGraphSource(host.t).lastSeen!()).toBeNull();
    expect(host.calls.at(-1)).toEqual({ op: 'lastSeen' });
    const broken: KnowledgeTransport = { call: () => Promise.reject(new Error('no host')), onEvent: () => () => undefined };
    expect(await createHostKnowledgeGraphSource(broken).lastSeen!()).toBeNull();
  });
});

describe('the editor knowledge source — the staged fix steps', () => {
  const finding = { id: 'f', kind: 'unused-file', pack: 'code', nodes: ['src:ws::a.ts'], severity: 'info', params: {} } as never;
  const checksOf = (host: ReturnType<typeof fakeHost>) => host.calls.filter((c) => c.op === 'runFixCheck').map((c) => (c as { check: string }).check);

  it('runs the three host checks one by one (the review is the agent\'s), reporting each as it starts and as it settles', async () => {
    const host = fakeHost();
    const seen: string[] = [];
    const source = createHostKnowledgeGraphSource(host.t);
    const results = await source.runFixChecks!({ finding, applied: { changed: ['a.ts'] } }, (u) => seen.push(`${u.id}:${u.status}`));
    expect(checksOf(host)).toEqual(['types', 'tests', 'rescan']);
    expect(seen).toEqual(['types:running', 'types:pass', 'tests:running', 'tests:pass', 'rescan:running', 'rescan:pass']);
    expect(results.map((r) => r.id)).toEqual(['types', 'tests', 'rescan']);
    expect(host.calls.filter((c) => c.op === 'runFixCheck').every((c) => (c as { finding?: unknown }).finding === finding)).toBe(true); // the re-scan needs the finding
  });

  it('a check that cannot run is reported as an error on it, keeps the results already received, and stops there', async () => {
    const host = fakeHost({ failCheck: 'tests' });
    const seen: Array<{ id: string; status: string; detail?: string | undefined }> = [];
    const source = createHostKnowledgeGraphSource(host.t);
    await expect(source.runFixChecks!({ finding, applied: { changed: [] } }, (u) => seen.push(u))).rejects.toThrow('the host went away');
    expect(seen.map((u) => `${u.id}:${u.status}`)).toEqual(['types:running', 'types:pass', 'tests:running', 'tests:error']);
    expect(seen.at(-1)!.detail).toBe('the host went away');
    expect(checksOf(host)).toEqual(['types', 'tests']); // rescan never started
  });

  it('aborting the request cancels the running check in the extension, and stops starting new ones', async () => {
    const host = fakeHost();
    const control = new AbortController();
    const source = createHostKnowledgeGraphSource(host.t);
    const run = source.runFixChecks!({ finding, applied: { changed: [] }, signal: control.signal }, (u) => { if (u.id === 'types' && u.status === 'pass') control.abort(); });
    await expect(run).rejects.toThrow('cancelled');
    expect(host.calls.some((c) => c.op === 'cancelFixCheck' && (c as { rootId: string }).rootId === 'ws')).toBe(true);
    expect(checksOf(host)).toEqual(['types']);
  });

  it('undoes by the fix id alone (never paths), and refuses a fix with no id or a finding that names no root, by code', async () => {
    const host = fakeHost();
    const source = createHostKnowledgeGraphSource(host.t);
    await source.undoFix!({ finding, applied: { changed: ['a.ts'], fixId: 'fix-1' } });
    expect(host.calls.at(-1)).toEqual({ op: 'undoFix', rootId: 'ws', fixId: 'fix-1' });
    await expect(source.undoFix!({ finding, applied: { changed: ['a.ts'] } })).rejects.toMatchObject({ code: 'noRecord' });
    await expect(source.undoFix!({ finding: { ...(finding as object), nodes: [] } as never, applied: { changed: [], fixId: 'x' } })).rejects.toMatchObject({ code: 'noRoot' });
    await expect(source.applyFix!({ ...(finding as object), nodes: [] } as never)).rejects.toMatchObject({ code: 'noRoot' });
  });

  it('marks a finding resolved by recording a fact on its first file (the Add fact path), and previews through the host', async () => {
    const host = fakeHost();
    const source = createHostKnowledgeGraphSource(host.t);
    await source.markResolved!(finding);
    expect(host.calls.at(-1)).toEqual({ op: 'remember', rootId: 'ws', ref: 'src:ws::a.ts', content: 'Resolved: unused-file (f)' });
    await source.previewFix!(finding);
    expect(host.calls.at(-1)).toMatchObject({ op: 'previewFix', rootId: 'ws' });
  });

  it('lists exactly the kinds the knip codemod fixes', () => {
    expect(createHostKnowledgeGraphSource(fakeHost().t).applyFixKinds).toEqual(['unused-export', 'unused-file']);
  });
});
