/**
 * Gateway failure ENVELOPES — the OpenAI-shaped error bodies (and their
 * `ProxyResult` wrappers) a cascade returns when it cannot produce a completion:
 * cascade-exhausted 429, all-models-unavailable 503, fatal request-error 4xx,
 * Worker-subrequest-exhausted 503, and the fail-closed BYO 503.
 *
 * Pure builders: they read no instance state. Where an envelope needs "the model the
 * gateway was on" and nothing was dispatched, the caller passes its pool head.
 * Split out of `LlmProxyService.ts`.
 */

import {
  SCHEMA_TOO_COMPLEX_REASON,
  vendorForModel,
  type DispatchAttempt,
  type VendorId,
  type WorkerSubrequestExhaustedError,
} from './vendors';
import { FREE_MODEL_POOL } from './modelPool';
import { attemptToFailover, isModelUnavailableStatus, isRequestErrorStatus } from './proxyFailover';
import type { FailoverEvent, ProxyResult } from './proxyTypes';

/**
 * Build the cascade-exhausted 429 envelope. When real `attempts[]` are
 * available (from `CascadeExhaustedError`), use them for `failovers` so the
 * downstream `llm_failover_log` row carries the actual upstream status —
 * not a synthetic `code: 0`. Without this, the per-model rate-limit panel
 * cannot distinguish "model 429'd 50 times" from "model wasn't tried."
 */
export function exhaustedResponse(
  /** The proxy pool's first model — attribution when no attempt ran and the chain is empty. */
  poolHead: string | undefined,
  candidates: string[],
  schemaRetries: number,
  err?: unknown,
  attempts?: ReadonlyArray<DispatchAttempt>,
): ProxyResult {
  const message = err instanceof Error ? err.message : (err ? String(err) : 'All candidates produced non-conforming output');
  const failovers: FailoverEvent[] = attempts && attempts.length > 0
    ? attempts.map(attemptToFailover)
    : candidates.map((model) => ({ model, vendor: vendorForModel(model), code: 0, durationMs: 0, kind: 'skipped' }));
  // Pick the *last* dispatched attempt as the "model the gateway was on when
  // it gave up" — that's the most informative attribution for consumers
  // doing per-vendor saturation rollups. Falls back to the last candidate
  // when no attempts ran (every model on cooldown / no key bound).
  const resolvedModel = attempts && attempts.length > 0
    ? attempts[attempts.length - 1]!.model
    : (candidates[candidates.length - 1] ?? poolHead ?? FREE_MODEL_POOL[0] ?? '');
  const resolvedVendor: VendorId = attempts && attempts.length > 0
    ? attempts[attempts.length - 1]!.vendor
    : vendorForModel(resolvedModel);

  // All-request-error short-circuit: when EVERY dispatched attempt failed with
  // a 400/422 (caller-side schema / validation bug), the cascade isn't
  // "exhausted" in the rate-limit sense — no amount of failover or backstop
  // will fix a malformed request. Surface a FATAL 4xx carrying the upstream's
  // own diagnostic so the caller can fix their payload, instead of a generic
  // 429 that invites a doomed retry loop. Mirrors the no-cooldown decision in
  // cooldownStore.classifyFailure('request_error').
  if (attempts && attempts.length > 0 && attempts.every((a) => isRequestErrorStatus(a.status))) {
    return requestErrorResponse(attempts, resolvedModel, resolvedVendor, failovers, schemaRetries);
  }

  // A pool made entirely of removed/retired models is unavailable, not rate
  // limited. Keep mixed exhaustion (for example one retired model followed by
  // live models that 429) in the normal rate-limit envelope, but never tell a
  // caller to back off when every upstream explicitly said the model is gone.
  if (attempts && attempts.length > 0 && attempts.every((a) => isModelUnavailableStatus(a.status))) {
    return modelsUnavailableResponse(attempts, resolvedModel, resolvedVendor, failovers, schemaRetries);
  }

  // Failover breakdown lives under `error.details.failovers` — OpenAI-style
  // envelope so the SDK's existing `details` accessor on BuilderforceApiError
  // picks it up without a parser change. Top-level `vendor` + `model` give
  // consumers a single field to group by without parsing the model-id prefix
  // (which fails silently for OpenRouter-routed families like `qwen/*`,
  // `google/*`, `anthropic/*` that share the prefix with the model family,
  // not the upstream vendor).
  const exhaustedBody = JSON.stringify({
    error: {
      message,
      code: 429,
      type: 'rate_limit_error',
      vendor: resolvedVendor,
      model: resolvedModel,
      details: { failovers },
    },
  });
  return {
    response: new Response(exhaustedBody, {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }),
    resolvedModel,
    resolvedVendor,
    retries: attempts?.length ?? candidates.length,
    failovers,
    outcome: 'cascade_exhausted',
    attempts: attempts ? [...attempts] : [],
    ...(schemaRetries > 0 ? { schemaRetries } : {}),
  };
}

/** Build a truthful aggregate when every dispatched model was removed upstream. */
export function modelsUnavailableResponse(
  attempts: ReadonlyArray<DispatchAttempt>,
  resolvedModel: string,
  resolvedVendor: VendorId,
  failovers: FailoverEvent[],
  schemaRetries: number,
): ProxyResult {
  const last = attempts[attempts.length - 1]!;
  const body = JSON.stringify({
    error: {
      message: last.error || 'Every candidate model is unavailable or retired.',
      code: 'model_unavailable',
      type: 'service_unavailable',
      reason: 'all_models_unavailable',
      vendor: resolvedVendor,
      model: resolvedModel,
      details: { failovers },
    },
  });
  return {
    response: new Response(body, {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }),
    resolvedModel,
    resolvedVendor,
    retries: attempts.length,
    failovers,
    outcome: 'model_unavailable',
    attempts: [...attempts],
    ...(schemaRetries > 0 ? { schemaRetries } : {}),
  };
}

/**
 * Build the FATAL request-error envelope — used when every dispatched
 * candidate failed with a 400/422 (caller-side schema / validation bug).
 *
 * Surfaces the upstream's status verbatim (400 or 422) and its diagnostic
 * message so the caller gets an actionable "your request is malformed"
 * signal instead of a 429 cascade-exhausted (which implies "retry later" and
 * invites a doomed loop on a request that can never succeed). No cooldown was
 * written for these attempts — see `cooldownStore.classifyFailure`.
 */
export function requestErrorResponse(
  attempts: ReadonlyArray<DispatchAttempt>,
  resolvedModel: string,
  resolvedVendor: VendorId,
  failovers: FailoverEvent[],
  schemaRetries: number,
): ProxyResult {
  // Echo the *last* attempt's status (400 vs 422 are both caller-fixable) and
  // its error text — that's the model the gateway gave up on, and its body
  // carries the most specific validation diagnostic.
  const last   = attempts[attempts.length - 1]!;
  const status = isRequestErrorStatus(last.status) ? last.status : 400;

  // Distinguish a SCHEMA-too-complex cascade from a generic malformed-payload
  // one: when every dispatched attempt rejected the request because the
  // `response_format.json_schema` exceeded its constrained-decoding ceiling
  // (Gemini "too many states", etc.), surface a distinct, actionable code so
  // the caller knows to simplify the schema or drop to `json_object` mode —
  // NOT a generic `invalid_request_error` that reads like a payload bug.
  const allSchema = attempts.length > 0 && attempts.every((a) => a.kind === 'schema');
  const code: string | number = allSchema ? SCHEMA_TOO_COMPLEX_REASON : status;
  const message = allSchema
    ? `Every candidate model rejected the supplied response_format.json_schema as too complex for its constrained-decoding engine. Simplify the schema (fewer/optional fields, shallower nesting, fewer enums) or use response_format { type: 'json_object' }. Upstream: ${last.error || 'schema too complex'}`
    : (last.error || 'Request rejected by every candidate model as malformed (400/422).');
  const body = JSON.stringify({
    error: {
      message,
      code,
      type: 'invalid_request_error',
      // Both classes are TERMINAL: retrying the SAME request on a DIFFERENT
      // model won't help — every candidate already rejected it. The SDK honours
      // `terminal` to short-circuit its own failover loop (no more burning the
      // chain on a request that can never succeed as-is).
      terminal: true,
      ...(allSchema ? { reason: SCHEMA_TOO_COMPLEX_REASON } : {}),
      vendor: resolvedVendor,
      model: resolvedModel,
      details: { failovers },
    },
  });
  return {
    response: new Response(body, {
      status,
      headers: { 'content-type': 'application/json' },
    }),
    resolvedModel,
    resolvedVendor,
    retries: attempts.length,
    failovers,
    outcome: allSchema ? 'schema_too_complex' : 'request_error',
    attempts: [...attempts],
    ...(schemaRetries > 0 ? { schemaRetries } : {}),
  };
}

/**
 * Build the 503 `worker_subrequest_exhausted` envelope. Distinct from
 * `exhaustedResponse` because the failure mode is infrastructure
 * (Cloudflare's per-invocation subrequest cap), not vendor saturation —
 * callers should back off and retry rather than walk their own failover
 * chain across more models. Skips cooldown writes deliberately: each KV
 * `put` is another subrequest that would compound the problem and may
 * itself throw the same error.
 */
export function subrequestExhaustedResponse(
  /** The proxy pool's first model — attribution when the error names no model. */
  poolHead: string | undefined,
  candidates: string[],
  schemaRetries: number,
  err: WorkerSubrequestExhaustedError,
): ProxyResult {
  const resolvedModel  = err.model || (candidates[candidates.length - 1] ?? poolHead ?? FREE_MODEL_POOL[0] ?? '');
  const resolvedVendor = vendorForModel(resolvedModel);
  const body = JSON.stringify({
    error: {
      message: `Gateway hit Cloudflare's per-invocation subrequest cap; retry the request to land on a fresh Worker isolate. (${err.message})`,
      code: 503,
      type: 'service_unavailable',
      reason: 'worker_subrequest_exhausted',
      vendor: resolvedVendor,
      model:  resolvedModel,
      details: { failovers: [{ model: resolvedModel, vendor: resolvedVendor, code: 0, durationMs: 0, kind: 'network' }] },
    },
  });
  return {
    response: new Response(body, {
      status: 503,
      headers: { 'content-type': 'application/json', 'retry-after': '1' },
    }),
    resolvedModel,
    resolvedVendor,
    retries: 1,
    failovers: [{ model: resolvedModel, vendor: resolvedVendor, code: 0, durationMs: 0, kind: 'network' }],
    outcome: 'subrequest_exhausted',
    attempts: [{ model: resolvedModel, vendor: resolvedVendor, status: 0, error: err.message, durationMs: 0, kind: 'network' }],
    ...(schemaRetries > 0 ? { schemaRetries } : {}),
  };
}

/** Everything a fail-closed BYO 503 needs to explain itself. Built at the one call
 *  site in the all-cooled branch of `completeChat`; every field is diagnostics, never routing. */
export interface ByoUnavailableContext {
  /** Every model id the gateway CONSIDERED for this request, in the order it would
   *  have walked them (the composed seed). Empty means the seed itself came out empty
   *  — which is itself the finding, and `connectedVendors` says whether that was
   *  "nothing connected" or "connected, but no flagship survived". */
  attempted: readonly string[];
  /** Gateway vendor ids that RESOLVED to a usable credential this call. */
  connectedVendors: readonly string[];
  /** Model ids dropped from the chain because they were on cooldown. */
  cooled: readonly string[];
  /** Providers with a stored credential row — what the UI calls "connected". */
  configuredProviders: readonly string[];
  /** provider → why it produced no usable credential this call. */
  unresolvedReasons: Readonly<Record<string, string>>;
}

/**
 * Fail-closed envelope when BYO is required but no connected credential can serve the
 * request. Deliberately a 503, not a shared-pool fallback.
 *
 * The message NAMES what was tried. The previous flat wording ("no configured provider
 * is currently usable") was, from the operator's seat, false: the Provider-priority UI
 * showed four connected accounts, so the sentence read as the gateway not seeing them,
 * when the real state was "four rows stored, zero resolved to a usable credential" or
 * "resolved fine, but every flagship was filtered out of the chain". Those are different
 * bugs with different fixes, and the old envelope could not tell them apart — it carried
 * no model list, and it finalized with an EMPTY candidate chain, so the cloud loop's
 * ` · chain: …` suffix was blank too. Both are fixed here and at the call site.
 */
export function byoUnavailableResult(model: string, ctx: ByoUnavailableContext): ProxyResult {
  const vendor = vendorForModel(model);
  const { attempted, connectedVendors, cooled, configuredProviders, unresolvedReasons } = ctx;
  // Lead with the discriminating fact — "configured but none resolved" vs "resolved but
  // the chain composed empty" — because that is the sentence that tells the operator
  // whether to go repair a credential or go look at model/vendor filtering.
  const headline = connectedVendors.length === 0
    ? (configuredProviders.length > 0
      ? `BYO execution is required. ${configuredProviders.length} provider(s) are connected but NONE resolved to a usable credential this request — reconnect or repair the credential.`
      : 'BYO execution is required, but no provider is connected on this workspace — connect a provider.')
    : `BYO execution is required. ${connectedVendors.length} provider(s) resolved, but every candidate model was filtered out of the chain before dispatch — no request was sent upstream.`;
  const detail: string[] = [];
  if (configuredProviders.length) {
    detail.push(`connected: ${configuredProviders
      .map((p) => (unresolvedReasons[p] ? `${p} (unusable: ${unresolvedReasons[p]})` : `${p} (ok)`))
      .join(', ')}`);
  }
  if (connectedVendors.length) detail.push(`usable vendors: ${connectedVendors.join(', ')}`);
  // The list the operator actually asked for: EVERY model considered, not just the one
  // the envelope happens to be labelled with.
  detail.push(attempted.length
    ? `models tried: ${attempted.join(' → ')}`
    : 'models tried: none — the candidate chain composed empty');
  if (cooled.length) detail.push(`on cooldown: ${cooled.join(', ')}`);
  return {
    response: new Response(JSON.stringify({
      error: `${headline} ${detail.join(' · ')}`,
      code: 'byo_unavailable',
      details: {
        attemptedModels: [...attempted],
        connectedVendors: [...connectedVendors],
        configuredProviders: [...configuredProviders],
        unresolvedReasons: { ...unresolvedReasons },
        cooledModels: [...cooled],
      },
    }), { status: 503, headers: { 'content-type': 'application/json' } }),
    resolvedModel: model,
    resolvedVendor: vendor,
    retries: 0,
    failovers: [],
    outcome: 'byo_unavailable',
    // The chain the gateway WOULD have walked — stamped so `finalize` doesn't overwrite
    // it and every consumer (cloud-run error text, superadmin trace, tool_audit detail)
    // reports the same list instead of an empty one.
    candidateChain: [...attempted],
    attempts: [],
  };
}
