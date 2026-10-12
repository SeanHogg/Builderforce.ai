import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { trackActivity, flushActivity } from '@/lib/activity/tracker';

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

  return null;
}
