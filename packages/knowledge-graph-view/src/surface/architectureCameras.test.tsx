// @vitest-environment jsdom
/**
 * The architecture cameras: Style and Features are stage placements now (the DOM 4+1, Style and Features cameras retired
 * at make-default, PRD 43 P1 — `fourPlusOne.ts`). Offered for code, hidden on a graph with no source files; through
 * `ViewSurface` each renders on the one stage host, never as the retired DOM markup.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { LENSES } from '../lenses';
import { docsFixture, surfaceFixture } from '../testing';
import type { ViewMode } from '../types';
import { ViewSurface } from '../ViewSurface';
import { CAMERAS } from './cameras';
import { useSurface } from './useSurface';

vi.mock('../scene/GraphScene', () => ({ default: () => null }));

const env = { webgl: false, reducedMotion: true, hasLines: true, compact: false };
/** The architecture cameras still registered: the DOM 4+1 camera retired at make-default (PRD 43 P1, `fourPlusOne.ts`). */
const ARCH: ViewMode[] = ['style', 'features'];

function mount(mode: ViewMode, graph: KnowledgeGraph = surfaceFixture(), onSelect = vi.fn()) {
    function Harness() {
        const surface = useSurface(graph, null);
        return (
            <ViewSurface
                mode={mode} graph={graph} drawn={{ nodes: graph.nodes, edges: graph.edges }} lens={LENSES.structure} labels={L} rootTitle="sys"
                selected={null} focus={[]} reducedMotion surface={surface} onSelect={onSelect} onShow={vi.fn()}
            />
        );
    }
    render(<Harness />);
    return onSelect;
}

describe('the architecture cameras', () => {
    beforeAll(async () => {
        // Keep the lazy stage's first Vite transform outside the render assertions.
        await import('../stage/host/StageHost');
    }, 120_000);

    it('are offered for code and hidden for a graph with no source files', () => {
        const ids = (g: KnowledgeGraph) => CAMERAS.filter((c) => ARCH.includes(c.id) && c.available(g, env)).map((c) => c.id);
        expect(ids(surfaceFixture())).toEqual(ARCH);
        expect(ids(docsFixture())).toEqual([]);
    });

    it('registers no 4+1 camera anymore: its id is not a ViewMode', () => {
        expect(CAMERAS.map((c) => c.id)).not.toContain('4plus1' as ViewMode);
    });

    it('Style is a stage placement now: it renders through the stage host, not the retired DOM verdict/checks markup', async () => {
        const style = CAMERAS.find((c) => c.id === 'style')!;
        expect(style.placement).toBe('style');
        expect(style.component).toBeUndefined();
        mount('style');
        // The lazy stage host resolves after the first tick; the retired DOM markup is never drawn.
        await waitFor(() => expect(document.querySelector('[data-stage-host]')).toBeTruthy());
        expect(document.querySelectorAll('[data-style]')).toHaveLength(0);
    });

    it('Features is a stage placement now: the retired DOM group regions are gone', async () => {
        const features = CAMERAS.find((c) => c.id === 'features')!;
        expect(features.placement).toBe('features');
        expect(features.component).toBeUndefined();
        mount('features');
        // The placement host or its no-WebGL List fallback eventually resolves; either way the retired
        // DOM camera's five group regions are never drawn.
        await waitFor(() => {
            expect(
                document.querySelector('[data-stage-host]') !== null
                || document.querySelector('[data-testid="kg-list"]') !== null
                || document.querySelector('[data-testid="kg-camera-error"]') !== null,
            ).toBe(true);
        });
        expect(document.querySelectorAll('[data-cell]')).toHaveLength(0);
    });
});
