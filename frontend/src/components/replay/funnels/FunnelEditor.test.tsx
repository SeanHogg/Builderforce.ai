import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReplayFunnelDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { FunnelEditor } from './FunnelEditor';

/**
 * The funnel editor: each step previews how many kept recordings match it
 * (the smart-event preview, a click step as a `click` rule, an event step as
 * `custom`), saves with POST or PUT, and deletes only after confirming.
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
    const panel = await screen.findByRole('dialog');

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
    const panel = await screen.findByRole('dialog');
    fireEvent.change(within(panel).getByRole('textbox', { name: 'replay.funnels.matchAria 1' }), { target: { value: '[' } });
    expect(await within(panel).findByText('replay.smartEvents.preview.invalid')).toBeInTheDocument();
  });

  it('updates an existing funnel with PUT and deletes after confirming', async () => {
    const onDeleted = vi.fn();
    render(<FunnelEditor siteId="site-1" days={30} funnel={funnel} onClose={() => {}} onSaved={() => {}} onDeleted={onDeleted} />);
    const panel = await screen.findByRole('dialog');
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
