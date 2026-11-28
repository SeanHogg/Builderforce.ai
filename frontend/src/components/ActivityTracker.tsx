import { Suspense, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { trackActivity, flushActivity } from '@/lib/activity/tracker';
import { isLegacyCreationRoute, LEGACY_CREATION_ROUTE_PARAM } from '@/lib/canvas/legacyCreationRoute';

function LegacyCreationRouteActivity() {
  const { authReady, isAuthenticated } = useAuth();
  const source = useSearchParams().get(LEGACY_CREATION_ROUTE_PARAM);

  useEffect(() => {
    if (!authReady || !isLegacyCreationRoute(source)) return;
    const url = new URL(window.location.href);
    // Recheck the live URL because effects can rerun or navigation can move on.
    if (url.searchParams.get(LEGACY_CREATION_ROUTE_PARAM) !== source) return;
    url.searchParams.delete(LEGACY_CREATION_ROUTE_PARAM);
    window.history.replaceState(null, '', url);
    if (isAuthenticated) trackActivity('creation_legacy_route_adapted', { ref: source });
  }, [authReady, isAuthenticated, source]);

  return null;
}

/**
 * Mounts once in the app shell for signed-in users. Auto-captures navigation
 * ("click sense") and flushes the activity queue when the page is hidden. Explicit
 * signals (ticket lane moves, tool executions, agent messages, …) are emitted
 * by feature code via `trackActivity(...)`; this component owns the transport.
 * Renders nothing.
 */
export default function ActivityTracker() {
  const { isAuthenticated } = useAuth();
  const pathname = usePathname() || '';
  const lastPath = useRef<string | null>(null);

  // Navigation signal on every route change.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    trackActivity('nav', { ref: pathname });
  }, [isAuthenticated, pathname]);

  // The outbox batches on its own clock; flush on tab hide / unload so nothing is lost.
  useEffect(() => {
    if (!isAuthenticated) return;
    const onHide = () => { void flushActivity({ final: true }); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      void flushActivity();
    };
  }, [isAuthenticated]);

  return pathname === '/create' || pathname.startsWith('/create/')
    ? <Suspense fallback={null}><LegacyCreationRouteActivity /></Suspense>
    : null;
}
