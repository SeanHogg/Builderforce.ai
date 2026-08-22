/**
 * @vitest-environment jsdom
 *
 * A `src/lib` test that mounts. The `lib` project runs in `node` (see
 * vitest.config.ts); a file needing a document says so itself.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRequireAuth } from './useRequireAuth';

/**
 * The property under test is the one that did not exist in the code this
 * replaced: the guard must tell "signed out" apart from "we have not read the
 * stored session yet".
 *
 * Twelve pages used to answer that with `if (!isAuthenticated) redirect`, which
 * was only ever safe because `AuthProvider` blanked the whole tree until it had
 * rehydrated — the same blanking that made every server-rendered page an empty
 * document. With the tree rendering immediately, `isAuthenticated` is false on
 * the server and on the first hydrated frame FOR EVERYONE, so that guard would
 * bounce signed-in users to the login screen on every hard load.
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

beforeEach(() => {
  auth.authReady = false;
  auth.isAuthenticated = false;
  auth.hasTenant = false;
  pathname.current = '/alerts';
  window.history.replaceState({}, '', '/alerts');
  replace.mockClear();
});

describe('useRequireAuth', () => {
  it('does not redirect while the stored session is still being read', () => {
    const { result } = renderHook(() => useRequireAuth());

    expect(replace).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });

  it('does not redirect a signed-in user whose session lands after the first frame', () => {
    const { result, rerender } = renderHook(() => useRequireAuth());
    expect(replace).not.toHaveBeenCalled();

    auth.authReady = true;
    auth.isAuthenticated = true;
    auth.hasTenant = true;
    rerender();

    expect(replace).not.toHaveBeenCalled();
    expect(result.current).toBe(true);
  });

  it('sends a genuinely signed-out visitor to sign in, carrying where they were', () => {
    auth.authReady = true;
    // An OPERATOR route. A previewable one no longer redirects at all — see the
    // case below — so the redirect has to be asserted somewhere it still
    // applies, and "your workspace's settings" is exactly such a place.
    pathname.current = '/settings/members';
    window.history.replaceState({}, '', '/settings/members');

    renderHook(() => useRequireAuth({ returnTo: '/settings/members' }));

    expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/settings/members')}`);
  });

  it('keeps the query string in the return-to, because it is part of the screen', () => {
    auth.authReady = true;
    pathname.current = '/security';
    window.history.replaceState({}, '', '/security?tab=sessions');

    renderHook(() => useRequireAuth());

    expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/security?tab=sessions')}`);
  });

  it('lets a signed-out visitor stay on a previewable route', () => {
    // The guard used to bounce them off a page that is designed to be readable
    // without an account — the shell would mount the surface and the page would
    // immediately navigate away from it. The sample workspace fills it instead,
    // and `<SessionGate>` stops the actions that genuinely need an account.
    auth.authReady = true;
    pathname.current = '/insights/delivery';
    window.history.replaceState({}, '', '/insights/delivery');

    const { result } = renderHook(() => useRequireAuth());

    expect(replace).not.toHaveBeenCalled();
    expect(result.current).toBe(true);
  });

  it('sends a signed-in visitor with no workspace to the picker', () => {
    auth.authReady = true;
    auth.isAuthenticated = true;
    // Signed IN, so the preview exemption does not apply on any route: somebody
    // with an account and no workspace needs the picker, not sample data.

    const { result } = renderHook(() => useRequireAuth({ returnTo: '/alerts' }));

    expect(replace).toHaveBeenCalledWith('/tenants?next=%2Falerts');
    expect(result.current).toBe(false);
  });

  it('lets a tenant-less page through when it does not require a workspace', () => {
    auth.authReady = true;
    auth.isAuthenticated = true;

    const { result } = renderHook(() => useRequireAuth({ requireTenant: false }));

    expect(replace).not.toHaveBeenCalled();
    expect(result.current).toBe(true);
  });
});
