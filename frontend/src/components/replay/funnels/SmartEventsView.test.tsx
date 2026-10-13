import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReplaySmartEventDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { InsightsScopeProvider, useInsightsScope } from '@/components/insights/insightsScope';
import { SmartEventsView } from './SmartEventsView';

/**
 * The Events tab: built-in and custom smart events with their ≈ counts; a row
 * narrows the ONE filter; a custom event is created (with a live preview) and
 * deleted only after confirming; "Define from this click" arrives prefilled.
 */

const confirmSpy = vi.hoisted(() => vi.fn<(opts: unknown) => Promise<boolean>>());
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => confirmSpy }));

const builtin: ReplaySmartEventDto = { id: null, name: 'Sign up', ruleKind: 'custom', match: 'signup', matchMode: 'equals', builtin: true, count: 30 };
const custom: ReplaySmartEventDto = { id: 'evt-1', name: 'Pricing CTA', ruleKind: 'click', match: 'a.cta', matchMode: 'equals', builtin: false, count: 7 };

function FilterProbe() {
  const { filter } = useInsightsScope();
  return <output data-testid="filter">{JSON.stringify(filter)}</output>;
}

function renderView(draft?: Parameters<typeof SmartEventsView>[0]['draft']) {
  render(
    <InsightsScopeProvider siteId="site-1">
      <SmartEventsView siteId="site-1" draft={draft} />
      <FilterProbe />
    </InsightsScopeProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/apps/insights');
  confirmSpy.mockReset();
  vi.spyOn(replayApi, 'listSmartEvents').mockResolvedValue([builtin, custom]);
  vi.spyOn(replayApi, 'previewSmartEvent').mockResolvedValue({ count: 4 });
  vi.spyOn(replayApi, 'createSmartEvent').mockResolvedValue({ ...custom, id: 'evt-2', name: 'Buy click', match: 'button.buy' });
  vi.spyOn(replayApi, 'deleteSmartEvent').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SmartEventsView', () => {
  it('lists built-in and custom events with ≈ counts; only custom ones can be deleted', async () => {
    renderView();
    expect(await screen.findByText('Sign up')).toBeInTheDocument();
    expect(screen.getByText('replay.smartEvents.approx 30')).toBeInTheDocument();
    expect(screen.getByText('replay.smartEvents.approx 7')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'replay.smartEvents.deleteAria Sign up' })).toBeNull();
    expect(screen.getByRole('button', { name: 'replay.smartEvents.deleteAria Pricing CTA' })).toBeInTheDocument();
    expect(replayApi.listSmartEvents).toHaveBeenCalledWith('site-1', { days: 30 });
  });

  it('a row narrows the filter to that event', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'replay.smartEvents.filterAria Sign up' }));
    expect(JSON.parse(screen.getByTestId('filter').textContent ?? '')).toEqual({ all: [{ field: 'smartEvent', op: 'eq', value: 'Sign up' }] });
  });

  it('deletes a custom event only after confirming', async () => {
    renderView();
    confirmSpy.mockResolvedValueOnce(false);
    fireEvent.click(await screen.findByRole('button', { name: 'replay.smartEvents.deleteAria Pricing CTA' }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(replayApi.deleteSmartEvent).not.toHaveBeenCalled();
    confirmSpy.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'replay.smartEvents.deleteAria Pricing CTA' }));
    await waitFor(() => expect(replayApi.deleteSmartEvent).toHaveBeenCalledWith('site-1', 'evt-1'));
  });

  it('opens the editor prefilled from a click and saves the rule', async () => {
    renderView({ ruleKind: 'click', match: 'button.buy', matchMode: 'equals' });
    const form = await screen.findByRole('form', { name: 'replay.smartEvents.editorAria' });
    expect(form).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'replay.smartEvents.match' })).toHaveValue('button.buy');
    expect(await screen.findByText('replay.smartEvents.preview.count 4 4 30')).toBeInTheDocument();
    expect(replayApi.previewSmartEvent).toHaveBeenCalledWith('site-1', { ruleKind: 'click', match: 'button.buy', matchMode: 'equals' }, { days: 30 });

    fireEvent.change(screen.getByRole('textbox', { name: 'replay.smartEvents.name' }), { target: { value: 'Buy click' } });
    fireEvent.click(screen.getByRole('button', { name: 'replay.smartEvents.save' }));
    await waitFor(() => expect(replayApi.createSmartEvent).toHaveBeenCalledWith('site-1', {
      name: 'Buy click', ruleKind: 'click', match: 'button.buy', matchMode: 'equals',
    }));
    await waitFor(() => expect(replayApi.listSmartEvents).toHaveBeenCalledTimes(2));
  });
});
