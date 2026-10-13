import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { writeConsent } from '@/lib/analyticsConsent';
import { replayLoaderMayRecord } from '@/lib/replayLoaderGate';

/**
 * PRD 33 S3, D7, D9 — builderforce.ai's own recorder: nothing without a site
 * key, nothing before analytics consent, and signed-in members only when the
 * platform allows it and their workspace is known not to be excluded.
 */

type AuthShape = {
  authReady: boolean;
  isAuthenticated: boolean;
  user: { id: string } | null;
  tenant: { id: string; name: string } | null;
};
const auth = vi.hoisted(() => ({ current: null as AuthShape | null }));
vi.mock('@/lib/AuthContext', () => ({ useOptionalAuth: () => auth.current }));
/** The consumption snapshot carries the workspace's `replayExcluded` (unknown until it loads). */
const consumption = vi.hoisted(() => ({ current: null as { plan: { effective: string }; replayExcluded?: boolean } | null }));
vi.mock('@/lib/useConsumption', () => ({ useConsumption: () => consumption.current }));

const { ReplayLoader } = await import('./ReplayLoader');

const replay = { consent: vi.fn(), identify: vi.fn(), stop: vi.fn() };
let origin = 0;
/** A fresh loader origin per render: React keeps hoisted scripts deduped by `src`. */
const nextOrigin = () => `https://cdn${++origin}.example`;
const loaderScript = (cdn: string) => document.querySelector(`script[src="${cdn}/replay/v1/loader.js"]`);

const optIn = () => act(() => {
  writeConsent({ version: 1, analytics: true, marketing: false, gpc: false, updatedAt: '2026-10-13T00:00:00.000Z' });
});

beforeEach(() => {
  auth.current = { authReady: true, isAuthenticated: false, user: null, tenant: null };
  consumption.current = { plan: { effective: 'pro' } };
  replay.consent.mockReset();
  replay.identify.mockReset();
  replay.stop.mockReset();
  (window as Window & { BFReplay?: unknown }).BFReplay = replay;
});
afterEach(() => {
  window.localStorage.clear();
  delete (window as Window & { BFReplay?: unknown }).BFReplay;
});

describe('ReplayLoader', () => {
  it('renders nothing without a site key, even with consent', () => {
    const cdn = nextOrigin();
    optIn();
    render(<ReplayLoader siteKey="" cdnOrigin={cdn} />);
    expect(loaderScript(cdn)).toBeNull();
    expect(replay.consent).not.toHaveBeenCalled();
  });

  it('waits for analytics consent, then loads the snippet and passes the consent on', () => {
    const cdn = nextOrigin();
    render(<ReplayLoader siteKey="site-key-1" release="2026.10.13" cdnOrigin={cdn} />);
    expect(loaderScript(cdn)).toBeNull();
    expect(replay.consent).not.toHaveBeenCalled();

    optIn();
    const script = loaderScript(cdn);
    expect(script).not.toBeNull();
    expect(script).toHaveAttribute('data-site', 'site-key-1');
    expect(script).toHaveAttribute('data-release', '2026.10.13');
    expect(script).toHaveAttribute('async');
    expect(replay.consent).toHaveBeenCalledWith(true);
    expect(replay.identify).not.toHaveBeenCalled();
  });

  it('does not record a signed-in member while recordSignedIn is off', () => {
    const cdn = nextOrigin();
    consumption.current = { plan: { effective: 'pro' }, replayExcluded: false };
    auth.current = { authReady: true, isAuthenticated: true, user: { id: '7' }, tenant: { id: '3', name: 'W' } };
    optIn();
    render(<ReplayLoader siteKey="site-key-1" cdnOrigin={cdn} />);
    expect(loaderScript(cdn)).toBeNull();
    expect(replay.consent).not.toHaveBeenCalled();
    expect(replay.stop).toHaveBeenCalled();
  });

  it('records and identifies a signed-in member when allowed and the workspace is not excluded', () => {
    const cdn = nextOrigin();
    consumption.current = { plan: { effective: 'pro' }, replayExcluded: false };
    auth.current = { authReady: true, isAuthenticated: true, user: { id: '7' }, tenant: { id: '3', name: 'W' } };
    optIn();
    render(<ReplayLoader siteKey="site-key-1" cdnOrigin={cdn} recordSignedIn />);
    expect(loaderScript(cdn)).not.toBeNull();
    expect(replay.consent).toHaveBeenCalledWith(true);
    expect(replay.identify).toHaveBeenCalledWith('7', { plan: 'pro', workspace: '3' });
  });

  it('never records an excluded workspace, or one whose setting is unknown', () => {
    const excluded = nextOrigin();
    consumption.current = { plan: { effective: 'pro' }, replayExcluded: true };
    auth.current = { authReady: true, isAuthenticated: true, user: { id: '7' }, tenant: { id: '3', name: 'W' } };
    optIn();
    const first = render(<ReplayLoader siteKey="site-key-1" cdnOrigin={excluded} recordSignedIn />);
    expect(loaderScript(excluded)).toBeNull();
    first.unmount();

    const unknown = nextOrigin();
    consumption.current = { plan: { effective: 'pro' } };
    auth.current = { authReady: true, isAuthenticated: true, user: { id: '7' }, tenant: { id: '3', name: 'W' } };
    render(<ReplayLoader siteKey="site-key-1" cdnOrigin={unknown} recordSignedIn />);
    expect(loaderScript(unknown)).toBeNull();
    expect(replay.identify).not.toHaveBeenCalled();
  });

  it('waits for the session to be read before deciding a visitor is anonymous', () => {
    expect(replayLoaderMayRecord({ siteKey: 'k', consent: true, authReady: false, signedIn: false, recordSignedIn: false, workspaceExcluded: null })).toBe(false);
    expect(replayLoaderMayRecord({ siteKey: 'k', consent: true, authReady: true, signedIn: false, recordSignedIn: false, workspaceExcluded: null })).toBe(true);
    expect(replayLoaderMayRecord({ siteKey: 'k', consent: false, authReady: true, signedIn: false, recordSignedIn: true, workspaceExcluded: false })).toBe(false);
  });
});
