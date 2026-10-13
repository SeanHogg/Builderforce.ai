import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

/**
 * PRD 33 §4.2 step 1 — a listing's landing is DATA (`LISTING_LANDINGS`) drawn by
 * ONE registry, in the order the data lists; a listing without an entry gets
 * nothing extra.
 */

const auth = vi.hoisted(() => ({ current: { isAuthenticated: false } as { isAuthenticated: boolean } | null }));
vi.mock('@/lib/AuthContext', () => ({ useOptionalAuth: () => auth.current }));

const packs = vi.hoisted(() => vi.fn());
vi.mock('@/lib/capabilityApi', () => ({ capabilityApi: { packs } }));
vi.mock('@/lib/platformProof', () => ({
  fetchPlatformProof: () => Promise.reject(new Error('offline')),
  visibleProofMetrics: () => [],
}));

const { ListingLanding } = await import('./ListingLanding');
const { LISTING_LANDINGS, landingFor, listingLandingJsonLd } = await import('@/lib/marketplace/listingLandings');

beforeEach(() => {
  auth.current = { isAuthenticated: false };
  packs.mockReset();
  packs.mockResolvedValue([
    { id: 'p10k', units: 10_000, amountCents: 4_000 },
    { id: 'p1m', units: 1_000_000, amountCents: 120_000 },
  ]);
});

describe('listing landings', () => {
  it('renders an entry’s sections in the order the data lists them', async () => {
    const sections = landingFor('session-replay');
    expect(sections).not.toBeNull();
    const { container } = render(<ListingLanding sections={sections} />);
    const rendered = [...container.querySelectorAll('[data-section]')].map((el) => el.getAttribute('data-section'));
    expect(rendered).toEqual(LISTING_LANDINGS['session-replay']!.map((section) => section.kind));
    expect(rendered).toEqual(['hero', 'install', 'pillars', 'compare', 'pricing', 'faq', 'proof']);
    expect(await screen.findByTestId('pricing-calculator')).toBeInTheDocument();
  });

  it('renders nothing extra for a slug without an entry', () => {
    expect(landingFor('a-plain-game')).toBeNull();
    expect(landingFor('toString')).toBeNull();
    const { container } = render(<ListingLanding sections={landingFor('a-plain-game')} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('starts a signed-out visitor at sign-up with the install intent, a member at set-up', () => {
    const { unmount } = render(<ListingLanding sections={landingFor('session-replay')} />);
    const href = screen.getAllByTestId('landing-start')[0]!.getAttribute('href') ?? '';
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(href.startsWith('/register?')).toBe(true);
    expect(params.get('next')).toBe('/apps/insights/setup');
    expect(params.get('intent')).toBe('install:insights');
    unmount();

    auth.current = { isAuthenticated: true };
    render(<ListingLanding sections={landingFor('session-replay')} />);
    expect(screen.getAllByTestId('landing-start')[0]).toHaveAttribute('href', '/apps/insights/setup');
  });

  it('prices a month from the catalog ladder: free under the allowance, the covering pack above it', async () => {
    render(<ListingLanding sections={landingFor('session-replay')} />);
    await vi.waitFor(() => expect(packs).toHaveBeenCalled());
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '0' } });
    expect(screen.getByTestId('pricing-cost')).toHaveTextContent('marketplace.landing.insights.pricing.free');
    fireEvent.change(slider, { target: { value: '9' } });
    expect(await screen.findByText(/1,200/)).toBeInTheDocument();
  });

  it('describes the listing as a free web application for search', () => {
    const data = listingLandingJsonLd({ name: 'Insights', summary: 'See what visitors do.', slug: 'session-replay' }, 'https://builderforce.ai/');
    expect(data['@type']).toBe('SoftwareApplication');
    expect(data.url).toBe('https://builderforce.ai/marketplace/listing/session-replay');
    expect(data.offers).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'USD' });
  });
});
