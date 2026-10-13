import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { filterFromQuery, type ReplayHeatInsightDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { HeatmapInsights } from './HeatmapInsights';

/**
 * Heat findings are decided by the API's `HEATMAP_INSIGHT_RULES`; this renders
 * each title from `replay.heatInsight.<ruleId>` over its params (the global
 * next-intl mock appends the values after the key) and wires the actions.
 */

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), show: vi.fn(), dismiss: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => toast }));

const insights: ReplayHeatInsightDto[] = [
  {
    ruleId: 'rage_spike', route: '/pricing', selector: 'getByRole("button", { name: "Buy" })',
    params: { rage: 12, compareRage: 2, ratio: 6, label: 'Buy' }, action: 'ticket',
  },
  {
    ruleId: 'dead_text', route: '/pricing', selector: 'getByText("Free shipping")',
    params: { dead: 14, label: '' }, action: 'ticket',
  },
  {
    ruleId: 'buried_top_click', route: '/pricing', selector: 'getByTestId("plans")',
    params: { clicks: 33, decile: 7, reach: 0.25, label: 'Plans' }, action: 'ticket',
  },
  {
    ruleId: 'quickback_doubled', route: '/pricing', selector: null,
    params: { quickbacks: 10, compareQuickbacks: 4, ratio: 2.5 }, action: 'watch',
  },
];

const writeText = vi.fn(async (text: string) => { void text; });

beforeEach(() => {
  toast.success.mockClear();
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  window.history.replaceState({}, '', '/apps/insights?site=site-1');
  vi.spyOn(replayApi, 'heatInsights').mockResolvedValue(insights);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function card(ruleId: string): HTMLElement {
  return screen.getAllByTestId('heat-insight').find((item) => item.getAttribute('data-rule') === ruleId)!;
}

describe('HeatmapInsights', () => {
  it('reads the findings for the selection and titles each rule from its params', async () => {
    render(<HeatmapInsights siteId="site-1" route="/pricing" release="rel-b" compare="rel-a" days={30} push={vi.fn()} />);
    expect(await screen.findAllByTestId('heat-insight')).toHaveLength(4);
    expect(replayApi.heatInsights).toHaveBeenCalledWith('site-1', { route: '/pricing', release: 'rel-b', compare: 'rel-a', device: null, days: 30 });

    expect(within(card('rage_spike')).getByText(/^replay\.heatInsight\.rage_spike /)).toHaveTextContent(/12 2 6 Buy/);
    // An empty label falls back to the selector, so the finding always names its element.
    expect(within(card('dead_text')).getByText(/^replay\.heatInsight\.dead_text /)).toHaveTextContent('14 getByText("Free shipping")');
    // Shares become percentages and the decile a depth.
    const buried = within(card('buried_top_click')).getByText(/^replay\.heatInsight\.buried_top_click /);
    expect(buried).toHaveTextContent('25%');
    expect(buried).toHaveTextContent(/ 70( |$)/);
    expect(within(card('quickback_doubled')).getByText(/^replay\.heatInsight\.quickback_doubled /)).toHaveTextContent(/10 4 2\.5/);
  });

  it('watches the replays on the route (and the element) through the issues kind', async () => {
    const push = vi.fn();
    render(<HeatmapInsights siteId="site-1" route="/pricing" push={push} />);
    await screen.findAllByTestId('heat-insight');

    fireEvent.click(within(card('rage_spike')).getByRole('button', { name: 'replay.heatInsight.actions.watch' }));
    const level = push.mock.calls[0]![0] as { kind: string; id: string };
    expect(level.kind).toBe('issues');
    expect(filterFromQuery(level.id).all).toEqual([
      { field: 'visitedPath', op: 'eq', value: '/pricing' },
      { field: 'clickedSelector', op: 'eq', value: 'getByRole("button", { name: "Buy" })' },
    ]);

    fireEvent.click(within(card('quickback_doubled')).getByRole('button', { name: 'replay.heatInsight.actions.watch' }));
    const routeOnly = push.mock.calls[1]![0] as { kind: string; id: string };
    expect(filterFromQuery(routeOnly.id).all).toEqual([{ field: 'visitedPath', op: 'eq', value: '/pricing' }]);
  });

  it('offers "Copy link" for ticket findings only, linking the page heatmap', async () => {
    render(<HeatmapInsights siteId="site-1" route="/pricing" push={vi.fn()} />);
    await screen.findAllByTestId('heat-insight');
    expect(within(card('quickback_doubled')).queryByRole('button', { name: 'replay.heatInsight.actions.copyLink' })).toBeNull();

    await act(async () => {
      fireEvent.click(within(card('rage_spike')).getByRole('button', { name: 'replay.heatInsight.actions.copyLink' }));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const href = new URL(writeText.mock.calls[0]![0]);
    expect(href.searchParams.get('panel')).toBe('route:%2Fpricing:heat');
    expect(href.searchParams.get('site')).toBe('site-1');
    expect(toast.success).toHaveBeenCalledWith('replay.heatInsight.copied');
  });

  it('says so when nothing stands out', async () => {
    vi.mocked(replayApi.heatInsights).mockResolvedValue([]);
    render(<HeatmapInsights siteId="site-1" route="/pricing" push={vi.fn()} />);
    expect(await screen.findByText('replay.heatInsight.empty')).toBeInTheDocument();
  });
});
