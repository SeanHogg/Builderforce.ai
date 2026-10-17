/**
 * The EMPTY-CHAIN branch of a gateway completion — what happens when composition
 * left nothing to dispatch (every candidate cooled, or filtered by the BYO boundary).
 * Split out of `LlmProxyService.ts`.
 *
 * Order: BYO-strict → probe the connected accounts once, else a fail-closed BYO 503
 * that names what was walked; otherwise → the credited-key backstop, then a short
 * cooldown-ignoring probe, then (pool genuinely empty) an honest configuration error.
 */

import { isPaidOverflowModel } from './modelPool';
import { vendorForModel, type VendorId } from './vendors';
import { byoUnavailableResult, exhaustedResponse } from './proxyEnvelopes';
import { storeInResponseCache } from './proxyResponseCache';
import { buildCandidateChain } from './proxySeed';
import { applyExcludedModels } from './requestFit';
import type { ChatCompletionRequest, ProxyResult } from './proxyTypes';
import type { ProxyRuntime } from './proxyConfig';

/**
 * How many models the last-chance probe may try when EVERY candidate is cooled.
 *
 * The probe exists so a cooldown — a hint written by an earlier request — can never
 * by itself end a request with no upstream contacted. It is deliberately short: the
 * point is to find one model that still answers, not to re-walk a chain that a
 * moment ago was believed dead. Three hops covers "the bench is stale" and "one
 * vendor is genuinely down" without turning the all-cooled path into the widest
 * cascade in the service.
 */
const ALL_COOLED_PROBE_LIMIT = 3;

export interface EmptyChainContext {
  body: ChatCompletionRequest;
  requestHeaders?: Record<string, string>;
  signal?: AbortSignal;
  traceId: string;
  startedAt: number;
  seed: readonly string[];
  seedHead: readonly string[];
  pinnedHint: string | undefined;
  cooledSet: Set<string>;
  cooledVendors: Set<VendorId>;
  cacheKey: string | null;
}

export async function resolveEmptyChain(rt: ProxyRuntime, ctx: EmptyChainContext): Promise<ProxyResult> {
  const { cfg, funding, dispatcher, finalize } = rt;
  const { body, requestHeaders, signal, traceId: tid, startedAt, seed, seedHead, pinnedHint, cooledSet, cooledVendors, cacheKey } = ctx;
  if (funding.byoStrict) {
    const connectedByo = funding.connectedByoVendors;
    // Nothing composed — but "every connected model is COOLED" is not the same as
    // "the tenant has no usable provider", and only the latter deserves a 503.
    // Cooldown protects OUR shared keys from being hammered by fan-out; the owner's
    // own account gets at most this one attempt per request, and failing closed here
    // is what turned a transient bench into a permanently stalled ticket (autonomy's
    // failure breaker trips after 3). So probe the connected flagships once, ignoring
    // per-model cooldown, and surface the REAL upstream error if they still fail.
    const probe = seedHead.filter((m) => connectedByo.has(vendorForModel(m)));
    if (probe.length > 0) {
      const probed = await dispatcher.dispatch(probe, body, requestHeaders, { signal });
      probed.paidOverflow = false; // BYO-only chain — always the tenant's own account.
      return finalize(probed, tid, startedAt, probe, probed.response.status < 400 ? 'success' : undefined);
    }
    // Genuinely nothing to try. Report WHAT was walked, not just that nothing was:
    // the seed we composed, the vendors that actually resolved, what the tenant has
    // configured (with the per-provider reason it was unusable), and anything the
    // cooldown gate removed. Passing `seed` (not `[]`) as the candidate chain also
    // makes the cloud loop's ` · chain: …` suffix report the real list.
    return finalize(
      byoUnavailableResult(seed[0] ?? 'byo-required', {
        attempted: seed,
        connectedVendors: [...connectedByo],
        cooled: seed.filter((m) => cooledSet.has(`${vendorForModel(m)}/${m}`) || cooledVendors.has(vendorForModel(m))),
        configuredProviders: cfg.byoDiagnostics.configuredProviders ?? [],
        unresolvedReasons: cfg.byoDiagnostics.unresolvedReasons ?? {},
      }),
      tid, startedAt, seed, 'byo_unavailable',
    );
  }
  // Every model in the seed + premium fallback list is on cooldown. The
  // guaranteed paid backstop (credited key) is the next chance before we
  // surface a hard failure — unless the tenant has exhausted its paid-overflow
  // cap, in which case we don't fund another paid call.
  const backstop = cfg.disablePaidOverflow ? null : await dispatcher.dispatchBackstop(body, requestHeaders);
  if (backstop) {
    // Tenant-funded (a connected subscription OR a BYO api-key) is free to us →
    // never meter it as overflow.
    backstop.paidOverflow = !funding.isTenantFunded(backstop);
    return finalize(backstop, tid, startedAt, [...cfg.backstopModels], 'success');
  }
  // LAST-CHANCE PROBE — the non-BYO twin of the connected-account probe above,
  // and the reason a caller can no longer be told "everything is on cooldown".
  //
  // A cooldown is a HINT about our shared keys, written by some earlier request
  // that failed; it is never proof that this request would fail. Returning a
  // synthetic 429 without dispatching anything spends the user's turn on a
  // guess — the Creation Canvas turn that motivated this failed in 811ms having
  // never touched an upstream, and a stale bench (one 429 trips a vendor, and the
  // escalating TTL benches it for up to an hour) can outlive the saturation that
  // caused it by a long way. So compose the chain a second time with the cooldown
  // gate off and actually try it. The cost is bounded exactly like any other
  // cascade: `freeBudget` caps the free hops, the probe is capped again below, and
  // a probe that fails writes fresh cooldowns like any other attempt.
  //
  // Whatever comes back is the REAL upstream outcome — a 429 from a vendor that
  // genuinely is saturated, with its own message and per-model `failovers` — which
  // is both truthful and actionable, unlike the message it replaces.
  const uncooledChain = applyExcludedModels(
    buildCandidateChain(rt, seed, new Set<string>(), new Set<VendorId>(), pinnedHint, seedHead),
    body.excludeModels,
  );
  // The composer can still return nothing when the seed was emptied for reasons
  // that are NOT cooldown (plan tier, BYO filtering). Falling back to the raw seed
  // keeps the probe honest: a model with no key bound is skipped by the dispatcher
  // itself, which reports that fact rather than inventing one.
  const probe = (uncooledChain.length > 0 ? uncooledChain : [...seed]).slice(0, ALL_COOLED_PROBE_LIMIT);
  if (probe.length > 0) {
    const probed = await dispatcher.dispatch(probe, body, requestHeaders, { signal, ignoreCooldown: true });
    if (probed.response.status < 400) {
      probed.paidOverflow = isPaidOverflowModel(probed.resolvedModel) && !funding.isTenantFunded(probed);
      if (cacheKey) await storeInResponseCache(cfg.env, cacheKey, probed);
      return finalize(probed, tid, startedAt, probe, 'success');
    }
    return finalize(probed, tid, startedAt, probe);
  }
  // Nothing to probe: the pool itself is empty, which is a configuration fact and
  // not a rate limit. Say that instead of asking the caller to retry a wait that
  // would never end.
  return finalize(
    exhaustedResponse(
      cfg.modelPool[0],
      seed.slice(),
      0,
      new Error('No model is available for this request — no provider key is configured for any model in the pool.'),
    ),
    tid, startedAt, seed.slice(), 'all_cooldown',
  );
}
