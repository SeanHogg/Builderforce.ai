'use client';

/**
 * "After sign-in a person lands on the board they last worked on and never
 * leaves it." (PRD 21 §0)
 *
 * Two acceptance criteria are the same missing mechanism, which is why one
 * bridge closes both:
 *
 *   §6.7 — `/settings` (and every other legacy destination URL) resolves to a
 *          board plus an open panel. Route-wise that already works: a workbench
 *          route opens as a panel WHEN a board is on the stage. What was missing
 *          is that arriving cold at `/settings` put no board on the stage, so the
 *          panel had nothing to be a panel over.
 *   §6.8 — Sign-in lands on the last board, not a dashboard.
 *
 * So: restore the last board onto the stage on any authenticated app route, and
 * — once per browser tab — send the post-auth dashboard arrival to that board.
 *
 * IT COSTS NOTHING FOR SOMEONE WHO HAS NEVER OPENED A CANVAS. No remembered
 * board, no recent session, nothing restored, no redirect: the dashboard is
 * still the dashboard. This is deliberately the same "free unless you use it"
 * property the stage itself has — the alternative, mounting an empty board for
 * every visitor, would make the whole shell heavier to satisfy a rule about
 * people who have work to return to.
 *
 * The redirect fires at most ONCE per tab (a session flag), so clicking
 * Dashboard afterwards genuinely opens the dashboard. A rule that bounced every
 * visit would not be "land on your board", it would be "you may not have a
 * dashboard".
 */

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { fetchRecentCanvases, readLastCanvas } from '@/lib/pendingWork';

/** One redirect per tab. Not localStorage: "you just signed in" is a per-tab fact. */
const RESUMED_FLAG = 'builderforce:create:resumed';

/** The post-auth landing route every sign-in path defaults to. */
const LANDING = '/dashboard';

function alreadyResumed(): boolean {
  try {
    return sessionStorage.getItem(RESUMED_FLAG) === '1';
  } catch {
    // Storage unavailable — treat it as "already done" so a private-mode tab
    // never redirects on every render.
    return true;
  }
}

function markResumed(): void {
  try { sessionStorage.setItem(RESUMED_FLAG, '1'); } catch { /* nothing to keep */ }
}

export function LastBoardBridge() {
  const router = useRouter();
  const pathname = usePathname() || '';
  const { isAuthenticated, hasTenant } = useAuth();
  const canvas = useOptionalActiveCanvas();
  const ran = useRef(false);

  const stageHosted = canvas?.stageHosted ?? false;
  const hasBoard = canvas?.active != null;
  const open = canvas?.open;

  useEffect(() => {
    if (!isAuthenticated || !hasTenant || !stageHosted || hasBoard || !open) return;
    if (ran.current) return;
    ran.current = true;

    void (async () => {
      // The remembered pointer first — it is what the person actually had open.
      // Falling back to the newest session covers a new browser, and both reads
      // are already shared/read-through, so this is not an extra request.
      const remembered = readLastCanvas();
      const sessionId = remembered?.sessionId ?? (await fetchRecentCanvases())[0]?.id;
      if (!sessionId) return;

      // Landing on the dashboard right after sign-in is the case §6.8 names.
      // Anywhere else, the board goes on the stage and the route stays put —
      // which is what turns `/settings` into "your board, plus a panel".
      if (pathname === LANDING && !alreadyResumed()) {
        markResumed();
        router.replace(`/create/${sessionId}`);
        return;
      }

      open({
        sessionId,
        persistence: 'server',
        focusId: null,
        shareOpen: false,
        present: false,
        modelComparisonIds: [],
      });
    })();
  }, [hasBoard, hasTenant, isAuthenticated, open, pathname, router, stageHosted]);

  return null;
}

export default LastBoardBridge;
