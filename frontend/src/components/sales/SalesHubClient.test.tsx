/**
 * The Sales Hub shows an associate's figures from the person-level token alone.
 *
 * The API now answers `/api/sales/{reports,leads,payouts}` by ATTRIBUTION across every
 * workspace, so the hub never asks for a workspace and never renders "nothing" for want
 * of one. A failed read must say so rather than look like an empty programme.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({ sub: 'leads' }));
const api = vi.hoisted(() => ({
  canvas: vi.fn(),
  report: vi.fn(),
  leads: vi.fn(),
  payouts: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => state.sub }),
}));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/salesApi', () => ({ salesApi: api }));
vi.mock('@/lib/referenceChrome', () => ({
  usePublishReferenceChrome: () => undefined,
  usePublishReferenceSelect: () => undefined,
  useReferenceRailActive: () => true,
}));
vi.mock('@/lib/useMoneyFormat', () => ({ useMoneyFormat: () => ({ formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}` }) }));
vi.mock('@/i18n/useFormat', () => ({ useFormat: () => ({ dateWith: (iso: string) => iso.slice(0, 10) }) }));
vi.mock('@/lib/apiClient', () => ({ faultText: (_cause: unknown, fallback: string) => fallback }));
vi.mock('@/lib/content', () => ({ MEDIA_KIT: { assets: [] } }));
vi.mock('@/components/PageContainer', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/shell/DestinationIndex', () => ({ DestinationIndex: () => null }));
vi.mock('@/components/CopyButton', () => ({ CopyButton: () => null }));
vi.mock('@/components/payouts/PayoutConnections', () => ({ PayoutConnections: () => null }));
vi.mock('@/components/inbox/InboxClient', () => ({ InboxClient: () => null }));
vi.mock('@/components/sales/SalesReportView', () => ({ SalesReportView: () => <div data-testid="sales-report" /> }));

import SalesHubClient from './SalesHubClient';

const REPORT = { windows: [], associates: [] };

beforeEach(() => {
  api.canvas.mockReset().mockResolvedValue({ referralCode: 'BFA', salesCode: 'BSA', sessionId: null });
  api.report.mockReset().mockResolvedValue({ report: REPORT, scope: 'associate' });
  api.leads.mockReset().mockResolvedValue({
    window: 'month',
    leads: [
      // Two workspaces' referrals, one list: the hub renders what is attributed.
      { id: 'r2', attributionType: 'sales', signedUpAt: '2026-09-03T00:00:00Z', convertedAt: '2026-09-10T00:00:00Z', plan: 'teams', revenueCents: 80_000, commissionCents: 20_000 },
      { id: 'r1', attributionType: 'referral', signedUpAt: '2026-09-01T00:00:00Z', convertedAt: '2026-09-05T00:00:00Z', plan: 'pro', revenueCents: 50_000, commissionCents: 10_000 },
    ],
  });
  api.payouts.mockReset().mockResolvedValue({
    balance: { earnedCents: 30_000, paidCents: 5_000, availableCents: 25_000 },
    payouts: [],
    accounts: [],
  });
});

describe('SalesHubClient', () => {
  it('lists every attributed lead without asking for a workspace', async () => {
    state.sub = 'leads';
    render(<SalesHubClient />);

    expect(await screen.findByText('$200.00')).toBeInTheDocument();
    expect(screen.getByText('$100.00')).toBeInTheDocument();
    expect(screen.getByText('attributedScope')).toBeInTheDocument();
    // Own figures: no associate id, no workspace — the person-level token is enough.
    expect(api.leads).toHaveBeenCalledWith('month');
  });

  it('shows the commission balance on the payouts tab', async () => {
    state.sub = 'payouts';
    render(<SalesHubClient />);

    expect(await screen.findByText('$300.00')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.getByText('$250.00')).toBeInTheDocument();
    expect(api.payouts).toHaveBeenCalledWith();
  });

  it('says a read failed instead of rendering an empty programme', async () => {
    state.sub = 'reports';
    api.report.mockReset().mockRejectedValue(new Error('boom'));
    render(<SalesHubClient />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('loadFailed'));
    expect(screen.queryByText('loading')).toBeNull();
  });
});
