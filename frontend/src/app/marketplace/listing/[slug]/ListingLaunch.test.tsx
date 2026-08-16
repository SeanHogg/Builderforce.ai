/**
 * The launch surface's load-bearing invariants.
 *
 * Two of these guard money and one guards the origin. All three are the kind of
 * thing that reads as fine and is not: a sandbox attribute with one extra token, a
 * price shown from the client's own arithmetic, a preview that quietly carries the
 * product in its payload.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ListingLaunch } from './ListingLaunch';
import type { CreationListing, LaunchPayload } from '@/lib/creationListings';

// The REAL catalog, through the shared resolver — these tests assert on the copy a
// buyer reads (a price, "Sign in to buy"), and a key-passthrough mock would let
// every one of them pass against text nobody can understand.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

const launchMock = vi.fn<(slug: string, signedIn: boolean) => Promise<LaunchPayload>>();

vi.mock('@/lib/creationListings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/creationListings')>();
  return {
    ...actual,
    publicListingApi: { ...actual.publicListingApi, launch: (...args: [string, boolean]) => launchMock(...args) },
    creationListingApi: { ...actual.creationListingApi, acquire: vi.fn(), install: vi.fn() },
  };
});

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const listing = (over: Partial<CreationListing> = {}): CreationListing => ({
  id: 'l1', slug: 'space-game', kind: 'game', name: 'Space Game', summary: null,
  category: null, tags: [], version: '1.0.0', visibility: 'public',
  priceCents: 0, currency: 'USD', trial: 'full', launch: 'play', icon: '🎮',
  installCount: 3, rating: null, publishedAtISO: null, updatedAtISO: '',
  sellerRef: 'u1', sellerName: 'Ada', ...over,
});

const renderLaunch = (item: CreationListing) => render(<ListingLaunch listing={item} />);

beforeEach(() => { launchMock.mockReset(); });

describe('ListingLaunch', () => {
  it('plays a game in a frame that can never reach this origin', async () => {
    launchMock.mockResolvedValue({
      mode: 'play', entitled: true, title: 'Space Game', document: '<h1>hi</h1>',
    });
    const { container } = renderLaunch(listing());

    const frame = await waitFor(() => {
      const found = container.querySelector('iframe');
      expect(found).toBeTruthy();
      return found!;
    });

    // The document is model-authored HTML from a stranger's brief. `allow-scripts`
    // alone keeps it in an opaque origin; adding `allow-same-origin` beside it
    // would hand it this app's session.
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    // Fed by srcDoc, not a blob URL — a blob inherits the creating origin.
    expect(frame.getAttribute('srcdoc')).toContain('<h1>hi</h1>');
    expect(frame.getAttribute('src')).toBeNull();
  });

  it('never renders a runnable payload the server marked unentitled', async () => {
    launchMock.mockResolvedValue({
      mode: 'preview', entitled: false, title: 'Space Game',
      objects: [{ id: 'o1', kind: 'game', canvasData: { title: 'Level 1' }, content: null }],
    });
    const { container } = renderLaunch(listing({ priceCents: 900, trial: 'preview' }));

    await screen.findByText(/This is a preview\. Buy it to use the working version\./i);
    // No frame at all: the preview is metadata, and "the payload but with a flag"
    // is how a paid product ends up readable in a network tab.
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('shows the seller’s price, not a number it computed itself', async () => {
    launchMock.mockResolvedValue({ mode: 'preview', entitled: false, title: 'x', objects: [] });
    renderLaunch(listing({ priceCents: 1250, currency: 'USD' }));
    expect(await screen.findByText('$12.50')).toBeInTheDocument();
  });

  it('asks a signed-out visitor to sign in rather than failing the purchase', async () => {
    launchMock.mockResolvedValue({ mode: 'play', entitled: true, title: 'x', document: '<p>p</p>' });
    renderLaunch(listing({ priceCents: 500 }));
    expect(await screen.findByRole('link', { name: /sign in to buy/i })).toBeInTheDocument();
  });

  it('still launches for a logged-out visitor — a free listing runs for anyone', async () => {
    launchMock.mockResolvedValue({ mode: 'play', entitled: true, title: 'x', document: '<p>free</p>' });
    renderLaunch(listing());
    await waitFor(() => expect(launchMock).toHaveBeenCalledWith('space-game', false));
  });
});

/**
 * The inherited rule, asserted where it is kept: a limitation the SELLER learned in
 * Stage is declared on the listing rather than discovered by the buyer.
 */
describe('declared limits', () => {
  it('shows the buyer every limit the staged build shipped with', async () => {
    launchMock.mockResolvedValue({ mode: 'play', entitled: true, title: 'x', document: '<p>p</p>' });
    renderLaunch(listing({
      declared: [
        { code: 'stage.sandboxLimit', group: 'runs', severity: 'warn', label: 'Checked without being run in a sandbox' },
        { code: 'runtime.touch', group: 'runs', severity: 'warn', label: 'No touch input found', detail: 'Keyboard-only.' },
      ],
    }));
    const panel = await screen.findByRole('region', { name: 'Known limits' });
    // The platform's OWN limit, in the buyer's words — not only the seller's.
    expect(panel).toHaveTextContent('Checked without being run in a sandbox');
    // Label AND detail: the sentence that tells a buyer what the limit costs them
    // is the half a summary would drop.
    expect(panel).toHaveTextContent('No touch input found — Keyboard-only.');
  });

  it('renders nothing at all when there is nothing to declare', async () => {
    launchMock.mockResolvedValue({ mode: 'play', entitled: true, title: 'x', document: '<p>p</p>' });
    renderLaunch(listing({ declared: [] }));
    await screen.findByText('Free');
    // A "Known limits" heading over an empty list reads as a missing feature, so the
    // component decides its own visibility rather than taking a `show` prop.
    expect(screen.queryByRole('region', { name: 'Known limits' })).toBeNull();
  });
});

/**
 * R9, at the only moment it matters: BEFORE somebody subscribes to something that is
 * no longer running.
 */
describe('a hosted app that has gone dark', () => {
  const hostedLaunch = (state: 'operating' | 'grace' | 'readOnly' | 'released', days: number | null): LaunchPayload => ({
    mode: 'open', entitled: true, title: 'Acme Ops', url: 'https://acme.example',
    hosted: {
      listingId: 'l1', withdrawnAtISO: null, lastProbeAtISO: null, lastProbeUrl: null,
      state, darkSinceISO: state === 'operating' ? null : '2026-07-01T00:00:00.000Z',
      daysUntilNextState: days,
      billable: state === 'operating' || state === 'grace',
      subscriberMayExport: state === 'readOnly' || state === 'released',
      subscriberMayTake: state === 'released',
    },
  });

  it('warns during grace, and says how long the seller has left', async () => {
    launchMock.mockResolvedValue(hostedLaunch('grace', 9));
    renderLaunch(listing({ kind: 'app', launch: 'open', delivery: 'hosted' }));
    expect(await screen.findByRole('status'))
      .toHaveTextContent('The seller has 9 days to bring it back before your subscription pauses.');
  });

  it('tells a subscriber they may take the build once it is abandoned', async () => {
    launchMock.mockResolvedValue(hostedLaunch('released', null));
    renderLaunch(listing({ kind: 'app', launch: 'open', delivery: 'hosted' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/take the published build/i);
  });

  it('says nothing while it is simply working', async () => {
    launchMock.mockResolvedValue(hostedLaunch('operating', null));
    renderLaunch(listing({ kind: 'app', launch: 'open', delivery: 'hosted' }));
    await waitFor(() => expect(launchMock).toHaveBeenCalled());
    // A banner on the overwhelmingly common state is noise, and noise is what makes
    // the other three states invisible.
    expect(screen.queryByRole('status')).toBeNull();
  });
});
