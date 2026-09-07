/**
 * The guarded server-side fetch — `fetch()` with the SSRF guard wrapped AROUND the
 * request rather than only in front of it.
 *
 * WHAT THIS FIXES. `assertSafeUrl` rejects a literal private address; the DoH lookup in
 * `resolveAndAssertPublic` rejects a public NAME that resolves to one. Both run BEFORE
 * the request, and the Workers runtime resolves the hostname again, itself, when it
 * opens the connection — it exposes no way to pin our verified IP to that connection.
 * So a name that answers publicly for our lookup and privately for the runtime's (DNS
 * rebinding, TTL 0) slips through the gap between the two. That gap is what this module
 * narrows.
 *
 * HOW. The check is run twice: once before the request (a private answer means we never
 * connect at all), and once CONCURRENTLY WITH the request, in the same window the
 * runtime does its own resolution. A response is not handed back until that second
 * check has cleared; if it comes back private the body is cancelled and the call throws.
 * An attacker now has to keep the name public across BOTH of our lookups while serving
 * the private answer to the runtime's — a far smaller window than "any time after our
 * one lookup", and one they cannot arrange by simply setting TTL 0.
 *
 * WHAT IS STILL RESIDUAL, honestly. This is narrowing, not closure: a rebind that lands
 * exactly inside the request and flips back before our second lookup is still uncaught,
 * and both lookups FAIL OPEN (a DoH error does not block the request — see
 * `resolveAndAssertPublic`). Closing it completely needs fetch-time IP pinning, which
 * Workers does not offer. `assertSafeUrl` remains the primary guard.
 *
 * NOT CACHED, deliberately. The read-through cache is the default for a repeated
 * network read, and it is wrong here: the whole value of the second lookup is that it
 * happened DURING this request. A cached verdict — even a short-lived one — reinstates
 * exactly the stale-answer window the module exists to shrink. The cost is one extra
 * DoH round trip per guarded fetch, and it is concurrent with the request, so it adds
 * no serial latency.
 */

import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { resolveAndAssertPublic } from './ssrfGuard';

/**
 * Run `operation` while `hostname` is held to be public — the check before it starts
 * AND again concurrently with it, so a name that flips mid-operation is caught.
 *
 * The general form of {@link fetchPublic}, for the case where the guarded host is NOT
 * the host we connect to: the screenshot renderer, for instance, posts a target URL to
 * Cloudflare's browser-rendering API and CF resolves that target itself. Guarding our
 * own request there would check the wrong name; this guards the right one across the
 * whole window in which the target is dereferenced.
 *
 * `discard` is called with the operation's result when the recheck rejects it, so a
 * caller holding a streaming body can cancel it rather than leak the connection.
 *
 * @throws {BlockedUrlError} when either resolution positively answers with a private
 *   address.
 */
export async function withPublicHostGuard<T>(
  hostname: string,
  operation: () => Promise<T>,
  discard?: (value: T) => unknown,
): Promise<T> {
  // De-bracketed (IPv6) and lower-cased, as the guard's range checks expect.
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  // Before: a private answer here means the operation never runs.
  await resolveAndAssertPublic(host);
  const running = operation();
  // A permanent handler for `running`, attached BEFORE anything can reject: the recheck
  // may reject first, and a promise that then rejects with nobody listening is an
  // unhandled rejection (a process-level warning, and a crash under some runtimes).
  // This only records how it settled — nothing is discarded on the success path.
  const settled = running.then(
    (value) => ({ ok: true as const, value }),
    (operationError: unknown) => ({ ok: false as const, operationError }),
  );
  // During: the same check, in the window the target name is actually dereferenced.
  const recheck = resolveAndAssertPublic(host);
  try {
    const [value] = await Promise.all([running, recheck]);
    return value;
  } catch (error) {
    // The caller gets `error` either way; what matters here is that a result the
    // recheck rejected does not leak its connection.
    const outcome = await settled;
    if (outcome.ok && discard) {
      try {
        await discard(outcome.value);
      } catch (cleanupError) {
        reportCaughtError(cleanupError, {
          source: 'infrastructure/net/fetchPublic.ts',
          operation: 'discardGuardedResult',
          level: 'warning',
        });
      }
    }
    throw error;
  }
}

export interface FetchPublicOptions {
  /** Injectable transport (tests, and the crawler's own instrumented client). */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch a URL whose host has been verified public both before and during the request.
 *
 * Callers keep `assertSafeUrl` where they have it: that check is synchronous, has
 * no DNS in it, and is what rejects a malformed URL, a non-http(s) protocol or a literal
 * internal address — the classification most call sites report differently from a
 * transport failure. This owns the DNS half, which necessarily spans the request.
 *
 * @throws {BlockedUrlError} when either resolution positively answers with a private
 *   address. A rejection from the second one means the response was discarded unread.
 */
export async function fetchPublic(
  url: string | URL,
  init?: RequestInit,
  opts: FetchPublicOptions = {},
): Promise<Response> {
  const target = url instanceof URL ? url : new URL(url);
  return withPublicHostGuard(
    target.hostname,
    // The caller's own URL goes on the wire unchanged — `target` exists only to read
    // the host off, and round-tripping through `URL` would normalise the request.
    () => (opts.fetchImpl ?? fetch)(url, init),
    // A response the recheck rejected must not reach the caller, and an un-cancelled
    // body leaks the connection.
    (response) => response.body?.cancel(),
  );
}
