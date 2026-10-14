import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { adminApi } from '@/lib/adminApi';
import { VisitorPanel, VISITOR_PANEL_TABS } from './VisitorPanel';

/**
 * The admin visitor panel: tabs from `VISITOR_PANEL_TABS`, and erase — now in
 * the lead body — confirms, calls `forgetGuestPrompts`, tells the host and
 * closes the panel (there is nothing left to show).
 */

const confirmSpy = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => confirmSpy }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), show: vi.fn(), dismiss: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => toast }));

vi.mock('@/components/visitors/VisitorJourneyTimeline', () => ({
  VisitorJourneyTimeline: ({ visitorId }: { visitorId: string }) => <div>journey of {visitorId}</div>,
}));
vi.mock('@/components/visitors/GuestSessionCopyButton', () => ({ GuestSessionCopyButton: () => null }));
vi.mock('@/components/admin/panels/BroadcastComposer', () => ({ BroadcastComposer: () => null }));

beforeEach(() => {
  confirmSpy.mockClear();
  confirmSpy.mockResolvedValue(true);
  toast.success.mockClear();
  toast.error.mockClear();
  vi.spyOn(adminApi, 'guestPrompts').mockResolvedValue([]);
  vi.spyOn(adminApi, 'forgetGuestPrompts').mockResolvedValue(3);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderLead(over: { onClose?: () => void; onErased?: () => void } = {}) {
  const onClose = over.onClose ?? vi.fn();
  const onErased = over.onErased ?? vi.fn();
  render(
    <VisitorPanel visitorId="vis-1" tab="lead" onTabChange={() => {}} onClose={onClose} onErased={onErased} />,
  );
  return { onClose, onErased };
}

describe('VisitorPanel', () => {
  it('draws its tabs from VISITOR_PANEL_TABS', async () => {
    render(<VisitorPanel visitorId="vis-1" tab="journey" onTabChange={() => {}} onClose={() => {}} />);
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(VISITOR_PANEL_TABS.map((row) => row.labelKey));
    expect(within(panel).getByText('journey of vis-1')).toBeInTheDocument();
  });

  it('switches tabs through the host', async () => {
    const onTabChange = vi.fn();
    render(<VisitorPanel visitorId="vis-1" tab="journey" onTabChange={onTabChange} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'admin.insights.tabLead' }));
    expect(onTabChange).toHaveBeenCalledWith('lead');
  });

  it('erase confirms, calls forgetGuestPrompts, reports and closes the panel', async () => {
    const { onClose, onErased } = renderLead();
    const erase = await screen.findByRole('button', { name: 'admin.sessions.eraseAria vis-1' });
    await act(async () => { fireEvent.click(erase); });
    expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({ destructive: true, message: 'admin.sessions.eraseConfirm' }));
    expect(adminApi.forgetGuestPrompts).toHaveBeenCalledWith('vis-1');
    expect(toast.success).toHaveBeenCalledWith('admin.sessions.eraseDone 3');
    expect(onErased).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the erase is not confirmed', async () => {
    confirmSpy.mockResolvedValue(false);
    const { onClose, onErased } = renderLead();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'admin.sessions.eraseAria vis-1' })); });
    expect(adminApi.forgetGuestPrompts).not.toHaveBeenCalled();
    expect(onErased).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the panel open and says so when the erase fails', async () => {
    vi.mocked(adminApi.forgetGuestPrompts).mockRejectedValue(new Error('nope'));
    const { onClose, onErased } = renderLead();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'admin.sessions.eraseAria vis-1' })); });
    expect(toast.error).toHaveBeenCalledWith('admin.sessions.eraseFailed');
    expect(onErased).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
