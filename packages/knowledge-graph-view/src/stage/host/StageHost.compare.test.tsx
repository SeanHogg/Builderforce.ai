/**
 * A picked commit tints the changed marks WITHOUT rebuilding the MarkSet (PRD 43 C5, B1a rule 1): the markSet request is
 * the graph and the strings, never a changed set, and a commit's refs reach the stage as the paint request's `diff`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { LENSES } from '../../lenses';
import { surfaceFixture } from '../../testing';
import { CAMERAS } from '../../surface/cameras';
import { compareView, type CompareView } from '../../surface/compareModel';
import { useSurface } from '../../surface/useSurface';
import type { Commit } from '../../types';
import { createNoopStage } from '../renderer';
import { StageFactoryContext } from './StageFactoryContext';
import StageHost from './StageHost';

const calls = vi.hoisted(() => [] as Array<{ kind: string; input: Record<string, unknown> }>);
vi.mock('../../compute/useComputed', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../compute/useComputed')>();
    return { ...actual, useComputed: ((kind: string, input: Record<string, unknown>, ...rest: unknown[]) => { calls.push({ kind, input }); return (actual.useComputed as (...a: unknown[]) => unknown)(kind, input, ...rest); }) as typeof actual.useComputed };
});

const graph = surfaceFixture();
const LIST = CAMERAS.find((c) => c.fallback)!.component!;
const changedRef = graph.nodes[4]!.ref;
const commit: Commit = { sha: 'a'.repeat(40), title: 'tweak the page', at: '2026-01-01T00:00:00Z', refs: [changedRef] };
const view: CompareView = compareView({ source: 'commit', side: 'after', commit }, null, { before: commit.sha, after: null });

function Harness({ compare }: { compare: CompareView | null }) {
    const surface = useSurface(graph, null);
    return (
        <StageHost
            camera="map" fallback={LIST} mode="transit" graph={graph} drawn={{ nodes: graph.nodes, edges: graph.edges }} lens={LENSES.structure} labels={L}
            rootTitle="sys" selected={null} focus={[]} reducedMotion surface={surface} onSelect={vi.fn()} onShow={vi.fn()} compare={compare}
        />
    );
}
const tree = (compare: CompareView | null) => (
    <StageFactoryContext.Provider value={() => createNoopStage()}>
        <Harness compare={compare} />
    </StageFactoryContext.Provider>
);
const of = (kind: string) => calls.filter((c) => c.kind === kind);

beforeEach(() => { calls.length = 0; });

describe('StageHost: a picked commit is paint, not a MarkSet input', () => {
    it('keeps the markSet request unchanged, and sends the commit\'s refs as the paint diff', async () => {
        const { rerender } = render(tree(null));
        await waitFor(() => expect(of('markPaint').length).toBeGreaterThan(0));
        const before = of('markSet').map((c) => c.input);
        expect(before.length).toBeGreaterThan(0);
        for (const input of before) expect(Object.keys(input).sort()).toEqual(['graph', 'strings']); // no changed set, ever
        expect(of('markPaint').every((c) => !c.input['diff'])).toBe(true);

        calls.length = 0;
        rerender(tree(view));
        await waitFor(() => expect(of('markPaint').some((c) => !!c.input['diff'])).toBe(true));
        // The MarkSet's inputs are exactly what they were: the same graph object, the same strings, still no changed set.
        for (const c of of('markSet')) {
            expect(c.input['graph']).toBe(graph);
            expect(Object.keys(c.input).sort()).toEqual(['graph', 'strings']);
            expect(c.input['strings']).toEqual(before[0]!['strings']);
        }
        const diff = of('markPaint').map((c) => c.input['diff']).find(Boolean) as Array<[string, string]>;
        expect(diff).toContainEqual([changedRef, 'changed']);
    });
});
