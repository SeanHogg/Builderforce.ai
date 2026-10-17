/**
 * Strict-pin dispatch — the `modelStrict` / `strict` path: one model, no chain, no
 * failover, and an honest 503 `model_unavailable` when it cannot be honoured.
 * Split out of `LlmProxyService.ts`.
 */

import {
  vendorForModel,
  vendorKeyBound,
  vendorRequiresLocalEgress,
} from './vendors';
import { loadCooldowns, loadCooledVendors } from '../../infrastructure/auth/cooldownStore';
import type { ChatCompletionRequest, ProxyResult } from './proxyTypes';
import type { ProxyRuntime } from './proxyConfig';

/**
 * Strict-pin dispatch — single model, no chain, no failover. Used when
 * `body.modelStrict === true`. Pre-flight gates:
 *   - vendor key bound? otherwise 503 `model_unavailable` (reason: `vendor_key_unconfigured`)
 *   - model on cooldown?  otherwise 503 `model_unavailable` (reason: `cooldown`)
 * If both pass, dispatches a chain of length 1. Vendor errors propagate
 * verbatim instead of being absorbed into a chain-exhausted envelope.
 */
export async function dispatchStrict(
  { cfg, funding, dispatcher }: Pick<ProxyRuntime, 'cfg' | 'funding' | 'dispatcher'>,
  model: string,
  body: ChatCompletionRequest,
  requestHeaders?: Record<string, string>,
): Promise<ProxyResult> {
  const vendor = vendorForModel(model);
  if (funding.byoStrict && !funding.connectedByoVendors.has(vendor) && !cfg.openRouterConnectionModels.has(model)) {
    // Name the vendor the pin needs AND the vendors that actually resolved — the bare
    // reason code can't distinguish "you pinned a model on an account you never
    // connected" from "the account IS connected but its credential didn't resolve".
    const usable = [...funding.connectedByoVendors];
    return strictUnavailableResult(model, 'byo_provider_required', {
      requiredVendor: vendor,
      connectedVendors: usable,
      configuredProviders: cfg.byoDiagnostics.configuredProviders ?? [],
      unresolvedReasons: cfg.byoDiagnostics.unresolvedReasons ?? {},
    });
  }
  if (!vendorKeyBound(funding.vendorEnv(), vendor) && !funding.isOwnerServedModel(model)) {
    return strictUnavailableResult(model, 'vendor_key_unconfigured');
  }

  // This vendor's upstream cannot be reached from the Worker at all (Kimi Code's edge
  // 403, a private Ollama/FreeToken address) and no runtime is online to make the call
  // from the tenant's own machine. A cascade would just skip the candidate; a strict
  // pin has nothing to skip TO, so say why instead of letting `dispatchInternal` throw
  // an exhausted-cascade 429 that reads as "the provider is rate limiting you".
  // Naming the reason is what lets the credential probe tell an owner to connect a
  // runtime rather than accusing their working key.
  if (vendorRequiresLocalEgress(vendor) && !cfg.hostEgress) {
    return strictUnavailableResult(model, 'local_egress_required');
  }

  // A vendor the tenant serves from their OWN account is exempt from the global
  // cooldown keyspace ({@link isOwnerServedVendor}) — the pinned model IS the owner's
  // account, so it gets its one attempt and surfaces the REAL upstream error instead of
  // a synthetic 503 inherited from someone else's key. Skipping the gate also drops two
  // KV subrequests from every BYO strict-pin dispatch.
  if (!funding.isOwnerServedModel(model)) {
    const [cooledSet, cooledVendors] = await Promise.all([
      loadCooldowns(cfg.env, [{ vendor, model }]),
      loadCooledVendors(cfg.env, [vendor]),
    ]);
    if (cooledVendors.has(vendor) || cooledSet.has(`${vendor}/${model}`)) {
      return strictUnavailableResult(model, 'cooldown');
    }
  }

  return dispatcher.dispatch([model], body, requestHeaders);
}

/**
 * Build the 503 `model_unavailable` envelope used by strict-pin dispatch
 * when the requested model can't be honoured. The reason string is exposed
 * to the caller so they can decide whether to retry on a different model or
 * surface the error directly.
 */
function strictUnavailableResult(
  model: string,
  reason: 'cooldown' | 'vendor_key_unconfigured' | 'plan_tier' | 'vendor_outage' | 'byo_provider_required' | 'local_egress_required',
  byo?: {
    requiredVendor: string;
    connectedVendors: readonly string[];
    configuredProviders: readonly string[];
    unresolvedReasons: Readonly<Record<string, string>>;
  },
): ProxyResult {
  const vendor = vendorForModel(model);
  // For the BYO reason, spell out the gap. `byo_provider_required` alone leaves the
  // operator guessing which of "never connected" / "connected but unusable" they hit.
  const byoSuffix = byo
    ? ` It needs the '${byo.requiredVendor}' provider on your own account.`
      + ` ${byo.connectedVendors.length ? `Usable this request: ${byo.connectedVendors.join(', ')}.` : 'No provider resolved to a usable credential this request.'}`
      + `${byo.configuredProviders.length
        ? ` Connected: ${byo.configuredProviders.map((p) => (byo.unresolvedReasons[p] ? `${p} (unusable: ${byo.unresolvedReasons[p]})` : `${p} (ok)`)).join(', ')}.`
        : ' No provider is connected on this workspace.'}`
    : '';
  const body = JSON.stringify({
    error: `Strict-pin: model '${model}' is unavailable (${reason}).${byoSuffix}`,
    code: 'model_unavailable',
    // Top-level `vendor` + `model` so SDK consumers' per-vendor rollups pick
    // up strict-pin 503s without parsing the model id prefix. `details`
    // retains `requestedModel` for backward compat.
    vendor,
    model,
    details: {
      requestedModel: model,
      reason,
      ...(byo ? {
        requiredVendor: byo.requiredVendor,
        connectedVendors: [...byo.connectedVendors],
        configuredProviders: [...byo.configuredProviders],
        unresolvedReasons: { ...byo.unresolvedReasons },
      } : {}),
    },
  });
  return {
    response: new Response(body, {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }),
    resolvedModel: model,
    resolvedVendor: vendor,
    retries: 0,
    failovers: [],
    outcome: 'strict_unavailable',
    attempts: [],
  };
}
