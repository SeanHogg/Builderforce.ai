/**
 * The seller panel's auth invariant.
 *
 * `/marketplace` is a page anyone may browse, and this panel reads tenant-scoped
 * money endpoints. The failure it guards against does not look like a failure: the
 * panel's own `catch` swallows the error and it renders nothing either way, so the
 * only visible symptom is a support ticket — a 401 on
 * `/api/creation-listings/earnings` raised by a logged-out stranger. Asserting on
 * the rendered output would pass against the bug; these assert on the CALLS.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SellerEarnings } from './SellerEarnings';
import type { CreationListing } from '@/lib/creationListings';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

const mineMock = vi.fn<() => Promise<CreationListing[]>>();
const earningsMock = vi.fn();

vi.mock('@/lib/creationListings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/creationListings')>();
  return {
    ...actual,
    creationListingApi: {
      ...actual.creationListingApi,
      mine: () => mineMock(),
      earnings: () => earningsMock(),
    },
  };
});

vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn() }));

let hasTenant = false;
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ hasTenant }) }));

const listing = (over: Partial<CreationListing> = {}): CreationListing => ({
  id: 'l1', slug: 'space-game', kind: 'game', name: 'Space Game', summary: null,
  category: null, tags: [], version: '1.0.0', visibility: 'public',
  priceCents: 900, currency: 'USD', trial: 'full', launch: 'play', icon: '🎮',
  installCount: 3, rating: null, publishedAtISO: null, updatedAtISO: '',
  sellerRef: 'u1', sellerName: 'Ada', ...over,
});

beforeEach(() => {
  mineMock.mockReset();
  earningsMock.mockReset();
  hasTenant = false;
});

describe('SellerEarnings', () => {
  it('asks the API for nothing at all without a workspace token', async () => {
    render(<SellerEarnings />);
    // Give the mount effect every chance to fire before concluding it did not.
    await waitFor(() => expect(mineMock).not.toHaveBeenCalled());
    expect(earningsMock).not.toHaveBeenCalled();
  });

  it('reads the seller surface once there is a workspace', async () => {
    hasTenant = true;
    mineMock.mockResolvedValue([listing()]);
    earningsMock.mockResolvedValue({
      earnings: { earnedCents: 2500, paidCents: 1000, availableCents: 1500, salesCount: 4 },
      takeRateBps: 1000,
    });

    render(<SellerEarnings />);

    await waitFor(() => expect(earningsMock).toHaveBeenCalledTimes(1));
    // The three balances are shown separately on purpose — a single number is how
    // somebody concludes a payout failed when it had already happened.
    expect(await screen.findByText('$25.00')).toBeInTheDocument();
    expect(screen.getByText('$10.00')).toBeInTheDocument();
    expect(screen.getByText('$15.00')).toBeInTheDocument();
  });

  it('renders nothing for a workspace that has published nothing', async () => {
    hasTenant = true;
    mineMock.mockResolvedValue([]);
    earningsMock.mockResolvedValue({
      earnings: { earnedCents: 0, paidCents: 0, availableCents: 0, salesCount: 0 },
      takeRateBps: 1000,
    });

    const { container } = render(<SellerEarnings />);

    await waitFor(() => expect(earningsMock).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
