import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { createLoadTimeline, timedSource } from './loadTimeline';
import { currentLoadPhase, paintOf, useTimedSource } from './useLoadTiming';
import type { KnowledgeGraphSource } from './types';

const graph = { nodes: [{ ref: 'a' }, { ref: 'b' }], edges: [{}] } as unknown as KnowledgeGraph;

function clock() {
    let t = 100;
    return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('loadTimeline', () => {
    it('records each call relative to mount, with its outcome and counts', async () => {
        const c = clock();
        const timeline = createLoadTimeline(c.now);
        const source: KnowledgeGraphSource = {
            scopes: async () => { c.advance(30); return [{ rootId: 'r', title: 'R', packs: [] }]; },
            load: async () => { c.advance(200); return graph; },
            lastSeen: async () => { c.advance(5); return null; },
        };
        const timed = timedSource(source, timeline);
        c.advance(10);
        await timed.lastSeen!();
        await timed.scopes();
        await timed.load('r', { focus: ['a'] });
        timeline.painted('fresh');
        const snap = timeline.snapshot();
        expect(snap.marks).toEqual([
            { call: 'lastSeen', startMs: 10, endMs: 15, outcome: 'miss' },
            { call: 'scopes', startMs: 15, endMs: 45, outcome: 'ok', count: 1 },
            { call: 'load', rootId: 'r', focus: true, startMs: 45, endMs: 245, outcome: 'ok', nodes: 2, edges: 1 },
        ]);
        expect(snap.firstPaint).toEqual({ ms: 245, from: 'fresh' });
        expect(snap.freshMs).toBe(245);
    });

    it('records a failed call and rethrows it', async () => {
        const timeline = createLoadTimeline(clock().now);
        const timed = timedSource({ scopes: async () => [], load: () => Promise.reject(new Error('gone')) }, timeline);
        await expect(timed.load('r')).rejects.toThrow('gone');
        expect(timeline.snapshot().marks[0]).toMatchObject({ call: 'load', outcome: 'error', error: 'gone' });
    });

    it('a running call has no end yet; a not-here answer is named', async () => {
        const timeline = createLoadTimeline(clock().now);
        let answer: (v: unknown) => void = () => undefined;
        const timed = timedSource({ scopes: async () => [], load: () => new Promise((r) => { answer = r; }) as never }, timeline);
        const pending = timed.load('r');
        expect(timeline.snapshot().marks[0]!.endMs).toBeUndefined();
        answer({ notReviewedHere: { canSeed: false } });
        await pending;
        expect(timeline.snapshot().marks[0]!.outcome).toBe('not-here');
    });

    it('keeps the first paint from the last-seen graph and the later fresh one apart', () => {
        const c = clock();
        const timeline = createLoadTimeline(c.now);
        c.advance(50); timeline.painted('lastSeen');
        c.advance(950); timeline.painted('fresh');
        c.advance(10); timeline.painted('fresh');
        expect(timeline.snapshot()).toMatchObject({ firstPaint: { ms: 50, from: 'lastSeen' }, freshMs: 1000 });
    });

    it('the wrapper keeps every other member of the source, and its snapshot', () => {
        const search = vi.fn(async () => []);
        const snapshot = { graph };
        const source = { scopes: async () => [], load: async () => null, search, snapshot } as unknown as KnowledgeGraphSource;
        const timed = timedSource(source, createLoadTimeline());
        expect(timed.snapshot).toBe(snapshot);
        expect(timed.baseline).toBeUndefined();
        void timed.search!('r', 'q');
        expect(search).toHaveBeenCalledWith('r', 'q');
    });
});

describe('useTimedSource', () => {
    it('is stable across rerenders and new for a new source', () => {
        const a: KnowledgeGraphSource = { scopes: async () => [], load: async () => null };
        const b: KnowledgeGraphSource = { scopes: async () => [], load: async () => null };
        const { result, rerender } = renderHook(({ s }) => useTimedSource(s), { initialProps: { s: a } });
        const first = result.current;
        rerender({ s: a });
        expect(result.current.source).toBe(first.source);
        expect(result.current.timeline).toBe(first.timeline);
        rerender({ s: b });
        expect(result.current.source).not.toBe(first.source);
        expect(result.current.timeline).not.toBe(first.timeline);
    });
});

describe('paintOf and currentLoadPhase', () => {
    it('names the settled screen', () => {
        expect(paintOf('loading', false, false)).toBeNull();
        expect(paintOf('ready', true, false)).toBe('lastSeen');
        expect(paintOf('ready', false, false)).toBe('fresh');
        expect(paintOf('ready', false, true)).toBe('snapshot');
        expect(paintOf('empty', false, false)).toBe('empty');
    });

    it('picks the oldest active phase of the open root’s running load', () => {
        const trace = {
            now: 10, entries: [],
            inFlight: [
                { op: 'scopes', startedAt: 0, phases: [{ phase: 'x', startedAt: 0 }] },
                { op: 'load', rootId: 'other', startedAt: 0, phases: [{ phase: 'pack', startedAt: 0 }] },
                { op: 'load', rootId: 'r', startedAt: 1, phases: [{ phase: 'index', startedAt: 3 }, { phase: 'partitions', startedAt: 2 }] },
            ],
        };
        expect(currentLoadPhase(trace, 'r')).toBe('partitions');
        expect(currentLoadPhase(trace, 'missing')).toBe('pack');
        expect(currentLoadPhase(null, 'r')).toBeUndefined();
    });
});
