/**
 * THE REGISTRY — every read the sample workspace can answer, in one table.
 *
 * Composition, not a switch: a new surface arrives as an ENTRY in a fixture
 * module, and this file only says which modules exist. That is the property that
 * matters as coverage grows — the resolver never gains a branch, so it never
 * becomes the file everyone edits.
 *
 * Resolution is FIRST MATCH WINS over the concatenated list, and the order of
 * modules below is therefore meaningful: a later module cannot silently shadow
 * an earlier one, and an intentional override has to be argued for by moving the
 * module rather than by appending. Ids are unique — asserted in the tests — so a
 * duplicate is a failure rather than a coin toss.
 */

import type { GuestFixture, GuestFixtureContext } from '../domain/guestFixture';
import { deliveryFixtures } from './fixtures/deliveryFixtures';
import { insightsFixtures } from './fixtures/insightsFixtures';
import { dashboardFixtures } from './fixtures/dashboardFixtures';
import { reliabilityFixtures } from './fixtures/reliabilityFixtures';
import { financeFixtures } from './fixtures/financeFixtures';

const FIXTURES: GuestFixture[] = [
  ...deliveryFixtures,
  ...insightsFixtures,
  ...dashboardFixtures,
  ...reliabilityFixtures,
  ...financeFixtures,
];

/** Exported for the ratchet that asserts ids are unique. */
export function allGuestFixtures(): GuestFixture[] {
  return FIXTURES;
}

/**
 * The fixture that answers this read, or `null`.
 *
 * `null` is the important half and the reason this never needs a catch-all: a
 * read with no fixture falls through to the network, where an anonymous request
 * gets a 401 that `apiClient` already treats as "nobody is signed in" rather
 * than a fault. The surface then renders its own empty state — which is honest,
 * and is strictly better than the marketing page it used to get instead of the
 * whole screen. Coverage can therefore grow one entry at a time without any
 * point in between being broken.
 */
export function resolveGuestFixture(pathname: string): GuestFixture | null {
  return FIXTURES.find((fixture) => fixture.match(pathname)) ?? null;
}

/** Run a fixture. Split from resolution so a caller can ask "is this covered?"
 *  without paying for the payload. */
export function runGuestFixture(fixture: GuestFixture, context: GuestFixtureContext): unknown {
  return fixture.respond(context);
}
