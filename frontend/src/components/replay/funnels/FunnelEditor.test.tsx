import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReplayFunnelDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { FunnelEditor } from './FunnelEditor';
import { funnelEditLevel, funnelLevelId, parseFunnelLevelId } from './funnelLevel';
import { InsightsScopeProvider } from '@/components/insights/insightsScope';
import { InsightsPanelProvider, usePanel } from '@/components/insights/usePanel';
import { InsightsPanel } from '@/components/insights/InsightsPanel';
import type { InsightPanelLevel } from '@/components/insights/panelKinds';

/**
 * The funnel editor: each step previews how many kept recordings match it
 * (the smart-event preview, a click step as a `click` rule, an event step as
 * `custom`), saves with POST or PUT, and deletes only after confirming. It is a
 * LEVEL of the ONE Insights panel (`funnel_edit`, D16), never a second overlay.
 */

const confirmSpy = vi.hoisted(() => vi.fn<(opts: unknown) => Promise<boolean>>());
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => confirmSpy }));

const funnel: ReplayFunnelDto = {
  id: 'fun-1',
  name: 'Checkout',
  windowMinutes: 30,
  steps: [
    { ord: 0, stepKind: 'page', match: '/pricing', matchMode: 'equals', label: '/pricing' },
    { ord: 1, stepKind: 'event', match: 'purchase', matchMode: 'equals', label: 'purchase' },
  ],
};

beforeEach(() => {
  confirmSpy.mockReset();
  vi.spyOn(replayApi, 'previewSmartEvent').mockResolvedValue({ count: 12 });
  vi.spyOn(replayApi, 'createFunnel').mockResolvedValue(funnel);
  vi.spyOn(replayApi, 'updateFunnel').mockResolvedValue(funnel);
  vi.spyOn(replayApi, 'deleteFunnel').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FunnelEditor', () => {
  it('previews each step live and creates the funnel', async () => {
    const onSaved = vi.fn();
    render(<FunnelEditor siteId="site-1" days={30} funnel={null} onClose={() => {}} onSaved={onSaved} />);
    const panel = await screen.findByRole('form', { name: 'replay.funnels.newTitle' });

    fireEvent.change(within(panel).getByRole('textbox', { name: 'replay.funnels.name' }), { target: { value: 'Sign-up' } });
    fireEvent.change(within(panel).getByRole('textbox', { name: 'replay.funnels.matchAria 1' }), { target: { value: '/pricing' } });
    fireEvent.change(within(panel).getByRole('combobox', { name: 'replay.funnels.stepKindAria 2' }), { target: { value: 'click' } });
    fireEvent.change(within(panel).getByRole('textbox', { name: 'replay.funnels.matchAria 2' }), { target: { value: 'button.signup' } });

    await waitFor(() => expect(replayApi.previewSmartEvent).toHaveBeenCalledWith('site-1', { ruleKind: 'page', match: '/pricing', matchMode: 'equals' }, { days: 30 }));
    await waitFor(() => expect(replayApi.previewSmartEvent).toHaveBeenCalledWith('site-1', { ruleKind: 'click', match: 'button.signup', matchMode: 'equals' }, { days: 30 }));
    expect(await within(panel).findAllByText('replay.smartEvents.preview.count 12 12 30')).toHaveLength(2);

    fireEvent.click(within(panel).getByRole('button', { name: 'replay.funnels.save' }));
    await waitFor(() => expect(replayApi.createFunnel).toHaveBeenCalledWith('site-1', {
      name: 'Sign-up',
      windowMinutes: 60,
      steps: [
        { stepKind: 'page', match: '/pricing', matchMode: 'equals' },
        { stepKind: 'click', match: 'button.signup', matchMode: 'equals' },
      ],
    }));
    expect(onSaved).toHaveBeenCalledWith(funnel);
  });

  it('says so when the API rejects a rule', async () => {
    vi.mocked(replayApi.previewSmartEvent).mockRejectedValue(new Error('bad rule'));
    render(<FunnelEditor siteId="site-1" days={30} funnel={null} onClose={() => {}} onSaved={() => {}} />);
    const panel = await screen.findByRole('form', { name: 'replay.funnels.newTitle' });
    fireEvent.change(within(panel).getByRole('textbox', { name: 'replay.funnels.matchAria 1' }), { target: { value: '[' } });
    expect(await within(panel).findByText('replay.smartEvents.preview.invalid')).toBeInTheDocument();
  });

  it('updates an existing funnel with PUT and deletes after confirming', async () => {
    const onDeleted = vi.fn();
    render(<FunnelEditor siteId="site-1" days={30} funnel={funnel} onClose={() => {}} onSaved={() => {}} onDeleted={onDeleted} />);
    const panel = await screen.findByRole('form', { name: 'replay.funnels.editTitle' });
    // An event step previews as a `custom` rule.
    await waitFor(() => expect(replayApi.previewSmartEvent).toHaveBeenCalledWith('site-1', { ruleKind: 'custom', match: 'purchase', matchMode: 'equals' }, { days: 30 }));

    fireEvent.click(within(panel).getByRole('button', { name: 'replay.funnels.save' }));
    await waitFor(() => expect(replayApi.updateFunnel).toHaveBeenCalledWith('site-1', 'fun-1', expect.objectContaining({ name: 'Checkout', windowMinutes: 30 })));

    confirmSpy.mockResolvedValueOnce(false);
    fireEvent.click(within(panel).getByRole('button', { name: 'replay.funnels.delete' }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(replayApi.deleteFunnel).not.toHaveBeenCalled();

    confirmSpy.mockResolvedValueOnce(true);
    fireEvent.click(within(panel).getByRole('button', { name: 'replay.funnels.delete' }));
    await waitFor(() => expect(replayApi.deleteFunnel).toHaveBeenCalledWith('site-1', 'fun-1'));
    expect(onDeleted).toHaveBeenCalledWith('fun-1');
  });
});

function Seed({ levels }: { levels: InsightPanelLevel[] }) {
  const { replace, levels: current } = usePanel();
  return (
    <>
      <button type="button" onClick={() => replace(levels)}>seed</button>
      <output data-testid="levels">{JSON.stringify(current)}</output>
    </>
  );
}

function renderInPanel(levels: InsightPanelLevel[]) {
  window.history.replaceState({}, '', '/apps/insights');
  render(
    <InsightsScopeProvider siteId="site-1">
      <InsightsPanelProvider>
        <Seed levels={levels} />
        <InsightsPanel siteId="site-1" />
      </InsightsPanelProvider>
    </InsightsScopeProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'seed' }));
}

describe('FunnelEditor as a panel level (funnel_edit)', () => {
  it('opens inside the ONE panel — exactly one dialog — and a save returns to the funnel level on the saved funnel', async () => {
    vi.spyOn(replayApi, 'getFunnel').mockResolvedValue(funnel);
    vi.spyOn(replayApi, 'listFunnels').mockResolvedValue([funnel]);
    vi.spyOn(replayApi, 'evaluateFunnel').mockResolvedValue({ funnelId: 'fun-1', steps: [], truncated: false, estimated: true });
    renderInPanel([
      { kind: 'funnel', id: funnelLevelId({ funnelId: 'fun-1' }), tab: 'steps' },
      funnelEditLevel('fun-1'),
    ]);

    const form = await screen.findByRole('form', { name: 'replay.funnels.editTitle' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(replayApi.getFunnel).toHaveBeenCalledWith('site-1', 'fun-1');

    fireEvent.click(within(form).getByRole('button', { name: 'replay.funnels.save' }));
    await waitFor(() => expect(replayApi.updateFunnel).toHaveBeenCalledWith('site-1', 'fun-1', expect.objectContaining({ name: 'Checkout' })));
    await waitFor(() => {
      const levels = JSON.parse(screen.getByTestId('levels').textContent ?? '[]') as InsightPanelLevel[];
      expect(levels).toHaveLength(1);
      expect(levels[0]).toMatchObject({ kind: 'funnel', tab: 'steps' });
      expect(parseFunnelLevelId(levels[0]!.id)).toEqual({ funnelId: 'fun-1' });
    });
  });

  it('Cancel pops back to the level beneath', async () => {
    vi.spyOn(replayApi, 'listFunnels').mockResolvedValue([]);
    renderInPanel([{ kind: 'funnel', id: '', tab: 'steps' }, funnelEditLevel()]);
    const form = await screen.findByRole('form', { name: 'replay.funnels.newTitle' });
    fireEvent.click(within(form).getByRole('button', { name: 'replay.funnels.cancel' }));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('levels').textContent ?? '[]')).toEqual([{ kind: 'funnel', id: '', tab: 'steps' }]));
  });
});
