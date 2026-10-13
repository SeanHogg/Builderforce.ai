import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReplayKpisDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { InsightsScopeProvider } from '../insightsScope';
import { InsightsPanelProvider } from '../usePanel';
import { KpiTiles } from './KpiTiles';

/**
 * The numbers band honours the ONE filter: the KPIs are read with it, and when the
 * API answers from kept recordings (`estimated`) every measured tile prints ≈.
 */

const kpis = (over: Partial<ReplayKpisDto> = {}): ReplayKpisDto => ({
  days: 30, sessions: 40, pageviews: 120, newVisitors: 0, conversions: 4, conversionRate: 0.1,
  frustratedSessions: 8, frustratedRate: 0.2, errorsPer1k: 0, lcpP75: null, trend: [], ...over,
});

function renderTiles() {
  render(
    <InsightsScopeProvider siteId="site-1">
      <InsightsPanelProvider>
        <KpiTiles />
      </InsightsPanelProvider>
    </InsightsScopeProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KpiTiles', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/apps/insights?f.device.eq=phone');
  });

  it('reads the KPIs with the filter and prints ≈ when they are estimated', async () => {
    vi.spyOn(replayApi, 'getKpis').mockResolvedValue(kpis({ estimated: true }));
    renderTiles();
    expect(await screen.findByText('insights.kpi.approx 40')).toBeInTheDocument();
    expect(screen.getByText('insights.kpi.approx 8')).toBeInTheDocument();
    expect(replayApi.getKpis).toHaveBeenCalledWith('site-1', {
      days: 30,
      filter: { all: [{ field: 'device', op: 'eq', value: 'phone' }] },
    });
  });

  it('prints exact numbers when the answer is not estimated', async () => {
    window.history.replaceState({}, '', '/apps/insights');
    vi.spyOn(replayApi, 'getKpis').mockResolvedValue(kpis());
    renderTiles();
    expect(await screen.findByText('40')).toBeInTheDocument();
    expect(screen.queryByText('insights.kpi.approx 40')).not.toBeInTheDocument();
  });
});
