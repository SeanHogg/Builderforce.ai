// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { FIXTURE_REPORT, codeFixture, docsFixture } from './testing';
import { useKnowledgeGraph } from './useKnowledgeGraph';
import type { KnowledgeGraphSource, KnowledgeReviewEvent, KnowledgeScopeSummary } from './types';


function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const scopeOf = (g: KnowledgeGraph): KnowledgeScopeSummary => ({ rootId: g.scope.rootId, title: g.scope.rootId, packs: g.scope.packs });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

/** A source whose scopes / load / lastSeen each stay pending until the test settles them. */
function pendingSource(seen: KnowledgeGraph | null = null) {
    const scopes = deferred<KnowledgeScopeSummary[]>();
    const lastSeen = deferred<{ scopes: KnowledgeScopeSummary[]; rootId: string; graph: KnowledgeGraph } | null>();
    const loads: ReturnType<typeof deferred<KnowledgeGraph | null>>[] = [];
    const source: KnowledgeGraphSource = {
        scopes: () => scopes.promise,
        load: () => { const d = deferred<KnowledgeGraph | null>(); loads.push(d); return d.promise; },
        lastSeen: () => lastSeen.promise,
    };
    const showSeen = () => lastSeen.resolve(seen ? { scopes: [scopeOf(seen)], rootId: seen.scope.rootId, graph: seen } : null);
    return { source, scopes, lastSeen, loads, showSeen };
}

afterEach(() => { vi.useRealTimers(); });

describe('useKnowledgeGraph: last-seen graph (stale-while-revalidate)', () => {
    it('paints lastSeen before the fresh load resolves, marked stale', async () => {
        const seen = codeFixture('a');
        const p = pendingSource(seen);
        const { result } = renderHook(() => useKnowledgeGraph(p.source));
        expect(result.current.graph).toBeNull();
        p.showSeen();
        await flush();
        expect(result.current.graph).toBe(seen);
        expect(result.current.rootId).toBe('a');
        expect(result.current.status).toBe('ready');
        expect(result.current.stale).toBe(true);
    });

    it('replaces the stale graph with the fresh one', async () => {
        const seen = codeFixture('a');
        const fresh = codeFixture('a');
        const p = pendingSource(seen);
        const { result } = renderHook(() => useKnowledgeGraph(p.source));
        p.showSeen();
        await flush();
        p.scopes.resolve([scopeOf(fresh)]);
        await flush();
        p.loads[0]!.resolve(fresh);
        await flush();
        expect(result.current.graph).toBe(fresh);
        expect(result.current.stale).toBe(false);
        expect(result.current.refreshFailed).toBe(false);
    });

    it('ignores a lastSeen that resolves after the fresh read', async () => {
        const seen = codeFixture('a');
        const fresh = docsFixture('a');
        const p = pendingSource(seen);
        const { result } = renderHook(() => useKnowledgeGraph(p.source));
        p.scopes.resolve([scopeOf(fresh)]);
        await flush();
        p.loads[0]!.resolve(fresh);
        await flush();
        p.showSeen();
        await flush();
        expect(result.current.graph).toBe(fresh);
        expect(result.current.stale).toBe(false);
    });

    it('keeps the stale graph and flags refreshFailed when the fresh load fails', async () => {
        const seen = codeFixture('a');
        const p = pendingSource(seen);
        const { result } = renderHook(() => useKnowledgeGraph(p.source));
        p.showSeen();
        await flush();
        p.scopes.resolve([scopeOf(seen)]);
        await flush();
        p.loads[0]!.reject(new Error('offline'));
        await flush();
        expect(result.current.graph).toBe(seen);
        expect(result.current.status).toBe('ready');
        expect(result.current.stale).toBe(true);
        expect(result.current.refreshFailed).toBe(true);
    });

    it('a reload of the same root keeps the picture, stale until the new graph lands', async () => {
        const first = codeFixture('a');
        const second = codeFixture('a');
        const loads: ReturnType<typeof deferred<KnowledgeGraph | null>>[] = [];
        const source: KnowledgeGraphSource = {
            scopes: async () => [scopeOf(first)],
            load: () => { const d = deferred<KnowledgeGraph | null>(); loads.push(d); return d.promise; },
        };
        const { result } = renderHook(() => useKnowledgeGraph(source));
        await flush();
        loads[0]!.resolve(first);
        await flush();
        expect(result.current.graph).toBe(first);
        act(() => result.current.reload());
        await flush();
        expect(result.current.status).toBe('ready');
        expect(result.current.graph).toBe(first);
        expect(result.current.stale).toBe(true);
        loads[1]!.resolve(second);
        await flush();
        expect(result.current.graph).toBe(second);
        expect(result.current.stale).toBe(false);
    });
});

describe('useKnowledgeGraph: the graph grows during a review', () => {
    it('re-reads on progress at most once per 4s and only when the count advanced', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const g = codeFixture('a');
        const queue: KnowledgeReviewEvent[] = [];
        let wake: (() => void) | null = null;
        const events = (async function* () {
            for (;;) {
                while (queue.length === 0) await new Promise<void>((r) => { wake = r; });
                yield queue.shift()!;
            }
        })();
        const push = async (done: number) => {
            queue.push({ type: 'progress', progress: { phase: 'judge', done, total: 10, path: 'x' } });
            wake?.();
            await flush();
            await flush();
        };
        const load = vi.fn(async () => g);
        const source: KnowledgeGraphSource = { scopes: async () => [scopeOf(g)], load, review: () => events };
        const { result } = renderHook(() => useKnowledgeGraph(source));
        await flush();
        await flush();
        expect(load).toHaveBeenCalledTimes(1);

        act(() => result.current.review.start({ rootId: 'a' }));
        await push(1);
        expect(load).toHaveBeenCalledTimes(2);
        await push(2); // inside the 4s window
        expect(load).toHaveBeenCalledTimes(2);
        vi.setSystemTime(new Date('2026-01-01T00:00:05Z'));
        await push(1); // window open, but the count did not advance past the last re-read
        expect(load).toHaveBeenCalledTimes(2);
        await push(3);
        expect(load).toHaveBeenCalledTimes(3);
        expect(result.current.graph).toBe(g);
    });
});

/** A review the test feeds event by event; `load` answers per call from the queue given. */
function reviewHarness(loadAnswers: (call: number) => Promise<KnowledgeGraph | null>) {
    const queue: KnowledgeReviewEvent[] = [];
    let wake: (() => void) | null = null;
    const events = (async function* () {
        for (;;) {
            while (queue.length === 0) await new Promise<void>((r) => { wake = r; });
            yield queue.shift()!;
        }
    })();
    const push = async (event: KnowledgeReviewEvent) => {
        queue.push(event);
        wake?.();
        await flush();
        await flush();
    };
    const progress = (done: number, phase: 'extract' | 'judge' = 'judge') => push({ type: 'progress', progress: { phase, done, total: 10, path: 'x' } });
    const g = codeFixture('a');
    let calls = 0;
    const load = vi.fn(() => loadAnswers(++calls));
    const source: KnowledgeGraphSource = { scopes: async () => [scopeOf(g)], load, review: () => events };
    return { source, load, push, progress };
}

describe('useKnowledgeGraph: growth re-reads', () => {
    it('drops a growth re-read that lands after the review finished (the final load wins)', async () => {
        const g0 = codeFixture('a'), stale = codeFixture('a'), final = codeFixture('a');
        const grow = deferred<KnowledgeGraph | null>();
        const h = reviewHarness((n) => (n === 1 ? Promise.resolve(g0) : n === 2 ? grow.promise : Promise.resolve(final)));
        const { result } = renderHook(() => useKnowledgeGraph(h.source));
        await flush(); await flush();
        act(() => result.current.review.start({ rootId: 'a' }));
        await h.progress(1);
        expect(h.load).toHaveBeenCalledTimes(2); // the growth re-read, still in flight
        await h.push({ type: 'done', rootId: 'a', report: FIXTURE_REPORT });
        await flush();
        expect(result.current.graph).toBe(final);
        grow.resolve(stale);
        await flush();
        expect(result.current.graph).toBe(final);
    });

    it('re-reads once the window opens (trailing) with the latest progress, and not after the review ends', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const g = codeFixture('a');
        const h = reviewHarness(() => Promise.resolve(g));
        const { result } = renderHook(() => useKnowledgeGraph(h.source));
        await flush(); await flush();
        act(() => result.current.review.start({ rootId: 'a' }));
        await h.progress(1);
        expect(h.load).toHaveBeenCalledTimes(2);
        await h.progress(2); // inside the window: held back
        expect(h.load).toHaveBeenCalledTimes(2);
        await act(async () => { vi.advanceTimersByTime(4100); });
        await flush();
        expect(h.load).toHaveBeenCalledTimes(3); // the trailing re-read
        await h.progress(1, 'extract'); // a new phase counts as advancing, even with a lower count
        await h.push({ type: 'done', rootId: 'a', report: FIXTURE_REPORT }); // the review ends: the held re-read is cancelled
        await flush();
        const afterDone = h.load.mock.calls.length;
        await act(async () => { vi.advanceTimersByTime(10_000); });
        await flush();
        expect(h.load).toHaveBeenCalledTimes(afterDone);
    });

    it('does not grow while the review names no root, or another root', async () => {
        const g = codeFixture('a');
        const h = reviewHarness(() => Promise.resolve(g));
        const { result } = renderHook(() => useKnowledgeGraph(h.source));
        await flush(); await flush();
        act(() => result.current.review.start({}));
        await h.progress(1);
        expect(h.load).toHaveBeenCalledTimes(1);
        act(() => result.current.review.start({ rootId: 'other' }));
        await h.progress(1);
        expect(h.load).toHaveBeenCalledTimes(1);
    });
});

describe('useKnowledgeGraph: stale edge cases', () => {
    it('another root picked while the last-seen graph is stale clears to empty-with-status, and the old load is dropped', async () => {
        const seenA = codeFixture('a'), freshB = docsFixture('b');
        const loadsByRoot: Record<string, ReturnType<typeof deferred<KnowledgeGraph | null>>> = { a: deferred(), b: deferred() };
        const source: KnowledgeGraphSource = {
            scopes: async () => [scopeOf(seenA), scopeOf(freshB)],
            load: (root) => loadsByRoot[root]!.promise,
            lastSeen: async () => ({ scopes: [scopeOf(seenA)], rootId: 'a', graph: seenA }),
        };
        const { result } = renderHook(() => useKnowledgeGraph(source));
        await flush(); await flush();
        expect(result.current.graph).toBe(seenA);
        act(() => result.current.selectRoot('b'));
        await flush();
        expect(result.current.graph).toBeNull();
        expect(result.current.status).toBe('loading');
        expect(result.current.stale).toBe(false);
        loadsByRoot.a!.resolve(codeFixture('a')); // the old root answers late
        await flush();
        expect(result.current.graph).toBeNull();
        loadsByRoot.b!.resolve(freshB);
        await flush();
        expect(result.current.graph).toBe(freshB);
    });

    it('a lastSeen that rejects changes nothing: the fresh read still lands', async () => {
        const fresh = codeFixture('a');
        const source: KnowledgeGraphSource = {
            scopes: async () => [scopeOf(fresh)],
            load: async () => fresh,
            lastSeen: () => Promise.reject(new Error('disk gone')),
        };
        const { result } = renderHook(() => useKnowledgeGraph(source));
        await flush(); await flush();
        expect(result.current.graph).toBe(fresh);
        expect(result.current.status).toBe('ready');
        expect(result.current.stale).toBe(false);
    });

    it('scopes failing before lastSeen resolves: the last-seen graph still paints, flagged refreshFailed', async () => {
        const seen = codeFixture('a');
        const lastSeen = deferred<{ scopes: KnowledgeScopeSummary[]; rootId: string; graph: KnowledgeGraph } | null>();
        const source: KnowledgeGraphSource = { scopes: () => Promise.reject(new Error('offline')), load: async () => null, lastSeen: () => lastSeen.promise };
        const { result } = renderHook(() => useKnowledgeGraph(source));
        await flush(); await flush();
        expect(result.current.status).toBe('error');
        lastSeen.resolve({ scopes: [scopeOf(seen)], rootId: 'a', graph: seen });
        await flush();
        expect(result.current.graph).toBe(seen);
        expect(result.current.status).toBe('ready');
        expect(result.current.refreshFailed).toBe(true);
    });

    it('a new source (another project) never shows the old one’s graph; its own lastSeen paints', async () => {
        const gA = codeFixture('a'), seenB = docsFixture('b');
        const a: KnowledgeGraphSource = { scopes: async () => [scopeOf(gA)], load: async () => gA };
        const lastSeenB = deferred<{ scopes: KnowledgeScopeSummary[]; rootId: string; graph: KnowledgeGraph } | null>();
        const b: KnowledgeGraphSource = { scopes: () => new Promise(() => undefined), load: () => new Promise(() => undefined), lastSeen: () => lastSeenB.promise };
        const { result, rerender } = renderHook(({ s }) => useKnowledgeGraph(s), { initialProps: { s: a } });
        await flush(); await flush();
        expect(result.current.graph).toBe(gA);
        rerender({ s: b });
        await flush();
        expect(result.current.graph).toBeNull();
        expect(result.current.rootId).toBeNull();
        expect(result.current.scopes).toEqual([]);
        lastSeenB.resolve({ scopes: [scopeOf(seenB)], rootId: 'b', graph: seenB });
        await flush();
        expect(result.current.graph).toBe(seenB);
        expect(result.current.rootId).toBe('b');
        expect(result.current.stale).toBe(true);
    });
});

describe('KnowledgeGraphView: no loading gate', () => {
    it('draws the whole frame, with an inline status, while the first read is pending', () => {
        const p = pendingSource();
        render(<div style={{ height: 600 }}><KnowledgeGraphView source={p.source} /></div>);
        expect(screen.getByRole('region', { name: L.regionLabel })).toBeTruthy();
        expect(screen.getByRole('search')).toBeTruthy();
        // The inline loading status, beside the review action's own sync pill (a status too, "Not synced" until a folder is open).
        expect(screen.getAllByRole('status').map((el) => el.textContent)).toContain(L.loading);
    });

    it('paints the last-seen graph at once and offers Retry inline when the refresh fails', async () => {
        const seen = codeFixture('a');
        const source: KnowledgeGraphSource = {
            scopes: () => Promise.reject(new Error('offline')),
            load: () => Promise.reject(new Error('offline')),
            lastSeen: async () => ({ scopes: [scopeOf(seen)], rootId: 'a', graph: seen }),
        };
        render(<div style={{ height: 600 }}><KnowledgeGraphView source={source} /></div>);
        expect(await screen.findByRole('button', { name: L.refreshFailed })).toBeTruthy();
        expect(screen.queryByText(L.errorTitle)).toBeNull();
        expect(screen.queryByText(L.loading)).toBeNull();
    });
});
