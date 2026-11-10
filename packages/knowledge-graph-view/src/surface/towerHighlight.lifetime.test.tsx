// @vitest-environment jsdom
/** The Tower highlight ends when what it was made on ends: a new question, a new family, a different graph, or leaving both Tower cameras. */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { surfaceFixture } from '../testing';
import type { ViewMode } from '../types';
import { highlightForRef } from './towerHighlight';
import { useClearHighlightOutsideTower } from './useShowInTower';
import { useSurface } from './useSurface';

const graph = surfaceFixture();
const lit = () => highlightForRef('src:sys::db/repo.ts', 'god-module');

describe('Tower highlight lifetime', () => {
    it('is cleared by a new question', () => {
        const { result } = renderHook(() => useSurface(graph, null));
        act(() => result.current.setHighlight(lit()));
        expect(result.current.highlight).not.toBeNull();
        act(() => result.current.setQuestion('wrong'));
        expect(result.current.highlight).toBeNull();
    });

    it('is cleared by choosing a pattern family', () => {
        const { result } = renderHook(() => useSurface(graph, null));
        act(() => result.current.setHighlight(lit()));
        act(() => result.current.setFamily('repository'));
        expect(result.current.highlight).toBeNull();
    });

    it('is cleared when the graph changes (a reload, the Before/After toggle)', () => {
        const next: KnowledgeGraph = { ...graph, findings: [] };
        const { result, rerender } = renderHook(({ g }) => useSurface(g, null), { initialProps: { g: graph } });
        act(() => result.current.setHighlight(lit()));
        rerender({ g: graph });
        expect(result.current.highlight).not.toBeNull();
        rerender({ g: next });
        expect(result.current.highlight).toBeNull();
    });

    it('is cleared when the baseline changes', () => {
        const { result, rerender } = renderHook(({ b }) => useSurface(graph, b), { initialProps: { b: null as KnowledgeGraph | null } });
        act(() => result.current.setHighlight(lit()));
        rerender({ b: { ...graph } });
        expect(result.current.highlight).toBeNull();
    });

    it('is cleared when the view leaves both tower pictures (3D, the Map with towers), and kept while it stays in one', () => {
        let highlight: unknown = lit();
        const set = (h: unknown) => { highlight = h; };
        const { rerender } = renderHook(
            ({ mode, towers }: { mode: ViewMode; towers: boolean }) => useClearHighlightOutsideTower(mode, towers, set),
            { initialProps: { mode: '3d' as ViewMode, towers: false } },
        );
        // The hook clears on mount outside a tower picture; inside one it does nothing.
        expect(highlight).not.toBeNull();
        rerender({ mode: 'transit', towers: true });
        expect(highlight).not.toBeNull();
        // The Map's flat look is not a tower picture.
        rerender({ mode: 'transit', towers: false });
        expect(highlight).toBeNull();
    });
});
