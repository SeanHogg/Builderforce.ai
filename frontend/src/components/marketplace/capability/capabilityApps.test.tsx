import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * PRD 33 §4.2 step 8 — `/apps/<id>` is decided by the workspace's entitlement,
 * from data: not entitled → the listing; entitled with no site → set-up;
 * otherwise the app itself.
 */

const session = vi.hoisted(() => ({ current: 'ready' as 'loading' | 'anonymous' | 'no-tenant' | 'ready' }));
vi.mock('@/lib/useRequireSession', () => ({ useRequireSession: () => session.current }));

const capability = vi.hoisted(() => ({ current: { state: null as null | { siteCount: number }, entitled: null as boolean | null } }));
vi.mock('@/lib/useCapability', () => ({ useCapability: () => capability.current }));

vi.mock('@/components/insights/InsightsApp', () => ({ InsightsApp: () => <div data-testid="insights-app-stub" /> }));

const { CapabilityAppView } = await import('./CapabilityAppView');
const { CAPABILITY_APPS, capabilityAppFor, installedCapabilityApps } = await import('@/lib/marketplace/capabilityApps');

beforeEach(() => {
  session.current = 'ready';
  capability.current = { state: null, entitled: null };
});

describe('capability apps', () => {
  it('not entitled: sends the workspace to the listing', () => {
    capability.current = { state: { siteCount: 0 }, entitled: false };
    render(<CapabilityAppView appId="insights" />);
    expect(screen.getByTestId('capability-app-not-entitled')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/marketplace/listing/session-replay');
    expect(screen.queryByTestId('insights-app-stub')).toBeNull();
  });

  it('a signed-out visitor is shown the listing too', () => {
    session.current = 'anonymous';
    render(<CapabilityAppView appId="insights" />);
    expect(screen.getByTestId('capability-app-not-entitled')).toBeInTheDocument();
  });

  it('entitled with no site: offers set-up', () => {
    capability.current = { state: { siteCount: 0 }, entitled: true };
    render(<CapabilityAppView appId="insights" />);
    expect(screen.getByTestId('capability-app-setup')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/apps/insights/setup');
  });

  it('entitled with a site: the app', () => {
    capability.current = { state: { siteCount: 2 }, entitled: true };
    render(<CapabilityAppView appId="insights" />);
    expect(screen.getByTestId('insights-app-stub')).toBeInTheDocument();
  });

  it('decides nothing while the entitlement is unknown', () => {
    render(<CapabilityAppView appId="insights" />);
    expect(screen.queryByTestId('capability-app-not-entitled')).toBeNull();
    expect(screen.queryByTestId('insights-app-stub')).toBeNull();
  });

  it('resolves apps from data, and lists only the installed ones', () => {
    expect(capabilityAppFor('insights')).toMatchObject({ id: 'insights', listingSlug: 'session-replay', setupPath: '/apps/insights/setup' });
    expect(capabilityAppFor('nope')).toBeNull();
    expect(capabilityAppFor('constructor')).toBeNull();
    expect(installedCapabilityApps(['session-replay', 'space-game']).map((app) => app.id)).toEqual(['insights']);
    expect(installedCapabilityApps(['space-game'])).toEqual([]);
    expect(CAPABILITY_APPS.insights.homePath).toBe('/apps/insights');
  });
});
