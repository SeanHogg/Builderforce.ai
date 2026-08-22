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
 */

import { useAuth } from '@/lib/AuthContext';

export interface SampleWorkspaceState {
  /** The session has been read off the device; the two flags below are usable. */
  ready: boolean;
  /** There is a real, readable workspace behind this screen. */
  signedIn: boolean;
  /** This screen is looking at the sample workspace, not the visitor's own. */
  isSample: boolean;
}

export function useSampleWorkspace(): SampleWorkspaceState {
  const { authReady, isAuthenticated, hasTenant } = useAuth();
  const signedIn = isAuthenticated && hasTenant;
  return { ready: authReady, signedIn, isSample: authReady && !signedIn };
}
