import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InsightsOpsPanel from './InsightsOpsPanel';
import { adminApi, type AdminTenant } from '@/lib/adminApi';
import { replayOpsApi } from '@/lib/replayOpsApi';

/**
 * Admin ▸ Growth ▸ Insights operations (PRD 33 D8, D9, D17): platform aggregates,
 * one workspace's two switches saved with one PATCH, and a credit grant that is
 * confirmed before it is POSTed. Copy is the passthrough key under the global
 * next-intl mock (src/test/setup.ts).
 */

const confirmSpy = vi.fn();
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => confirmSpy }));

const tenant = { id: 7, name: 'Builderforce', slug: 'builderforce' } as AdminTenant;

describe('InsightsOpsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    confirmSpy.mockReset();
    vi.spyOn(adminApi, 'tenants').mockResolvedValue([tenant]);
    vi.spyOn(replayOpsApi, 'summary').mockResolvedValue({
      sites: 3, tenants: 2, sessions7d: 42, keptRecordings7d: 17, bytes7d: 2048, packRevenueCents30d: 0,
    });
    vi.spyOn(replayOpsApi, 'tenantSettings').mockResolvedValue({ replayExcluded: false, replayFreeAllowanceOverride: null });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders the platform summary as tiles', async () => {
    render(<InsightsOpsPanel />);
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('admin.insightsOps.summary.sessions7d')).toBeInTheDocument();
    expect(screen.getByText('admin.insightsOps.summary.packRevenue30d')).toBeInTheDocument();
  });

  it('loads the picked workspace and saves both switches with one PATCH', async () => {
    const update = vi.spyOn(replayOpsApi, 'updateTenantSettings')
      .mockResolvedValue({ replayExcluded: true, replayFreeAllowanceOverride: 0 });
    render(<InsightsOpsPanel />);
    await waitFor(() => expect(replayOpsApi.tenantSettings).toHaveBeenCalledWith(7));
    const toggle = await screen.findByRole('switch');
    await waitFor(() => expect(toggle).not.toBeDisabled());

    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText('admin.insightsOps.settings.override'), { target: { value: '0' } });
    await act(async () => { fireEvent.click(screen.getByText('admin.insightsOps.settings.save')); });

    await waitFor(() => expect(update).toHaveBeenCalledWith(7, { replayExcluded: true, replayFreeAllowanceOverride: 0 }));
    expect(await screen.findByText('admin.insightsOps.settings.saved')).toBeInTheDocument();
  });

  it('clears the override back to the catalog default', async () => {
    vi.spyOn(replayOpsApi, 'tenantSettings').mockResolvedValue({ replayExcluded: false, replayFreeAllowanceOverride: 25 });
    const update = vi.spyOn(replayOpsApi, 'updateTenantSettings')
      .mockResolvedValue({ replayExcluded: false, replayFreeAllowanceOverride: null });
    render(<InsightsOpsPanel />);
    await waitFor(() => expect(screen.getByLabelText('admin.insightsOps.settings.override')).toHaveValue(25));

    fireEvent.click(screen.getByText('admin.insightsOps.settings.clear'));
    await act(async () => { fireEvent.click(screen.getByText('admin.insightsOps.settings.save')); });

    await waitFor(() => expect(update).toHaveBeenCalledWith(7, { replayExcluded: false, replayFreeAllowanceOverride: null }));
  });

  it('confirms a credit grant before posting it', async () => {
    const grant = vi.spyOn(replayOpsApi, 'grantCredits').mockResolvedValue({
      auditId: 'a-1', reference: 'replay-grant:a-1', units: 500, credits: 500,
    });
    confirmSpy.mockResolvedValue(true);
    render(<InsightsOpsPanel />);
    const units = await screen.findByLabelText('admin.insightsOps.grant.units');

    fireEvent.change(units, { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('admin.insightsOps.grant.reason'), { target: { value: 'Customer #1 dogfood' } });
    await act(async () => { fireEvent.click(screen.getByText('admin.insightsOps.grant.submit')); });

    await waitFor(() => expect(grant).toHaveBeenCalledWith({ tenantId: 7, units: 500, reason: 'Customer #1 dogfood' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.invocationCallOrder[0]).toBeLessThan(grant.mock.invocationCallOrder[0]!);
    expect(await screen.findByText(/admin\.insightsOps\.grant\.done/)).toBeInTheDocument();
  });

  it('posts nothing when the grant is declined', async () => {
    const grant = vi.spyOn(replayOpsApi, 'grantCredits');
    confirmSpy.mockResolvedValue(false);
    render(<InsightsOpsPanel />);
    const units = await screen.findByLabelText('admin.insightsOps.grant.units');

    fireEvent.change(units, { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('admin.insightsOps.grant.reason'), { target: { value: 'Customer #1 dogfood' } });
    await act(async () => { fireEvent.click(screen.getByText('admin.insightsOps.grant.submit')); });

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(grant).not.toHaveBeenCalled();
  });

  it('seeds "The method" funnel on the site the operator names (PRD 33 §5.3.6)', async () => {
    const seed = vi.spyOn(replayOpsApi, 'seedMethodFunnel').mockResolvedValue({
      siteId: '11111111-1111-4111-8111-111111111111', funnelId: 'f-1', createdSmartEvents: ['idea.read'], createdFunnel: true,
    });
    render(<InsightsOpsPanel />);
    fireEvent.change(await screen.findByLabelText('admin.insightsOps.methodFunnel.siteLabel'), {
      target: { value: '11111111-1111-4111-8111-111111111111' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'admin.insightsOps.methodFunnel.submit' }));
    await waitFor(() => expect(seed).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111'));
    expect(await screen.findByText(/admin\.insightsOps\.methodFunnel\.done/)).toBeInTheDocument();
  });
});
