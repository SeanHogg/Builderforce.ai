/**
 * The polling rules, written once.
 *
 * Every client poll in the product follows the same two decisions: a hidden tab
 * does not fetch (a phone in a pocket must not keep the database awake), and a
 * failed load doubles the wait up to a ceiling (an outage costs one request a
 * minute, not one every few seconds). `usePolledResource` (one loop per
 * component), `createSharedPoll` (one loop per resource, shared by every reader)
 * and the imperatively started canvas workflow poll all read them from here, so
 * the three cannot drift apart.
 */

/** A failed load may stretch the wait to at most this many base intervals. */
export const MAX_BACKOFF_FACTOR = 8;

/** True while the document is hidden. False outside a browser, where there is no tab to hide. */
export function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** The wait after a failed load: double the current one (never below `baseMs`), capped at `maxMs`. */
export function backoffDelay(currentMs: number, baseMs: number, maxMs: number = baseMs * MAX_BACKOFF_FACTOR): number {
  return Math.min(Math.max(currentMs, baseMs) * 2, maxMs);
}
