// @vitest-environment jsdom
/** A run-gated host (the editor): an existing review is drawn on open without Run; Run only starts tracking. */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { codeFixture } from './testing';
import { useKnowledgeGraph } from './useKnowledgeGraph';
import type { KnowledgeGraphSource, KnowledgeScopeSummary, LoadDecision } from './types';

const scopeOf = (g: KnowledgeGraph, lastReviewedAt: string): KnowledgeScopeSummary => ({ rootId: g.scope.rootId, title: g.scope.rootId, packs: g.scope.packs, lastReviewedAt });
const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });

function gatedSource(o: { scopes: KnowledgeScopeSummary[]; seen?: KnowledgeGraph | null; stored?: Record<string, KnowledgeGraph | null>; seenError?: boolean }) {
    const decisions: LoadDecision[] = [];
    const load = vi.fn(async (rootId: string) => o.stored?.[rootId] ?? null);
    const source: KnowledgeGraphSource = {
        runGated: true,
        scopes: async () => o.scopes,
        load,
        lastSeen: async () => {
            if (o.seenError) throw new Error('host down');
            return o.seen ? { scopes: o.scopes, rootId: o.seen.scope.rootId, graph: o.seen } : null;
        },
        decision: (d) => { decisions.push(d); },
    };
    return { source, load, decisions };
}

describe('useKnowledgeGraph on a run-gated host', () => {
    it('regression: a lastSeen miss loads the stored review read-only and paints it, without Run', async () => {
        const a = codeFixture('a');
        const { source, load, decisions } = gatedSource({ scopes: [scopeOf(a, '2026-01-01')], seen: null, stored: { a } });
        const { result } = renderHook(() => useKnowledgeGraph(source));
        await flush();
        expect(load).toHaveBeenCalledWith('a', undefined);
        expect(result.current.graph).toBe(a);
        expect(result.current.status).toBe('ready');
        // Painted, but not running: Run is still offered and starts the tracking.
        expect(result.current.running).toBe(false);
        expect(decisions.some((d) => d.kind === 'lastSeen')).toBe(true);
        expect(decisions.some((d) => d.kind === 'gate' && /stored graph read/.test(d.reason))).toBe(true);
    });

    it('regression: a lastSeen that throws is reported and still paints the stored review', async () => {
        const a = codeFixture('a');
        const { source, decisions } = gatedSource({ scopes: [scopeOf(a, '2026-01-01')], seenError: true, stored: { a } });
        const { result } = renderHook(() => useKnowledgeGraph(source));
        await flush();
        expect(result.current.graph).toBe(a);
        expect(decisions.find((d) => d.kind === 'lastSeen')?.reason).toMatch(/error.*host down/);
    });

    it('regression: the lastSeen of a non-newest root wins over the newest scope', async () => {
        const old = codeFixture('old');
        const newest = codeFixture('newest');
        const { source, load } = gatedSource({
            scopes: [scopeOf(newest, '2026-02-01'), scopeOf(old, '2026-01-01')], seen: old, stored: { newest },
        });
        const { result } = renderHook(() => useKnowledgeGraph(source));
        await flush();
        expect(result.current.rootId).toBe('old');
        expect(result.current.graph).toBe(old);
        expect(result.current.status).toBe('ready');
        expect(load).not.toHaveBeenCalled();
    });

    it('regression: the Run card (idle) only when the load returns nothing; Run then loads', async () => {
        const a = codeFixture('a');
        const stored: Record<string, KnowledgeGraph | null> = { a: null };
        const { source, load } = gatedSource({ scopes: [scopeOf(a, '2026-01-01')], seen: null, stored });
        const { result } = renderHook(() => useKnowledgeGraph(source));
        await flush();
        expect(result.current.status).toBe('idle');
        expect(result.current.graph).toBeNull();
        stored.a = a;
        act(() => result.current.run());
        await flush();
        expect(load).toHaveBeenCalledTimes(2);
        expect(result.current.running).toBe(true);
        expect(result.current.graph).toBe(a);
    });
});
