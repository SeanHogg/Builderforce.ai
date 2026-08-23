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
 * It restores a GUEST's last local board too, which is what makes a reference
 * page arrive as a panel for someone who has no account. See the first effect.
 *
 * SOMEONE WHO HAS NEVER OPENED A CANVAS gets one STARTED, locally, but only on
 * a route that opens as a panel — see {@link mayStartFreshBoard}. That is a
 * deliberate reversal of what this file used to do, and the reason is that
 * `panelOpen` stopped asking whether a board exists: a destination cannot be a
 * drawer for people with a canvas and a full-bleed page for everyone else and
 * still be one destination. The cost is bounded by the same gate — a public
 * page, a crawler, `/blog`, the storefront and every route that was never going
 * to be a panel are untouched, and the dashboard is still the dashboard.
 *
 * The redirect fires at most ONCE per tab (a session flag), so clicking
 * Dashboard afterwards genuinely opens the dashboard. A rule that bounced every
 * visit would not be "land on your board", it would be "you may not have a
 * dashboard".
 */

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useOptionalActiveCanvas, type ActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { createLocalCreationSession, listLocalCreationSessions } from '@/domains/canvas/infrastructure/localCanvasStore';
import { fetchRecentCanvases, readLastCanvas } from '@/lib/pendingWork';
import { rendersAppShell } from '@/lib/shellRouting';
import { panelOpen } from '@/lib/workbenchPolicy';

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

/**
 * Put a board on the stage for someone who has none — the other half of "a
 * workbench destination is always a panel".
 *
 * `panelOpen` no longer asks whether there is a canvas to keep, because a
 * destination that renders as a drawer sometimes and a full-bleed page the rest
 * of the time is one destination pretending to be two. That only holds up if
 * something guarantees a stage under the drawer, and for a first-time visitor —
 * or an account whose library is genuinely empty — restoring cannot: there is
 * nothing to restore. So one is STARTED, local-first: no account, no server row,
 * no network, the same `Untitled session · Saved on this device` board the front
 * door opens, and ✕ has somewhere to close to.
 *
 * Local even for a signed-in person, deliberately. Creating a server canvas as a
 * side effect of opening Settings would file a row in their library that they
 * never asked for and would have to delete; a local board costs them nothing and
 * becomes real the moment they take an account — the header CTA turns into "Keep
 * your work" as soon as this browser holds one, and that is the only place the
 * offer is made.
 *
 * The gate is `rendersAppShell`, and that is the part that protects the public
 * surface. A signed-OUT visitor on a reference page (`/product-management`,
 * `/soc2`) is on a route whose whole job is to render as an ordinary indexable
 * page for them — so it is not an app-shell route, nothing is started, and the
 * crawler sees exactly what it saw before. Signed in, the same route IS an
 * app-shell route and opens over a board, which is §11.4.5's two answers from
 * one component.
 */
function mayStartFreshBoard(pathname: string, isAuthenticated: boolean): boolean {
  return panelOpen(pathname) && rendersAppShell(pathname, isAuthenticated);
}

/**
 * A board arriving on the stage with nothing else asked of it.
 *
 * The ten-field literal was written out at each call site, which is three
 * chances for one of them to open a board with `present: true` or a stale
 * `buildOpen` — the fields exist for a DEEP LINK (`?present=1`, `?focus=`,
 * a build ticket) and a restore is the case where every one of them is off.
 */
function boardOnStage(sessionId: string, persistence: 'local' | 'server'): ActiveCanvas {
  return {
    sessionId,
    persistence,
    focusId: null,
    shareOpen: false,
    buildOpen: false,
    buildChatId: null,
    buildTicket: null,
    prompt: null,
    present: false,
    modelComparisonIds: [],
  };
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

  /**
   * The guest half — and the reason `/integrations` looked nothing like the
   * mockup.
   *
   * A reference page is meant to arrive as a PANEL over the board (§11.4.5),
   * and `rendersOperatorShell` will give a signed-out visitor that shell — but
   * only if the shell is holding a board, and nothing put one there. So a guest
   * who had been building on a local canvas, then opened Integrations, got the
   * full-page marketing render with no board behind it: the panel had nothing
   * to be a panel over, exactly as §6.7 describes for a cold `/settings`.
   *
   * Their last board is a LOCAL session (no account, no server row), restored
   * only on a route that would open a panel — so `/blog` stays a page, and the
   * gate is `panelOpen` rather than `stageHosted`, which cannot be true yet
   * precisely because there is no board.
   *
   * A first-time visitor has no local board to restore, so what happens next
   * splits on `mayStartFreshBoard` and the split is the one that protects the
   * public surface. On a guest-PREVIEW app route (`/incidents`, `/insights`)
   * one is started, because that route was always going to render the operator
   * shell and a panel there needs a stage. On a public REFERENCE page it is
   * not, so the crawler and the first-time reader still get the ordinary
   * indexable page exactly as before.
   */
  useEffect(() => {
    if (isAuthenticated || hasBoard || !open) return;
    if (!panelOpen(pathname)) return;
    if (ran.current) return;
    ran.current = true;

    // Their own board first; a fresh local one only where starting one is
    // allowed (see `mayStartFreshBoard` — never on a public reference page).
    const sessionId = listLocalCreationSessions()[0]?.sessionId
      ?? (mayStartFreshBoard(pathname, false) ? createLocalCreationSession('') : null);
    if (!sessionId) return;
    open(boardOnStage(sessionId, 'local'));
  }, [hasBoard, isAuthenticated, open, pathname]);

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
      if (sessionId) {
        // Landing on the dashboard right after sign-in is the case §6.8 names.
        // Anywhere else, the board goes on the stage and the route stays put —
        // which is what turns `/settings` into "your board, plus a panel".
        if (pathname === LANDING && !alreadyResumed()) {
          markResumed();
          router.replace(`/create/${sessionId}`);
          return;
        }
        open(boardOnStage(sessionId, 'server'));
        return;
      }

      // An account with nothing in its library yet. There is no board to LAND
      // them on, so §6.8's redirect stays off — a person with no work to return
      // to has not "returned" anywhere, and bouncing them to a canvas they
      // never made would be a worse answer than the route they asked for. A
      // panel destination still needs a stage beneath it though, so one is
      // started locally and the route opens over it, exactly as it does for
      // someone whose board was restored.
      if (!mayStartFreshBoard(pathname, true)) return;
      open(boardOnStage(createLocalCreationSession(''), 'local'));
    })();
  }, [hasBoard, hasTenant, isAuthenticated, open, pathname, router, stageHosted]);

  return null;
}

export default LastBoardBridge;
