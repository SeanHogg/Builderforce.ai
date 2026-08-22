'use client';

/**
 * Record where a logged-out visitor goes — mounted once, renders nothing.
 *
 * The counterpart to `QualityErrorReporter` (which records what BREAKS) and
 * `guestPromptCapture` (what they ASKED FOR). This is the third of the three and
 * was the missing one: a visitor typed a prompt on the landing page and the
 * platform's next record of them was a signup, if it ever came. Everything
 * between — where they went, how long they stayed, whether they came back — was
 * measured only inside the persona demo.
 *
 * Signed-in sessions are NOT tracked here. Their activity is already the
 * `activity_log`'s job, and recording it twice would double-count every
 * navigation an employee makes while double-writing an anonymous stream that
 * exists to measure people who have no account. It decides that itself rather
 * than being told: a shared component owns its own visibility.
 *
 * Everything it sends is best-effort and batched, so a visitor never pays for
 * being measured.
 */

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import {
  VISITOR_JOURNEY_KINDS,
  flushVisitorEvents,
  isReturningVisitor,
  queueVisitorEvent,
  trackVisitorEvent,
  visitCount,
} from '@/lib/visitorJourney';

export function VisitorJourneyTracker() {
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();
  const visitOpenedAt = useRef<number | null>(null);
  const lastPath = useRef<string | null>(null);

  // Open the visit once, on the first anonymous render. `visit_start` carries
  // whether this is a comeback, because "returning" is the one fact the browser
  // knows and the server cannot derive without it: a visitor who cleared their
  // storage is indistinguishable from a new one, and guessing would quietly
  // inflate the number the funnel is judged on.
  useEffect(() => {
    if (isAuthenticated) return;
    if (visitOpenedAt.current !== null) return;
    visitOpenedAt.current = Date.now();
    queueVisitorEvent({
      kind: VISITOR_JOURNEY_KINDS.visitStart,
      path: window.location.pathname,
      metadata: {
        returning: isReturningVisitor(),
        visitNumber: visitCount(),
        referrer: document.referrer || null,
      },
    });
  }, [isAuthenticated]);

  // One page view per DISTINCT path. Next re-runs this effect on any navigation,
  // including a query-string change that leaves the visitor on the same screen —
  // counting those would report a filter click as a page in the funnel.
  useEffect(() => {
    if (isAuthenticated || !pathname) return;
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    queueVisitorEvent({ kind: VISITOR_JOURNEY_KINDS.pageView, path: pathname });
  }, [pathname, isAuthenticated]);

  // The visit ending is the whole point of "when did they leave", and it is the
  // one event with no second chance: `pagehide` is the last moment the tab can
  // send anything, and `visibilitychange` covers the mobile case where a tab is
  // backgrounded and never fires `pagehide` at all.
  useEffect(() => {
    if (isAuthenticated) return;

    const closeVisit = () => {
      const openedAt = visitOpenedAt.current;
      trackVisitorEvent({
        kind: VISITOR_JOURNEY_KINDS.visitEnd,
        path: window.location.pathname,
        metadata: { durationMs: openedAt === null ? null : Date.now() - openedAt },
      });
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') closeVisit(); };

    window.addEventListener('pagehide', closeVisit);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', closeVisit);
      document.removeEventListener('visibilitychange', onVisibility);
      flushVisitorEvents();
    };
  }, [isAuthenticated]);

  return null;
}
