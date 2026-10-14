import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_REPLAY_SITE_SETTINGS, type ReplaySiteDto, type ReplaySiteVerifyDto } from '@builderforce/interaction-contract';

/**
 * PRD 33 §4.2 — the ONE set-up page: steps advance only when their own call
 * succeeded, Verify polls every 5 s, and a pack button starts the one-off checkout.
 */

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/apps/insights/setup' }));

const session = vi.hoisted(() => ({ current: 'ready' as 'loading' | 'anonymous' | 'no-tenant' | 'ready' }));
vi.mock('@/lib/useRequireSession', () => ({ useRequireSession: () => session.current }));

const capability = vi.hoisted(() => ({ current: { state: null as null | { installed: boolean; siteCount: number }, entitled: false as boolean | null } }));
vi.mock('@/lib/useCapability', () => ({ useCapability: () => capability.current }));

vi.mock('@/lib/AuthContext', () => {
  const value = { tenant: { id: '3', name: 'Acme' }, hasTenant: true, isAuthenticated: true, authReady: true };
  return { useAuth: () => value, useOptionalAuth: () => value };
});

const acquire = vi.hoisted(() => vi.fn());
vi.mock('@/lib/creationListings', () => ({ creationListingApi: { acquire } }));

const sites = vi.hoisted(() => ({
  createExternal: vi.fn(),
  enableProjectSite: vi.fn(),
  publishedProjects: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('@/lib/replaySitesApi', () => ({ replaySitesApi: sites }));

const capabilityApi = vi.hoisted(() => ({ packs: vi.fn(), startPackCheckout: vi.fn() }));
vi.mock('@/lib/capabilityApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/capabilityApi')>()),
  capabilityApi,
  invalidateCapabilityState: vi.fn(),
}));

// The manager gate is RoleGate's own concern (tested there); these tests run as a manager.
vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const { CapabilitySetup } = await import('./CapabilitySetup');
const { PlanStep } = await import('./PlanStep');
const { CAPABILITY_APPS } = await import('@/lib/marketplace/capabilityApps');

const site: ReplaySiteDto = {
  id: 'site-1', kind: 'external', projectId: null, label: 'Shop', status: 'active',
  settings: DEFAULT_REPLAY_SITE_SETTINGS, allowedOrigins: ['https://shop.example.com'],
  publicKey: 'site-key-1', createdAt: '2026-10-13T00:00:00.000Z',
};
const pending: ReplaySiteVerifyDto = { scriptSeen: false, originOk: false, firstEventAt: null, firstRecordingId: null };
const installed: ReplaySiteVerifyDto = { scriptSeen: true, originOk: true, firstEventAt: '2026-10-13T00:01:00.000Z', firstRecordingId: null };

beforeEach(() => {
  session.current = 'ready';
  capability.current = { state: { installed: false, siteCount: 0 }, entitled: false };
  for (const fn of [acquire, sites.createExternal, sites.enableProjectSite, sites.publishedProjects, sites.verify, capabilityApi.packs, capabilityApi.startPackCheckout, router.push]) fn.mockReset();
  capabilityApi.packs.mockResolvedValue([]);
  sites.publishedProjects.mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });

/** From the site step, through a created site, to the step after the snippet. */
async function reachVerify() {
  capability.current = { state: { installed: true, siteCount: 0 }, entitled: true };
  sites.createExternal.mockResolvedValue(site);
  render(<CapabilitySetup appId="insights" />);
  fireEvent.change(await screen.findByLabelText('marketplace.capability.site.label'), { target: { value: 'Shop' } });
  fireEvent.change(screen.getByPlaceholderText('marketplace.capability.site.domainPlaceholder'), { target: { value: 'shop.example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'marketplace.capability.site.addDomain' }));
  fireEvent.click(screen.getByTestId('setup-create-site'));
  fireEvent.click(await screen.findByTestId('setup-snippet-next'));
}

describe('Insights set-up', () => {
  it('installs on the workspace step and advances only when the install succeeded', async () => {
    acquire.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce({ orderId: 1, priceCents: 0 });
    render(<CapabilitySetup appId="insights" />);
    expect(await screen.findByTestId('setup-step-workspace')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('setup-install'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('setup-step-workspace')).toBeInTheDocument();
    expect(acquire).toHaveBeenCalledWith(CAPABILITY_APPS.insights.listingSlug);

    fireEvent.click(screen.getByTestId('setup-install'));
    expect(await screen.findByTestId('setup-step-site')).toBeInTheDocument();
  });

  it('starts a workspace that already holds the listing at the site step', async () => {
    capability.current = { state: { installed: true, siteCount: 0 }, entitled: true };
    render(<CapabilitySetup appId="insights" />);
    expect(await screen.findByTestId('setup-step-site')).toBeInTheDocument();
    expect(acquire).not.toHaveBeenCalled();
  });

  it('creates the site from name + domains + switches, staying put while the call fails', async () => {
    capability.current = { state: { installed: true, siteCount: 0 }, entitled: true };
    sites.createExternal.mockRejectedValueOnce(new Error('bad')).mockResolvedValueOnce(site);
    render(<CapabilitySetup appId="insights" />);
    const create = await screen.findByTestId('setup-create-site');
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByLabelText('marketplace.capability.site.label'), { target: { value: 'Shop' } });
    fireEvent.change(screen.getByPlaceholderText('marketplace.capability.site.domainPlaceholder'), { target: { value: 'https://shop.example.com/pricing' } });
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.capability.site.addDomain' }));
    fireEvent.click(screen.getByRole('switch', { checked: false, name: /maskAllText/ }));
    expect(create).not.toBeDisabled();

    fireEvent.click(create);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('setup-step-site')).toBeInTheDocument();
    expect(sites.createExternal).toHaveBeenLastCalledWith({
      label: 'Shop',
      allowedOrigins: ['https://shop.example.com'],
      settings: { ...DEFAULT_REPLAY_SITE_SETTINGS, maskAllText: true },
    });

    fireEvent.click(create);
    expect(await screen.findByTestId('setup-step-snippet')).toBeInTheDocument();
    expect(screen.getByTestId('snippet-code')).toHaveTextContent('site-key-1');
  });

  it('polls Verify every 5 s and continues only once the install has proved itself', async () => {
    // Timers advance on their own (so `findBy*` still polls) and can be jumped.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sites.verify.mockResolvedValue(pending);
    await reachVerify();
    expect(await screen.findByTestId('capability-verify')).toBeInTheDocument();
    await vi.waitFor(() => expect(sites.verify).toHaveBeenCalledWith('site-1'));
    expect(await screen.findByTestId('verify-stopped')).toHaveTextContent('marketplace.capability.verify.checks.loader.label');
    expect(screen.getByTestId('setup-verify-next')).toBeDisabled();

    const before = sites.verify.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(sites.verify.mock.calls.length).toBeGreaterThan(before);
    expect(screen.getByTestId('setup-verify-next')).toBeDisabled();

    sites.verify.mockResolvedValue(installed);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(await screen.findByTestId('verify-stopped')).toHaveTextContent('marketplace.capability.verify.checks.firstRecording.label');
    const next = screen.getByTestId('setup-verify-next');
    expect(next).not.toBeDisabled();
    fireEvent.click(next);
    expect(await screen.findByTestId('setup-step-plan')).toBeInTheDocument();
  });

  it('a pack button starts the one-off checkout and leaves for the processor', async () => {
    capabilityApi.packs.mockResolvedValue([{ id: 'pack-10k', units: 10_000, amountCents: 4_000 }]);
    capabilityApi.startPackCheckout.mockResolvedValue('https://checkout.example/session');
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin: 'https://builderforce.ai', pathname: '/apps/insights/setup', search: '', href: 'https://builderforce.ai/apps/insights/setup', assign },
    });
    try {
      render(<PlanStep app={{ id: 'insights', ...CAPABILITY_APPS.insights }} site={site} onDone={vi.fn()} />);
      const pack = await screen.findByRole('button', { name: /pack-10k|10,000/ });
      fireEvent.click(pack);
      await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.example/session'));
      expect(capabilityApi.startPackCheckout).toHaveBeenCalledWith(
        'pack-10k',
        'https://builderforce.ai/apps/insights?panel=plan:packs&checkout={CHECKOUT_SESSION_ID}',
      );
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('sends a signed-out visitor to sign up with the intent kept', () => {
    session.current = 'anonymous';
    render(<CapabilitySetup appId="insights" />);
    const link = screen.getByRole('link', { name: 'marketplace.capability.startFree' });
    const href = link.getAttribute('href') ?? '';
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(params.get('next')).toBe('/apps/insights/setup');
    expect(params.get('intent')).toBe('install:insights');
  });
});
