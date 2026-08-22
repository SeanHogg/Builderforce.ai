'use client';

/**
 * "Is this screen looking at the sample workspace?" — asked once, answered here.
 *
 * Every surface that shows sample data has to say so, and every gate that a
 * guest hits has to know it is a guest. Both are the SAME question, and it has
 * exactly one correct answer: a visitor is on the sample workspace when they
 * have no readable workspace of their own. Deriving that per component is how
 * two surfaces end up disagreeing about whether the numbers on screen are real.
 *
 * `signedIn` was already being spelled out as `isAuthenticated && hasTenant` in
 * more than one module. That expression now lives here, once, and its negation
 * is the sample-workspace condition — so the banner cannot appear over real rows
 * and cannot fail to appear over fixtures.
 *
 * ── WHY IT WAITS FOR `authReady` ─────────────────────────────────────────────
 * The session is read off the device, so `isAuthenticated` is false on the
 * server render and the first hydrated frame FOR EVERYONE. Reporting "sample"
 * during that frame would flash a "this is not your data" banner at a signed-in
 * person on every hard load. Until the session has been read the honest answer
 * is "not yet", and both consumers render nothing.
 *
 * ── WHY `isSample` IS NOT SIMPLY `!signedIn` ─────────────────────────────────
 * Two different questions were briefly one field here, and the conflation was a
 * lie on the surface that matters most.
 *
 *   `signedIn` — is there a readable WORKSPACE behind this screen? That is what
 *                a gate asks: `<SessionGate>` walls an action because it needs
 *                an account, on every route, including the canvas.
 *   `isSample` — is the DATA on this screen the sample workspace? That is what
 *                the notice asks, and it is a strictly narrower question.
 *
 * A guest on `/create/local-…` is signed out, so `!signedIn` is true — but the
 * board in front of them is a real, local-first canvas holding their OWN work.
 * Labelling it "sample data, the numbers are invented" would be false, about
 * the one thing on the screen they actually made. The CANVAS surfaces are
 * therefore excluded from `isSample` and NOT from `signedIn`: hiring an agent
 * from a guest board still asks for an account, and the board is still theirs.
 *
 * Every stage route is excluded, not just the local-first ones, and for the same
 * reason twice over. A durable `/create/<sessionId>` a guest cannot read shows
 * them NOTHING, not sample data — the honest report there is silence, and the
 * page says what it needs itself. And the stage owns the full height of the
 * shell, so a bar above it would be a claim AND a layout bug.
 */

import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { isLocalFirstAppRoute } from '@/lib/shellRouting';
import { isStageRoute } from '@/lib/workbenchPolicy';

export interface SampleWorkspaceState {
  /** The session has been read off the device; the two flags below are usable. */
  ready: boolean;
  /** There is a real, readable workspace behind this screen. */
  signedIn: boolean;
  /**
   * This screen's DATA is the sample workspace, not the visitor's own. Narrower
   * than `!signedIn` — see the note above; a local-first canvas is a guest's
   * real work and must never be labelled as invented.
   */
  isSample: boolean;
}

/** The canvas surfaces, where the visitor's own board is the subject and the
 *  sample workspace supplies nothing. */
function isCanvasSurface(pathname: string): boolean {
  return isStageRoute(pathname) || isLocalFirstAppRoute(pathname);
}

export function useSampleWorkspace(): SampleWorkspaceState {
  const { authReady, isAuthenticated, hasTenant } = useAuth();
  const pathname = usePathname() || '';
  const signedIn = isAuthenticated && hasTenant;
  return {
    ready: authReady,
    signedIn,
    isSample: authReady && !signedIn && !isCanvasSurface(pathname),
  };
}
