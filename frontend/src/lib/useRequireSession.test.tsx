/**
 * @vitest-environment jsdom
 *
 * A `src/lib` test that mounts. The `lib` project runs in `node` (see
 * vitest.config.ts); a file needing a document says so itself.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasSession, mayRender, readSessionStatus, useRequireSession } from './useRequireSession';

/**
 * The property under test is the one that did not exist in the code this
 * replaced: the gate must tell "signed out" apart from "we have not read the
 * stored session yet".
 *
 * Pages used to answer that with `if (!isAuthenticated) redirect`, which was only
 * ever safe because `AuthProvider` blanked the whole tree until it had rehydrated
 * — the same blanking that made every server-rendered page an empty document.
 * With the tree rendering immediately, `isAuthenticated` is false on the server
 * and on the first hydrated frame FOR EVERYONE, so that guard would bounce
 * signed-in users to the login screen on every hard load.
 */
const auth = { authReady: false, isAuthenticated: false, hasTenant: false };

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => auth }));

// `vi.mock` factories are hoisted above the module body, so the spy they close
// over has to be hoisted with them.
const { replace, pathname } = vi.hoisted(() => ({ replace: vi.fn(), pathname: { current: '/alerts' } }));

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => pathname.current,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

function at(path: string, search = '') {
  pathname.current = path;
  window.history.replaceState({}, '', `${path}${search}`);
}

beforeEach(() => {
  auth.authReady = false;
  auth.isAuthenticated = false;
  auth.hasTenant = false;
  at('/alerts');
  replace.mockClear();
});

describe('useRequireSession', () => {
  it('does not redirect while the stored session is still being read', () => {
    const { result } = renderHook(() => useRequireSession());

    expect(replace).not.toHaveBeenCalled();
    expect(result.current).toBe('loading');
  });

  it('does not redirect a signed-in user whose session lands after the first frame', () => {
    const { result, rerender } = renderHook(() => useRequireSession());
    expect(replace).not.toHaveBeenCalled();

    auth.authReady = true;
    auth.isAuthenticated = true;
    auth.hasTenant = true;
    rerender();

    expect(replace).not.toHaveBeenCalled();
    expect(result.current).toBe('ready');
  });

  it('sends a genuinely signed-out visitor to sign in, carrying where they were', () => {
    auth.authReady = true;
    // An OPERATOR route. A previewable one does not redirect at all — see the
    // case below — so the redirect is asserted somewhere it still applies.
    at('/settings/members');

    const { result } = renderHook(() => useRequireSession({ returnTo: '/settings/members' }));

    expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/settings/members')}`);
    // Told to render nothing while it is being navigated away from.
    expect(result.current).toBe('loading');
  });

  it('keeps the query string in the return-to, because it is part of the screen', () => {
    auth.authReady = true;
    at('/security', '?tab=sessions');

    renderHook(() => useRequireSession());

    expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/security?tab=sessions')}`);
  });

  it('lets a signed-out visitor stay on a previewable route', () => {
    // The sample workspace fills a previewable page and `<SessionGate>` stops the
    // actions that genuinely need an account — bouncing the visitor would undo that.
    auth.authReady = true;
    at('/insights/delivery');

    const { result } = renderHook(() => useRequireSession());

    expect(replace).not.toHaveBeenCalled();
    expect(result.current).toBe('anonymous');
  });

  it('sends a signed-in visitor with no workspace to the picker', () => {
    auth.authReady = true;
    auth.isAuthenticated = true;
    // Signed IN, so the preview exemption does not apply on any route: somebody
    // with an account and no workspace needs the picker, not sample data.

    const { result } = renderHook(() => useRequireSession({ returnTo: '/alerts' }));

    expect(replace).toHaveBeenCalledWith('/tenants?next=%2Falerts');
    expect(result.current).toBe('loading');
  });

  it('lets a tenant-less page through when it does not require a workspace', () => {
    auth.authReady = true;
    auth.isAuthenticated = true;

    const { result } = renderHook(() => useRequireSession({ requireTenant: false }));

    expect(replace).not.toHaveBeenCalled();
    expect(result.current).toBe('no-tenant');
  });

  it('never navigates when told not to, and reports the state instead', () => {
    auth.authReady = true;
    at('/settings/members');

    const { result } = renderHook(() => useRequireSession({ redirect: false }));

    expect(replace).not.toHaveBeenCalled();
    expect(result.current).toBe('anonymous');
  });
});

describe('the pure readings', () => {
  it('reads the three auth facts without navigating', () => {
    expect(readSessionStatus({ authReady: false, isAuthenticated: true, hasTenant: true })).toBe('loading');
    expect(readSessionStatus({ authReady: true, isAuthenticated: false, hasTenant: false })).toBe('anonymous');
    expect(readSessionStatus({ authReady: true, isAuthenticated: true, hasTenant: false })).toBe('no-tenant');
    expect(readSessionStatus({ authReady: true, isAuthenticated: true, hasTenant: true })).toBe('ready');
  });

  it('separates "may render" from "somebody is signed in"', () => {
    expect(mayRender('loading')).toBe(false);
    expect(mayRender('anonymous')).toBe(true);
    expect(hasSession('anonymous')).toBe(false);
    expect(hasSession('no-tenant')).toBe(true);
    expect(hasSession('ready')).toBe(true);
  });
});
