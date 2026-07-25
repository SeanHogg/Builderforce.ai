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

let cached: string | null = null;
let inflight: Promise<string | null> | null = null;

/**
 * Resolve the API version through `read`, caching the first success for the session.
 * Resolves null when `/health` is unreachable — a diagnostics capture must never fail
 * because a version lookup did.
 */
export function fetchApiVersionVia(read: () => Promise<{ version?: string } | null>): Promise<string | null> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = read()
    .then((data) => {
      cached = data?.version ?? null;
      return cached;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
