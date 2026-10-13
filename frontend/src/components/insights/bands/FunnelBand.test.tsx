import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReplayFunnelDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { InsightsScopeProvider } from '../insightsScope';
import { InsightsPanelProvider, usePanel } from '../usePanel';
import { FunnelBand } from './FunnelBand';
import { parseFunnelLevelId } from '@/components/replay/funnels/funnelLevel';

/**
 * The home's funnel band: the first funnel as one row of segments (≈ visits,
 * conversion from the step before) over the ONE filter; a segment opens the
 * `funnel` kind on that funnel; no funnel → "Create a funnel" opens the editor.
 */

const funnel: ReplayFunnelDto = {
  id: 'fun-1',
  name: 'Checkout',
  windowMinutes: 60,
  steps: [
    { ord: 0, stepKind: 'page', match: '/pricing', matchMode: 'equals', label: '/pricing' },
    { ord: 1, stepKind: 'event', match: 'purchase', matchMode: 'equals', label: 'purchase' },
  ],
};

function LevelProbe() {
  const { levels } = usePanel();
  return <output data-testid="levels">{JSON.stringify(levels)}</output>;
}

function renderBand() {
  render(
    <InsightsScopeProvider siteId="site-1">
      <InsightsPanelProvider>
        <FunnelBand />
        <LevelProbe />
      </InsightsPanelProvider>
    </InsightsScopeProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/apps/insights?f.device.eq=phone');
  vi.spyOn(replayApi, 'listFunnels').mockResolvedValue([funnel]);
  vi.spyOn(replayApi, 'evaluateFunnel').mockResolvedValue({
    funnelId: 'fun-1',
    steps: [
      { ord: 0, label: '/pricing', visits: 200, conversionFromPrevPct: null, medianTimeFromPrevMs: null, droppedRecordingIds: [] },
      { ord: 1, label: 'purchase', visits: 50, conversionFromPrevPct: 25, medianTimeFromPrevMs: 90_000, droppedRecordingIds: [] },
    ],
    truncated: false,
    estimated: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FunnelBand', () => {
  it('draws the first funnel as segments over the filter, and a segment opens the funnel kind', async () => {
    renderBand();
    expect(await screen.findByText('insights.funnel.band.approx 200')).toBeInTheDocument();
    expect(screen.getByText('insights.funnel.band.approx 50')).toBeInTheDocument();
    expect(screen.getByText('insights.funnel.band.conversion 25%')).toBeInTheDocument();
    expect(replayApi.evaluateFunnel).toHaveBeenCalledWith('site-1', 'fun-1', {
      days: 30,
      filter: { all: [{ field: 'device', op: 'eq', value: 'phone' }] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'insights.funnel.band.openAria purchase' }));
    const [level] = JSON.parse(screen.getByTestId('levels').textContent ?? '[]');
    expect(level).toMatchObject({ kind: 'funnel', tab: 'steps' });
    expect(parseFunnelLevelId(level.id)).toEqual({ funnelId: 'fun-1' });
  });

  it('offers to create a funnel when the site has none', async () => {
    vi.mocked(replayApi.listFunnels).mockResolvedValue([]);
    renderBand();
    fireEvent.click(await screen.findByRole('button', { name: 'insights.funnel.band.create' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(replayApi.evaluateFunnel).not.toHaveBeenCalled();
  });
});
