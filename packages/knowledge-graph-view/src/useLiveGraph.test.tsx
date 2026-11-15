/**
 * useLiveGraph tests: it subscribes the open root's live updates, paints whole-graph
 * refreshes as-is, applies change batches with applyGraphPatch (the host's decoration
 * riding along), and unsubscribes on root change, source change, unmount, or a host with
 * no `subscribeLive`.
 */

import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeGraph, NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { useLiveGraph } from './useLiveGraph';
import type { KnowledgeGraphPatch, KnowledgeGraphSource } from './types';

const ROOT = 'r';
const file = (p: string): NodeRef => `src:${ROOT}::${p}` as NodeRef;
const graph = (id: string): KnowledgeGraph => ({
    scope: { rootId: ROOT, packs: ['code'], digest: id },
    nodes: [{ ref: file('a.ts'), kind: 'file', label: 'a.ts', pack: 'code', partition: 'entry', importance: 0.5, origin: 'extracted' }],
    edges: [],
    findings: [],
    stats: { sources: 1, nodes: 1, edges: 0, stale: 0, truncated: false },
});
const patch = (over: Partial<KnowledgeGraphPatch> = {}): KnowledgeGraphPatch => ({
    rootId: ROOT, files: [], removedNodes: [], upsertNodes: [], removedEdges: [], upsertEdges: [], stale: [], changed: [], ...over,
});

/** A source whose subscribeLive records the handlers and returns a spy unsubscribe. */
function liveSource() {
    const unsubscribe = vi.fn();
    let onGraph: ((g: KnowledgeGraph) => void) | undefined;
    let onPatch: ((p: KnowledgeGraphPatch, decorate?: (g: KnowledgeGraph) => KnowledgeGraph) => void) | undefined;
    const source = {
        scopes: async () => [],
        load: async () => null,
        subscribeLive: (
            _rootId: string,
            cb: (g: KnowledgeGraph) => void,
            patchCb?: (p: KnowledgeGraphPatch, decorate?: (g: KnowledgeGraph) => KnowledgeGraph) => void,
        ) => { onGraph = cb; onPatch = patchCb; return unsubscribe; },
    } as KnowledgeGraphSource;
    return { source, unsubscribe, handlers: () => ({ onGraph, onPatch }) };
}

function setup(source: KnowledgeGraphSource, rootId: string | null = ROOT) {
    const painted: Array<KnowledgeGraph | null> = [];
    // The caller's paint updates the ref AND state (useKnowledgeGraph's `paint`); a patch reads the ref,
    // so without this the hook's rootId guard would (rightly) drop the second patch.
    const graphRef: { current: KnowledgeGraph | null } = { current: graph('before') };
    const paint = (g: KnowledgeGraph | null) => { graphRef.current = g; painted.push(g); };
    const focusRef = { current: [] as string[] };
    const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;
    const hook = renderHook(() => useLiveGraph(source, { rootId, epoch: 0, graphRef, focusRef, paint }), { wrapper });
    return { painted, graphRef, hook };
}

describe('useLiveGraph', () => {
    it('paints a whole-graph refresh as-is', () => {
        const { source, handlers } = liveSource();
        const { painted } = setup(source);
        handlers().onGraph?.(graph('after'));
        expect(painted).toHaveLength(1);
        expect(painted[0]?.scope.digest).toBe('after');
    });

    it('applies a change batch to the graph on screen and rides the host decoration', () => {
        const { source, handlers } = liveSource();
        const { painted, graphRef } = setup(source);
        handlers().onPatch?.(patch({ removedNodes: [file('a.ts')] }), (g) => ({ ...g, stats: { ...g.stats, sources: 7 } }));
        expect(painted).toHaveLength(1);
        expect(painted[0]?.nodes).toHaveLength(0);
        expect(painted[0]?.stats.sources).toBe(7);
        // The ref (what the next batch reads) is the painted graph.
        expect(graphRef.current).toBe(painted[0]);
    });

    it('unsubscribes when the root changes or the hook unmounts', () => {
        const { source, unsubscribe } = liveSource();
        const { hook } = setup(source);
        hook.rerender();
        expect(unsubscribe).not.toHaveBeenCalled();
        hook.unmount();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('does nothing when rootId is null or the host has no subscribeLive', () => {
        const { source, unsubscribe } = liveSource();
        setup(source, null);
        expect(unsubscribe).not.toHaveBeenCalled();
        const painted: Array<KnowledgeGraph | null> = [];
        const noop = { current: null };
        renderHook(() => useLiveGraph({} as KnowledgeGraphSource, { rootId: ROOT, epoch: 0, graphRef: noop, focusRef: { current: [] }, paint: (g) => painted.push(g) }));
        expect(painted).toHaveLength(0);
    });
});
