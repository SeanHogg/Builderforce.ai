'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { signInHref } from '@/lib/auth';
import { isGuestPreviewRoute } from '@/lib/shellRouting';

/**
 * The ONE auth guard for a page that requires a signed-in visitor.
 *
 * Twelve surfaces had hand-rolled the same three lines — redirect to `/login`
 * when signed out, to `/tenants` when there is no workspace, render null in the
 * meantime — and every one of them was subtly wrong in the same way: the session
 * lives in localStorage, so `isAuthenticated` is `false` on the server render and
 * on the first hydrated frame FOR EVERYONE. While `AuthProvider` blanked the tree
 * until it had rehydrated, nothing noticed; now that it renders children
 * immediately (so the public pages actually server-render), acting on that first
 * frame would bounce signed-in users to the login screen.
 *
 * `authReady` is the whole point of this hook, and the reason it is a hook rather
 * than a copied `useEffect`: the rule belongs in one place, so it cannot be
 * half-applied.
 *
 * @returns whether the page may render its authenticated content. Render `null`
 *          while it is false — the redirect is already in flight, or the session
 *          is still being read off the device.
 */
export function useRequireAuth(options: {
  /** Where to return after signing in. Defaults to the current path. */
  returnTo?: string;
  /** Also require a selected workspace. Default true — most app pages are tenant-scoped. */
  requireTenant?: boolean;
} = {}): boolean {
  const { returnTo, requireTenant = true } = options;
  const router = useRouter();
  const pathname = usePathname() || '';
  const { authReady, isAuthenticated, hasTenant } = useAuth();

  useEffect(() => {
    if (!authReady) return;
    // A previewable route renders for everybody now — the sample workspace fills
    // it and `<SessionGate>` stops the actions that need an account. Bouncing a
    // guest to the login screen from a page that is designed to be readable
    // without one is the same substitution this whole change removes, one layer
    // down: the shell would mount the surface and the page would immediately
    // navigate away from it.
    if (!isAuthenticated && isGuestPreviewRoute(pathname)) return;
    // The query string is part of where the visitor was: `/quality?tab=feedback`
    // and `/quality` are different screens, and sending them back to the second
    // after signing in loses the one they asked for. Read from `window` rather
    // than `useSearchParams()` — that hook opts every page using this guard into
    // a CSR bailout at build time, which is the trade `ProductUpdatesHost` and
    // the shell's own `useGuestInviteCode` already refuse for the same reason.
    // Safe here because it only runs inside an effect, after `authReady`.
    const target = returnTo ?? `${pathname}${window.location.search}`;
    if (!isAuthenticated) {
      router.replace(signInHref(target));
      return;
    }
    if (requireTenant && !hasTenant) {
      router.replace(target ? `/tenants?next=${encodeURIComponent(target)}` : '/tenants');
    }
  }, [authReady, isAuthenticated, hasTenant, requireTenant, returnTo, router, pathname]);

  // Same rule as the effect, so the boolean and the redirect can never
  // disagree — a page that is told it may render must not also be navigating.
  if (authReady && !isAuthenticated && isGuestPreviewRoute(pathname)) return true;
  return authReady && isAuthenticated && (!requireTenant || hasTenant);
}
