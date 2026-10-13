import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReplayIssueDto, ReplayKpisDto, ReplayLiveDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { InsightsHome } from './InsightsHome';
import { HOME_BANDS, homeGridTemplate } from './homeBands';

/**
 * The ONE Insights home (PRD 33 D16): every registered band renders over the
 * typed client, a row opens the `issue` kind, `?panel=` opens on load, and the
 * desktop grid is the no-scroll 38 / 34 / 28 layout.
 * Copy is the passthrough key under the global next-intl mock.
 */

vi.mock('@/components/insights/kinds/SitesKind', () => ({ SitesKind: () => <div>sites-kind</div> }));
vi.mock('@/components/insights/kinds/PlanKind', () => ({ PlanKind: () => <div>plan-kind</div> }));
vi.mock('@/components/replay/ReplayPlayer', () => ({
  ReplayPlayer: ({ recordingId }: { recordingId: string }) => <div>player {recordingId}</div>,
}));

const issue = (over: Partial<ReplayIssueDto> = {}): ReplayIssueDto => ({
  id: 'iss-1',
  fingerprint: 'fp-1',
  kind: 'rage',
  route: '/pricing',
  subject: 'button.buy',
  title: 'Rage clicks on Buy',
  status: 'new',
  sessions: 42,
  share: 0.12,
  sparkline: [1, 3, 2, 5],
  firstRelease: 'rel-a',
  lastRelease: 'rel-b',
  firstSeenAt: '2026-10-01T00:00:00.000Z',
  lastSeenAt: '2026-10-12T00:00:00.000Z',
  prescriptionId: null,
  ...over,
});

const kpis: ReplayKpisDto = {
  days: 30,
  sessions: 1200,
  pageviews: 4000,
  newVisitors: 900,
  conversions: 60,
  conversionRate: 0.05,
  frustratedSessions: 80,
  frustratedRate: 0.066,
  errorsPer1k: 3.2,
  lcpP75: 2100,
  trend: [
    { day: '2026-10-10', sessions: 30, frustrated: 2, conversions: 1 },
    { day: '2026-10-11', sessions: 40, frustrated: 3, conversions: 2 },
  ],
};

const live: ReplayLiveDto = {
  active: 3,
  byRoute: [{ route: '/pricing', n: 2 }, { route: '/', n: 1 }],
  visitors: [
    { visitId: 'v1', route: '/pricing', deviceClass: 'desktop', x: null, y: null, lastSeenAt: '2026-10-13T10:00:00.000Z', recordingId: 'rec-live' },
  ],
};

beforeEach(() => {
  window.history.replaceState({}, '', '/apps/insights');
  vi.spyOn(replayApi, 'listReleases').mockResolvedValue([]);
  vi.spyOn(replayApi, 'getKpis').mockResolvedValue(kpis);
  vi.spyOn(replayApi, 'listIssues').mockResolvedValue({
    items: [issue(), issue({ id: 'iss-2', title: 'JS error on checkout', route: '/checkout', kind: 'error' })],
    nextCursor: null,
  });
  vi.spyOn(replayApi, 'getLive').mockResolvedValue(live);
  vi.spyOn(replayApi, 'getIssue').mockResolvedValue({
    ...issue(),
    representatives: [],
    byRelease: [{ releaseKey: 'rel-b', sessions: 42 }],
    byDevice: [{ deviceClass: 'phone', sessions: 30 }],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InsightsHome', () => {
  it('renders every registered band over the typed client', async () => {
    render(<InsightsHome siteId="site-1" />);

    // Header, goal and numbers.
    expect(screen.getByText('insights.overview.title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'insights.goals.activation' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('1,200')).toBeInTheDocument();
    expect(screen.getByText('insights.kpi.score')).toBeInTheDocument();
    // Issues, ranked rows.
    expect(await screen.findByText('Rage clicks on Buy')).toBeInTheDocument();
    expect(screen.getByText('JS error on checkout')).toBeInTheDocument();
    // The Page stage takes the first issue's route and its Live lens.
    expect(await screen.findByRole('heading', { name: '/pricing' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'insights.lenses.live' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(/replay\.live\.active/)).toBeInTheDocument();
    // Do next waits for S4e, honestly.
    expect(screen.getByText('insights.overview.doNextEmpty')).toBeInTheDocument();

    expect(replayApi.getKpis).toHaveBeenCalledWith('site-1', expect.objectContaining({ days: 30 }));
    expect(replayApi.listIssues).toHaveBeenCalledWith('site-1', expect.objectContaining({ days: 30, limit: 6 }));
    // Every band in the registry has a home on the grid.
    const root = screen.getByTestId('insights-home');
    for (const band of HOME_BANDS) {
      expect(root.querySelector(`[data-area="${band.area}"]`)).not.toBeNull();
    }
  });

  it('refetches the numbers when the window changes', async () => {
    render(<InsightsHome siteId="site-1" />);
    await screen.findByText('1,200');
    fireEvent.click(screen.getByRole('button', { name: 'insights.overview.windowAria 7' }));
    expect(await screen.findByRole('button', { name: 'insights.overview.windowAria 7' })).toHaveAttribute('aria-pressed', 'true');
    expect(replayApi.getKpis).toHaveBeenLastCalledWith('site-1', expect.objectContaining({ days: 7 }));
  });

  it('opens the issue kind from a row', async () => {
    render(<InsightsHome siteId="site-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'insights.issues.rowAria Rage clicks on Buy' }));

    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('insights.kinds.issue')).toBeInTheDocument();
    expect(within(panel).getByRole('tab', { name: 'insights.kinds.tabs.overview' })).toHaveAttribute('aria-selected', 'true');
    expect(within(panel).getByRole('tab', { name: 'insights.kinds.tabs.recordings' })).toBeInTheDocument();
    expect(replayApi.getIssue).toHaveBeenCalledWith('site-1', 'iss-1', { days: 30 });
    expect(new URLSearchParams(window.location.search).get('panel')).toBe('issue:iss-1:overview');
  });

  it('opens the issues kind from the sessions tile', async () => {
    render(<InsightsHome siteId="site-1" />);
    await screen.findByText('1,200');
    fireEvent.click(screen.getByRole('button', { name: 'insights.kpi.openAria insights.kpi.sessions' }));
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('insights.kinds.issues')).toBeInTheDocument();
  });

  it('opens ?panel=issues on load', async () => {
    window.history.replaceState({}, '', '/apps/insights?site=site-1&panel=issues');
    render(<InsightsHome siteId="site-1" />);
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('insights.kinds.issues')).toBeInTheDocument();
    expect(await within(panel).findByText('JS error on checkout')).toBeInTheDocument();
    // The rest of the address survives.
    expect(new URLSearchParams(window.location.search).get('site')).toBe('site-1');
  });

  it('starts filtered from the address (a Flow-view link)', async () => {
    window.history.replaceState({}, '', '/apps/insights?panel=issues&f.visitedPath.eq=%2Fpricing');
    render(<InsightsHome siteId="site-1" />);
    await screen.findByRole('dialog');
    expect(replayApi.listIssues).toHaveBeenCalledWith('site-1', expect.objectContaining({
      filter: { all: [{ field: 'visitedPath', op: 'eq', value: '/pricing' }] },
    }));
  });

  it('lays the desktop grid out to fit 1440×900 with no page scroll', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    render(
      <div style={{ width: 1440, height: 900 }}>
        <InsightsHome siteId="site-1" />
      </div>,
    );
    const root = screen.getByTestId('insights-home');
    const style = getComputedStyle(root);
    expect(style.display).toBe('grid');
    expect(style.overflow).toBe('hidden');
    expect(style.height).toBe('100%');
    expect(root.style.gridTemplateColumns).toBe('38fr 34fr 28fr');
    // The body row takes what is left; every row above it sizes to content.
    expect(root.style.gridTemplateRows.endsWith('minmax(0, 1fr)')).toBe(true);
    // The body columns scroll inside themselves, never the page.
    for (const area of ['issues', 'stage', 'next']) {
      const cell = root.querySelector<HTMLElement>(`[data-area="${area}"]`);
      expect(cell?.style.overflow).toBe('hidden');
      expect(cell?.style.minHeight).toMatch(/^0(px)?$/);
    }
  });

  it('leaves no grid row for an area with no band (the funnel arrives in S4c)', () => {
    const template = homeGridTemplate(HOME_BANDS);
    expect(template.areas).not.toContain('funnel');
    expect(template.areas).toContain('"issues stage next"');
    expect(template.rows.split(' minmax')[0]!.split(' ').filter(Boolean)).toEqual(['auto', 'auto', 'auto']);
  });
});
