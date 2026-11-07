// @vitest-environment jsdom
/** The Insights tiles: the Files tile says how much of a truncated graph is loaded. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { surfaceFixture } from '../testing';
import { insightsOf } from './insightsModel';
import { InsightsPanel } from './InsightsPanel';

const draw = (graph = surfaceFixture()) => render(<InsightsPanel graph={graph} labels={L} lenses={[]} onLens={vi.fn()} onShow={vi.fn()} />);
const filesTile = () => within(document.querySelector('[data-metric="files"]') as HTMLElement);

describe('the Files tile', () => {
    it('is the plain count for a whole graph', () => {
        const g = surfaceFixture();
        draw(g);
        expect(filesTile().getByText(String(insightsOf(g).metrics.find((m) => m.id === 'files')!.value))).toBeTruthy();
        expect(screen.queryByText(/loaded/)).toBeNull();
    });

    it('reads "{loaded} of {total} loaded" when the graph is truncated', () => {
        const g = surfaceFixture();
        const loaded = insightsOf(g).metrics.find((m) => m.id === 'files')!.value;
        draw({ ...g, stats: { ...g.stats, truncated: true, sources: 3038 } });
        expect(filesTile().getByText(fillTemplate(L.filesLoaded, { loaded: loaded.toLocaleString(), total: (3038).toLocaleString() }))).toBeTruthy();
    });

    it('stays a plain count when a truncated graph still holds every file', () => {
        const g = surfaceFixture();
        const loaded = insightsOf(g).metrics.find((m) => m.id === 'files')!.value;
        draw({ ...g, stats: { ...g.stats, truncated: true, sources: loaded } });
        expect(screen.queryByText(/loaded/)).toBeNull();
    });
});
