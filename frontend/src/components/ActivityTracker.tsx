'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { trackActivity, flushActivity } from '@/lib/activity/tracker';

/**
 * Mounts once in the app shell for signed-in users. Auto-captures navigation
 * ("click sense") and drives the batch flush of the activity queue. Explicit
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

  // Periodic flush + flush on tab hide / unload so nothing is lost.
  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = setInterval(() => { void flushActivity(); }, 15_000);
    const onHide = () => { void flushActivity(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      void flushActivity();
    };
  }, [isAuthenticated]);

  return null;
}
