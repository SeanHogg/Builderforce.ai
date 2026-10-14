import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { INSIGHT_PANEL_KINDS, panelKindDef } from '../panelKinds';
import { PAGE_STAGE_LENSES } from '../bands/pageStageLenses';
import { InsightsScopeProvider } from '../insightsScope';
import { RouteHeatTab, RouteReviewTab } from './RouteKind';

/**
 * S4 wires into the ONE screen by registry rows only (D16): the `route` panel
 * kind (its `heat` tab and S4f's `review` tab, one row) and the
 * Page stage's `heat` and `stuck` lenses.
 */

vi.mock('@/components/replay/heatmap/HeatmapView', () => ({
  HeatmapView: ({ route, initialCompare, renderBelow }: {
    route: string;
    initialCompare: string | null;
    renderBelow?: (selection: { route: string; release: string | null; compare: string | null; device: null; kind: 'click' }) => ReactNode;
  }) => (
    <div>
      <span>heatmap {route} compare:{initialCompare ?? 'none'}</span>
      {renderBelow?.({ route, release: 'rel-b', compare: 'rel-a', device: null, kind: 'click' })}
    </div>
  ),
}));
vi.mock('@/components/replay/heatmap/ScrollDepthBar', () => ({
  ScrollDepthBar: ({ route, release }: { route: string; release: string | null }) => <div>scroll {route} {release}</div>,
}));
vi.mock('@/components/replay/heatmap/HeatmapInsights', () => ({
  HeatmapInsights: ({ route, compare }: { route: string; compare: string | null }) => <div>insights {route} {compare}</div>,
}));

describe('route kind + heat lenses registration', () => {
  it('registers the route kind with its heat and review tabs', () => {
    const def = panelKindDef('route');
    expect(def).toBeDefined();
    expect(def!.labelKey).toBe('route.kind');
    expect(def!.tabs.map((tab) => tab.id)).toEqual(['heat', 'review']);
    expect(def!.tabs[0]!.Component).toBe(RouteHeatTab);
    expect(def!.tabs[1]!.Component).toBe(RouteReviewTab);
    expect(INSIGHT_PANEL_KINDS.filter((row) => row.kind === 'route')).toHaveLength(1);
  });

  it('registers the heat and stuck lenses on the Page stage, Heat first', () => {
    const ids = PAGE_STAGE_LENSES.map((lens) => lens.id);
    expect(ids.slice(0, 2)).toEqual(['heat', 'stuck']);
    expect(ids).toContain('live');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('renders the heatmap for the level route, then the scroll reach and insights for the same selection', () => {
    render(
      <InsightsScopeProvider siteId="site-1">
        <RouteHeatTab siteId="site-1" id="/pricing" tab="heat" push={vi.fn()} />
      </InsightsScopeProvider>,
    );
    expect(screen.getByText('heatmap /pricing compare:none')).toBeInTheDocument();
    expect(screen.getByText('scroll /pricing rel-b')).toBeInTheDocument();
    expect(screen.getByText('insights /pricing rel-a')).toBeInTheDocument();
  });
});
