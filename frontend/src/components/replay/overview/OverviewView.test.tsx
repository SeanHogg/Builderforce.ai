import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReplayOverviewDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { InsightsScopeProvider, useInsightsScope } from '@/components/insights/insightsScope';
import { prescription } from '@/test/replayPrescriptionFixtures';
import { OverviewView } from './OverviewView';

/**
 * The `metric` kind's dashboard: exact unfiltered, "≈" when a filter forced the
 * weighted read; a frustration tile narrows the ONE filter and opens the issues
 * behind it; a breakdown row narrows the filter in place.
 */

const overview = (over: Partial<ReplayOverviewDto> = {}): ReplayOverviewDto => ({
  days: 30,
  sessions: 1200,
  newVisitors: 800,
  pagesPerSession: 2.4,
  avgActiveMs: 65_000,
  avgScrollDepthPct: 55,
  frustration: { rage: 0.05, dead: 0.02, quickback: 0, excessiveScroll: 0.01, error: 0.03 },
  trend: [
    { day: '2026-10-11', sessions: 40, frustratedPct: 10 },
    { day: '2026-10-12', sessions: 44, frustratedPct: 12 },
  ],
  top: {
    pages: [{ value: '/pricing', sessions: 300 }],
    entryPages: [{ value: '/', sessions: 900 }],
    exitPages: [],
    referrers: [],
    countries: [],
    devices: [{ value: 'phone', sessions: 400 }],
    browsers: [],
    os: [],
  },
  estimated: false,
  ...over,
});

function FilterProbe() {
  const { filter } = useInsightsScope();
  return <output data-testid="filter">{JSON.stringify(filter)}</output>;
}

function renderView(push = vi.fn()) {
  render(
    <InsightsScopeProvider siteId="site-1">
      <OverviewView siteId="site-1" push={push} />
      <FilterProbe />
    </InsightsScopeProvider>,
  );
  return push;
}

beforeEach(() => {
  window.history.replaceState({}, '', '/apps/insights');
  vi.spyOn(replayApi, 'listPrescriptions').mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OverviewView', () => {
  it('shows exact numbers unfiltered', async () => {
    vi.spyOn(replayApi, 'getOverview').mockResolvedValue(overview());
    renderView();
    expect(await screen.findByText('1,200')).toBeInTheDocument();
    expect(screen.getByText('800')).toBeInTheDocument();
    expect(screen.queryByText(/replay\.overview\.approx/)).toBeNull();
    expect(replayApi.getOverview).toHaveBeenCalledWith('site-1', { days: 30, filter: { all: [] } });
  });

  it('prints ≈ when the read is estimated, and — where the weighted read cannot know', async () => {
    vi.spyOn(replayApi, 'getOverview').mockResolvedValue(overview({ estimated: true, newVisitors: null }));
    renderView();
    expect(await screen.findByText('replay.overview.approx 1,200')).toBeInTheDocument();
    expect(screen.getByText('replay.overview.estimatedNote')).toBeInTheDocument();
    expect(screen.getAllByText('replay.overview.notInWeighted').length).toBeGreaterThan(0);
  });

  it('a frustration tile adds its clause and opens the issues kind', async () => {
    vi.spyOn(replayApi, 'getOverview').mockResolvedValue(overview());
    const push = renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'replay.overview.frustrationOpen replay.overview.frustration.rage' }));
    expect(push).toHaveBeenCalledWith({ kind: 'issues', id: '' });
    expect(JSON.parse(screen.getByTestId('filter').textContent ?? '')).toEqual({ all: [{ field: 'frustration', op: 'eq', value: 'rage' }] });
    expect(new URLSearchParams(window.location.search).get('f.frustration.eq')).toBe('rage');
  });

  it('a breakdown row narrows the filter and the view re-reads', async () => {
    vi.spyOn(replayApi, 'getOverview').mockResolvedValue(overview());
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'replay.overview.addFilterAria /pricing replay.filter.field.visitedPath' }));
    const pricing = { all: [{ field: 'visitedPath', op: 'eq', value: '/pricing' }] };
    expect(JSON.parse(screen.getByTestId('filter').textContent ?? '')).toEqual(pricing);
    await waitFor(() => expect(replayApi.getOverview).toHaveBeenLastCalledWith('site-1', { days: 30, filter: pricing }));
    // An enum value is translated, and its clause is still the raw value.
    fireEvent.click(screen.getByRole('button', { name: 'replay.overview.addFilterAria replay.filter.value.phone replay.filter.field.device' }));
    expect(JSON.parse(screen.getByTestId('filter').textContent ?? '').all).toContainEqual({ field: 'device', op: 'eq', value: 'phone' });
  });

  it('leads with the top three open fixes for the same filter — THE fix card, compact', async () => {
    vi.spyOn(replayApi, 'getOverview').mockResolvedValue(overview());
    vi.mocked(replayApi.listPrescriptions).mockResolvedValue([
      prescription({ id: 'rx-1', rank: 1 }),
      prescription({ id: 'rx-done', rank: 2, status: 'worked' }),
      prescription({ id: 'rx-2', rank: 3 }),
      prescription({ id: 'rx-3', rank: 4 }),
      prescription({ id: 'rx-4', rank: 5 }),
    ]);
    const push = renderView();
    expect(await screen.findByText('replay.fixes.overviewTitle')).toBeInTheDocument();
    const cards = await screen.findAllByTestId('prescription-card');
    expect(cards).toHaveLength(3);
    cards.forEach((card) => expect(card).toHaveAttribute('data-compact', 'true'));
    fireEvent.click(screen.getAllByRole('button', { name: /replay\.prescription\.openAria/ })[0]!);
    expect(push).toHaveBeenCalledWith({ kind: 'fix', id: 'rx-1', tab: 'change' });
  });
});
