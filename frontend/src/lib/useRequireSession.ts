import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { signInHref } from '@/lib/auth';
import { isGuestPreviewRoute } from '@/lib/shellRouting';

/*
 * No `'use client'`, deliberately. A hook module marks no boundary: a hook runs inside
 * whichever component calls it, and every caller of this one is already a client page
 * (it navigates, so it has to be). The directive declared nothing the hook needs — it
 * only turned `readSessionStatus`/`hasSession`/`mayRender`, which are pure, into client
 * references a server surface could not call. The `lib/useRoleText.ts` convention.
 */

/**
 * Where a page stands with respect to the session.
 *
 *   - `loading`   — the stored session has not been read off the device yet, OR
 *                   this hook is navigating away (sign-in / workspace picker).
 *                   Either way the page renders nothing of its own.
 *   - `anonymous` — nobody is signed in and the page may render for a guest.
 *   - `no-tenant` — signed in, no workspace selected, and the page allowed that.
 *   - `ready`     — signed in with a workspace.
 */
export type SessionStatus = 'loading' | 'anonymous' | 'no-tenant' | 'ready';

/** The pure reading of the three auth facts — no navigation. */
export function readSessionStatus(auth: { authReady: boolean; isAuthenticated: boolean; hasTenant: boolean }): SessionStatus {
  if (!auth.authReady) return 'loading';
  if (!auth.isAuthenticated) return 'anonymous';
  return auth.hasTenant ? 'ready' : 'no-tenant';
}

/** Somebody is signed in — with or without a workspace. */
export function hasSession(status: SessionStatus): boolean {
  return status === 'ready' || status === 'no-tenant';
}

/**
 * The page may render its own content. Every status but `loading` qualifies, because
 * the gate already navigated away from each one the page does not accept: an
 * `anonymous` page is a previewable one, a `no-tenant` page asked for no workspace.
 */
export function mayRender(status: SessionStatus): boolean {
  return status !== 'loading';
}

export interface RequireSessionOptions {
  /** Where to return after signing in / picking a workspace. Defaults to the current path + query. */
  returnTo?: string;
  /** Send a signed-in person with no workspace to the picker. Default true — most app pages are tenant-scoped. */
  requireTenant?: boolean;
  /**
   * Navigate at all. Default true. `false` makes this a pure reading, for a page
   * that renders something for every state itself — a guest canvas, a local
   * draft, a "needs a workspace" note — and must never be navigated away from.
   */
  redirect?: boolean;
}

/**
 * THE route-level session gate.
 *
 * Pages used to restate this about five ways — `if (!isAuthenticated) return
 * null`, a render-time `router.replace('/tenants')`, a 1.2 s grace timer "while
 * auth settles", `hasTenant` read before the session was rehydrated — and only
 * one of them waited for `authReady`. The session lives in localStorage, so
 * `isAuthenticated` is `false` on the server render and on the first hydrated
 * frame FOR EVERYONE; every copy that acted on that frame flashed a signed-out
 * state at, or navigated away from, a signed-in person.
 *
 * Guests may VIEW; the session gates ACTIONS (`<SessionGate>`). So a signed-out
 * visitor on a guest-previewable route is `anonymous` and stays — the sample
 * workspace fills the page — and only a route that is not previewable sends them
 * to sign in. A signed-in person with no workspace goes to the picker unless the
 * page says it does not need one.
 */
export function useRequireSession(options: RequireSessionOptions = {}): SessionStatus {
  const { returnTo, requireTenant = true, redirect = true } = options;
  const router = useRouter();
  const pathname = usePathname() || '';
  const { authReady, isAuthenticated, hasTenant } = useAuth();
  const status = readSessionStatus({ authReady, isAuthenticated, hasTenant });

  const leaving = redirect && (
    (status === 'anonymous' && !isGuestPreviewRoute(pathname))
    || (status === 'no-tenant' && requireTenant)
  );

  useEffect(() => {
    if (!leaving) return;
    // The query string is part of where the visitor was (`/quality?tab=feedback`).
    // Read from `window` rather than `useSearchParams()`, which would opt every
    // page using this gate into a CSR bailout at build time. Safe: effect-only.
    const target = returnTo ?? `${pathname}${window.location.search}`;
    if (status === 'anonymous') router.replace(signInHref(target));
    else router.replace(target ? `/tenants?next=${encodeURIComponent(target)}` : '/tenants');
  }, [leaving, status, returnTo, router, pathname]);

  // The reading and the navigation come from the same `leaving`, so a page is
  // never told it may render while it is also being navigated away from.
  return leaving ? 'loading' : status;
}
