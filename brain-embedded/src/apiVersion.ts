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

/**
 * How long the `/health` read may take before the caller stops waiting for it.
 *
 * UNREACHABLE and SLOW are different failures, and only the first one was ever handled.
 * A rejected read resolves null and a report honestly says the API version is unknown;
 * a read that never SETTLES (offline behind a live socket, a captive portal, a stalled
 * connection) left every awaiting caller hanging forever. That is precisely what turns
 * "Copy diagnostics" into a button that does nothing at all: the click is received, the
 * report is never built, and nothing is ever shown to say so.
 *
 * The stamp is the least important line in a diagnostics report and must never be able
 * to hold the rest of it hostage — so the wait is bounded HERE, in the one module both
 * surfaces already go through, rather than each host racing its own timer (the web app
 * had one, the VS Code webview did not, and only one of the two copy buttons worked).
 * An over-run is just a null.
 *
 * A caller that can cancel the underlying request should ALSO pass its own
 * `AbortSignal.timeout(API_VERSION_PROBE_TIMEOUT_MS)` — the race below guarantees the
 * bound, the signal is the courtesy that also frees the socket.
 */
export const API_VERSION_PROBE_TIMEOUT_MS = 2_500;

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

/** Resolve `null` if `p` has not settled within `ms`, without cancelling it: a late
 *  answer still refreshes the cache for the NEXT caller, it just stops blocking this
 *  one. `ms <= 0` disables the bound (for tests that drive their own clock). */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | null> {
  if (!(ms > 0)) return p;
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    // `unref` where the host has it (Node/the headless probe), so a pending deadline
    // never keeps a CLI process alive past the answer it already printed.
    (timer as unknown as { unref?: () => void }).unref?.();
    void p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

/**
 * Resolve the API version through `read`, memoizing a success for
 * {@link API_VERSION_TTL_MS} and abandoning a read that outruns
 * {@link API_VERSION_PROBE_TIMEOUT_MS}. Resolves null when `/health` is unreachable OR
 * too slow — a diagnostics capture must never fail, and must never STALL, because a
 * version lookup did.
 *
 * `now` and `timeoutMs` are injectable so the expiry and the deadline are unit-testable
 * without a clock; pass `timeoutMs: 0` to wait indefinitely.
 */
export function fetchApiVersionVia(
  read: () => Promise<{ version?: string } | null>,
  now: () => number = Date.now,
  timeoutMs: number = API_VERSION_PROBE_TIMEOUT_MS,
): Promise<string | null> {
  if (cached && now() - cachedAt < API_VERSION_TTL_MS) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = withDeadline(read(), timeoutMs)
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
