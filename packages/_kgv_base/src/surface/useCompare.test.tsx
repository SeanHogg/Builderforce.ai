import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { surfaceFixture } from '../testing';
import type { Commit, KnowledgeBaseline } from '../types';
import { PLAY_START_MS, PLAY_STEP_MS, useCompare, type CompareInput } from './useCompare';

const now = surfaceFixture();
const gone = now.nodes[now.nodes.length - 1]!; // a node the baseline does not have: absent Before
const earlier: KnowledgeGraph = { ...now, nodes: now.nodes.slice(0, -1), edges: now.edges.filter((e) => e.from !== gone.ref && e.to !== gone.ref) };
const commits: Commit[] = [
    { sha: 'a'.repeat(40), title: 'first', at: '2026-01-01T00:00:00Z', refs: [now.nodes[3]!.ref] },
    { sha: 'b'.repeat(40), title: 'second', at: '2026-01-02T00:00:00Z', refs: [now.nodes[4]!.ref] },
];

function mount(over: Partial<CompareInput> = {}, baseline: KnowledgeBaseline | null = { graph: earlier, rev: 'c'.repeat(40) }) {
    const base: CompareInput = { current: now, baseline, source: {}, commits, rootId: 'sys', ...over };
    return renderHook((p: CompareInput) => useCompare(p), { initialProps: base });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useCompare: the ONE compare state', () => {
    it('starts closed: no state, no view, After', () => {
        const { result } = mount();
        expect(result.current.state).toBeNull();
        expect(result.current.view).toBeNull();
        expect(result.current.revision).toMatchObject({ value: 'after', hasBefore: true });
        expect(result.current.showingBefore).toBe(false);
    });

    it('the Before / After toggle opens a baseline comparison on ONE union graph and flips its side', () => {
        const { result } = mount();
        act(() => result.current.revision.onChange('before'));
        expect(result.current.state).toEqual({ source: 'baseline', side: 'before' });
        expect(result.current.showingBefore).toBe(true);
        const union = result.current.view!.graph!;
        expect(union.nodes.map((n) => n.ref)).toContain(gone.ref);
        // Before lacks nothing of the baseline; the node only Now has is absent.
        expect([...result.current.view!.absent]).toEqual([gone.ref]);

        act(() => result.current.revision.onChange('after'));
        expect(result.current.state).toEqual({ source: 'baseline', side: 'after' });
        expect(result.current.view!.graph).toBe(union); // the MarkSet is built once: the same graph for both sides
        expect(result.current.view!.absent.size).toBe(0);
        expect(result.current.revision.value).toBe('after');
        expect(result.current.showingBefore).toBe(false);
    });

    it('a snapshot host names the source snapshot and reads Before at the baseline rev and After at its own', () => {
        const { result } = mount({ source: { snapshot: { graph: now, rev: 'd'.repeat(40) } } });
        act(() => result.current.revision.onChange('before'));
        expect(result.current.state?.source).toBe('snapshot');
        expect(result.current.view!.revs).toEqual({ before: 'c'.repeat(40), after: 'd'.repeat(40) });
    });

    it('a baseline that is not comparable offers no Before and refuses it', () => {
        const { result } = mount({}, { graph: earlier, comparable: false, reasons: ['scope-changed'] });
        expect(result.current.comparable).toBe(false);
        expect(result.current.reasons).toEqual(['scope-changed']);
        expect(result.current.revision.hasBefore).toBe(false);
        act(() => result.current.revision.onChange('before'));
        expect(result.current.state).toBeNull();
        act(() => result.current.open({ source: 'baseline', side: 'after' }));
        act(() => result.current.setSide('before'));
        expect(result.current.state?.side).toBe('after');
    });

    it('a restructure opens on Before, then plays to After; play again goes back and forth', () => {
        const { result } = mount();
        const proposal = { after: { ...now, nodes: now.nodes.slice(0, -1) }, bornFrom: new Map<string, string>(), moved: new Map<string, string>(), spans: [] };
        act(() => result.current.open({ source: 'restructure', side: 'before', findingId: 'f1' }, proposal));
        expect(result.current.state).toMatchObject({ source: 'restructure', side: 'before', findingId: 'f1' });
        expect(result.current.playing).toBe(true);
        act(() => { vi.advanceTimersByTime(PLAY_START_MS); });
        expect(result.current.state?.side).toBe('after');
        expect(result.current.playing).toBe(false);

        act(() => result.current.play());
        expect(result.current.state?.side).toBe('before');
        act(() => { vi.advanceTimersByTime(PLAY_STEP_MS); });
        expect(result.current.state?.side).toBe('after');
    });

    it('picking a commit is a changed set over today\'s graph: no union, the refs paint as changed; Now closes it', () => {
        const { result } = mount();
        act(() => result.current.pickCommit(commits[0]!.sha));
        expect(result.current.state).toMatchObject({ source: 'commit', side: 'after', commit: commits[0] });
        expect(result.current.picked).toBe(commits[0]);
        expect(result.current.view!.graph).toBeNull();
        expect(result.current.view!.diff.get(commits[0]!.refs[0]!)).toBe('changed');
        // No parent known: Before has no revision (the pane says the earlier version is not available); After reads at the commit itself.
        expect(result.current.view!.revs).toEqual({ before: null, after: commits[0]!.sha });

        act(() => result.current.pickCommit(null));
        expect(result.current.state).toBeNull();
    });

    it('a commit\'s Before reads at its first parent and its After at the commit', () => {
        const parent = 'e'.repeat(40);
        const { result } = mount({ commits: [{ ...commits[0]!, parent }] });
        act(() => result.current.pickCommit(commits[0]!.sha));
        expect(result.current.view!.revs).toEqual({ before: parent, after: commits[0]!.sha });
    });

    it('play steps the commits oldest to newest', () => {
        const { result } = mount();
        act(() => result.current.pickCommit(commits[1]!.sha));
        act(() => result.current.play());
        expect(result.current.picked?.sha).toBe(commits[0]!.sha);
        act(() => { vi.advanceTimersByTime(PLAY_STEP_MS); });
        expect(result.current.picked?.sha).toBe(commits[1]!.sha);
        expect(result.current.playing).toBe(false);
    });

    it('close ends a play, and another root closes the comparison', () => {
        const { result, rerender } = mount();
        act(() => result.current.open({ source: 'restructure', side: 'before', findingId: 'f1' }, { after: now, bornFrom: new Map(), moved: new Map(), spans: [] }));
        act(() => result.current.close());
        expect(result.current.state).toBeNull();
        act(() => { vi.advanceTimersByTime(PLAY_START_MS * 2); });
        expect(result.current.state).toBeNull(); // the pending play did not reopen it

        act(() => result.current.revision.onChange('before'));
        expect(result.current.state).not.toBeNull();
        rerender({ current: now, baseline: { graph: earlier }, source: {}, commits, rootId: 'other' });
        expect(result.current.state).toBeNull();
    });
});
