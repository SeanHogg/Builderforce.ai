'use client';

/**
 * `<RequireAuth>` — the auth guard as a BOUNDARY rather than as three lines
 * copied into every page.
 *
 * `useRequireAuth()` is the rule (redirect signed-out visitors, wait for the
 * session to rehydrate); this is the rule applied in the one shape six surfaces
 * were writing by hand:
 *
 *     const allowed = useRequireAuth();
 *     if (!allowed) return null;
 *     return <TheActualPage />;
 *
 * Written that way the guard is what makes the PAGE a client component, which
 * drags the page's whole import subtree into the client bundle for a decision
 * that has nothing to do with the page's content. As a component the guard is a
 * client LEAF: the page above it stays a server component and only this file —
 * plus whatever is genuinely interactive below — ships.
 *
 * ```tsx
 * // app/alerts/page.tsx — a server component
 * export default function AlertsPage() {
 *   return <RequireAuth><AlertsClient /></RequireAuth>;
 * }
 * ```
 *
 * Reach for the HOOK instead when the page needs the boolean for something
 * besides rendering children (`/admin` also checks superadmin, `/dashboard`
 * sequences a fetch behind it). Those are not this shape and should not be bent
 * into it.
 */
import type { ReactNode } from 'react';
import { useRequireAuth } from '@/lib/useRequireAuth';

export function RequireAuth({
  children,
  returnTo,
  requireTenant,
  fallback = null,
}: {
  children: ReactNode;
  /** Where to return after signing in. Defaults to the current path. */
  returnTo?: string;
  /** Also require a selected workspace. Default true — most app pages are tenant-scoped. */
  requireTenant?: boolean;
  /** Rendered while the session is being read or a redirect is in flight. */
  fallback?: ReactNode;
}) {
  const allowed = useRequireAuth({ returnTo, requireTenant });
  return <>{allowed ? children : fallback}</>;
}
