'use client';

/**
 * THE ONE QUESTION THE TRANSPORT ASKS: may this read be served from the sample
 * workspace, and if so, what does it answer?
 *
 * ── WHY IT IS ONE FUNCTION AT ONE SEAM ───────────────────────────────────────
 * `apiClient.sendRequest` is the single point every typed client in the frontend
 * funnels through — that is already load-bearing, and it is why adding a header
 * there reaches 236 modules. The same property makes it the only honest place to
 * put this: a guest opening `/insights/delivery` populates because the TRANSPORT
 * knows how to answer, not because somebody remembered to add a `signedIn ?
 * fixture : real` branch to that lens. Every surface, present and future, gets
 * the sample workspace with zero per-surface edits — and no surface can forget.
 *
 * ── THE FOUR CONDITIONS, AND WHY EACH IS NECESSARY ───────────────────────────
 *  1. NO CREDENTIAL WAS SENT. Not "the user looks signed out" — the actual
 *     absence of an Authorization header, which is the same fact
 *     `isAnonymousUnauthorized` already draws its line on. A signed-in person
 *     can never be served a fixture, whatever any React state briefly believes.
 *  2. IT IS A READ. GET only. A guest's WRITE must not be quietly swallowed and
 *     reported as success — that is the failure that makes a person think their
 *     work is saved. Writes fall through and are stopped by `<SessionGate>` at
 *     the control, or by the server.
 *  3. A FIXTURE EXISTS. Uncovered reads fall through to the network and the
 *     surface renders its own empty state.
 *  4. THE BROWSER IS THE CALLER. Never on the server: a server-rendered fixture
 *     would be cached and served to signed-in visitors by any layer above us.
 */

import { resolveGuestFixture, runGuestFixture } from '../infrastructure/guestFixtureRegistry';

/** What a guest read produced, or `null` when the request must go to the wire. */
export interface GuestReadResult {
  /** The JSON body the fixture answers with. */
  body: unknown;
  /** The fixture that answered — surfaced on the response so `useIsSampleData`
   *  can tell a labelled surface from an unlabelled one without guessing. */
  fixtureId: string;
}

/** Header stamped on every synthesised response, so any layer downstream can
 *  recognise sample data without re-deriving the four conditions above. */
export const SAMPLE_DATA_HEADER = 'x-builderforce-sample';

export interface GuestReadRequest {
  /** Path including the query string, exactly as the caller wrote it. */
  path: string;
  method: string;
  /** Whether an Authorization header was actually attached. */
  hadToken: boolean;
}

export function resolveGuestRead({ path, method, hadToken }: GuestReadRequest): GuestReadResult | null {
  if (typeof window === 'undefined') return null;
  if (hadToken) return null;
  if ((method || 'GET').toUpperCase() !== 'GET') return null;

  const [pathname, search = ''] = path.split('?');
  const fixture = resolveGuestFixture(pathname);
  if (!fixture) return null;

  return {
    body: runGuestFixture(fixture, {
      path,
      query: new URLSearchParams(search),
      now: Date.now(),
    }),
    fixtureId: fixture.id,
  };
}

/**
 * The synthesised `Response`, so the three transports need no new branch: they
 * already know how to read a 200 with a JSON body, and this is one.
 */
export function guestReadResponse(result: GuestReadResult): Response {
  return new Response(JSON.stringify(result.body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      [SAMPLE_DATA_HEADER]: result.fixtureId,
    },
  });
}
