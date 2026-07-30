/**
 * The deployed API version, read once per session from `/health`.
 *
 * A support capture with no build stamp is ambiguous in the worst way: a dump taken
 * minutes BEFORE a deploy is byte-identical to one taken after, so a fixed bug reads
 * as unfixed. Every surface therefore stamps `UI x · API y` onto its diagnostics.
 *
 * The surfaces REACH `/health` differently — the web app hits the api origin
 * unauthenticated, the VS Code webview goes through its configured gateway base — so
 * the caller supplies the read and this module owns the part that must not be
 * duplicated: a session cache plus in-flight coalescing, so the footer, the sidebar
 * and a diagnostics capture cost one request between them.
 */

/**
 * How long a resolved version stays good.
 *
 * IT USED TO BE FOREVER, and that reproduced the EXACT failure the header above says
 * this module exists to prevent. `cached` was set once per page load and never
 * invalidated, so a tab open across a deploy stamped every later capture with the build
 * it started on. Measured 2026-07-29: a diagnostics capture taken twelve hours after
 * `2026.7.181` shipped reported `apiVersion: 2026.7.180`, and the fixes in that build —
 * visibly present in the very decision payloads inside the same report — were read as
 * never deployed. A stamp that lies about which build produced the evidence is worse
 * than no stamp: it is the one field a reader cannot cross-check.
 *
 * A minute is long enough to keep the property the cache was added for (the footer, the
 * sidebar and a capture still cost ONE request between them) and short enough that no
 * capture can name a build that is no longer running.
 */
export const API_VERSION_TTL_MS = 60_000;

let cached: string | null = null;
let cachedAt = 0;
let inflight: Promise<string | null> | null = null;

/** Drop the memoized version — for tests, and for a surface that knows it just
 *  reconnected to a different deployment. */
export function resetApiVersionCache(): void {
  cached = null;
  cachedAt = 0;
  inflight = null;
}

/**
 * Resolve the API version through `read`, memoizing a success for
 * {@link API_VERSION_TTL_MS}. Resolves null when `/health` is unreachable — a
 * diagnostics capture must never fail because a version lookup did.
 *
 * `now` is injectable so the expiry is unit-testable without a clock.
 */
export function fetchApiVersionVia(
  read: () => Promise<{ version?: string } | null>,
  now: () => number = Date.now,
): Promise<string | null> {
  if (cached && now() - cachedAt < API_VERSION_TTL_MS) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = read()
    .then((data) => {
      const next = data?.version ?? null;
      // A failed/empty read must not extend the life of a STALE value — leaving the old
      // timestamp in place is what turns one unreachable `/health` into an indefinitely
      // wrong stamp. Only a real answer refreshes the window.
      if (next) {
        cached = next;
        cachedAt = now();
      }
      return next;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
