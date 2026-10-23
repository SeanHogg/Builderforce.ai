/**
 * B3 — the gateway's single-flight step: identical CACHEABLE completions in flight on
 * this isolate share one upstream call (see `singleFlight.ts` for why per-isolate, and
 * why cross-isolate coalescing would need a Durable Object and is not done).
 *
 * Keyed on the exact-match response-cache key, so it applies to exactly the requests
 * that cache already proves are safe to answer with another request's bytes — the
 * idempotent, low-temperature, tool-free, non-streaming family — and to nothing else.
 *
 * A follower is answered the way a cache hit is (`response_cache_hit`, nothing
 * dispatched, the leader's usage as `cachedUsage`), so it is never metered as a second
 * spend and the savings ledger can price the call it did not make.
 */

import { SingleFlight } from './singleFlight';
import type { ProxyResult } from './proxyTypes';

const completions = new SingleFlight<ProxyResult>();

/** A follower's own copy of a successful leader result, or null to run its own call. */
export function coalescedFollowerResult(leader: ProxyResult): ProxyResult | null {
  if (leader.response.status >= 400 || leader.response.bodyUsed) return null;
  const headers = new Headers(leader.response.headers);
  headers.set('x-builderforce-cache', 'coalesced');
  return {
    response: new Response(leader.response.clone().body, { status: leader.response.status, headers }),
    resolvedModel: leader.resolvedModel,
    resolvedVendor: leader.resolvedVendor,
    retries: 0,
    failovers: [],
    outcome: 'response_cache_hit',
    attempts: [],
    byoFunded: false,
    platformSurcharge: false,
    ...(leader.usage ? { cachedUsage: leader.usage } : {}),
  };
}

/**
 * Run `dispatch` for `key`, or join the identical call already in flight. The leader's
 * result is returned untouched; a follower gets {@link coalescedFollowerResult} and
 * `finalizeFollower` stamps its own trace on it.
 */
export async function coalesceCompletion(
  key: string,
  dispatch: () => Promise<ProxyResult>,
  finalizeFollower: (shared: ProxyResult) => ProxyResult,
): Promise<ProxyResult> {
  const { value, shared } = await completions.run(key, dispatch, coalescedFollowerResult);
  return shared ? finalizeFollower(value) : value;
}

/** In-flight keys on this isolate — tests and diagnostics only. */
export function inFlightCompletions(): number {
  return completions.size;
}
