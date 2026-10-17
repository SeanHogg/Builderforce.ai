/**
 * Per-request routing flags read off a gateway request body — strict pin, the
 * vendor-timeout override, and the prompt-cache TTL opt-in.
 *
 * Part of the `modelPool` split (see `modelPool.ts`, the public barrel).
 */

import { MAX_VENDOR_CALL_TIMEOUT_MS } from './vendors';

/**
 * Canonical strict-pin resolver — the single source of truth for "did this
 * request ask to hard-pin its model?" Both the request body (`modelStrict`
 * — the gateway-internal flag cloud coding agents set, OR `strict` — the
 * public SDK alias) and an optional `?strict=true` query param feed in here.
 *
 * Strict pin only applies when a non-empty `model` is also present; without a
 * named model there's nothing to pin, so it's a no-op (the gateway routes
 * by shape as usual). Callers normalize via this helper so the entitlement
 * gate, `complete()`'s dispatch branch, and the trace logger never diverge on
 * what counts as strict.
 */
export function resolveStrictPin(
  body: { model?: unknown; modelStrict?: unknown; strict?: unknown },
  queryStrict?: boolean,
): boolean {
  const hasModel = typeof body.model === 'string' && body.model.length > 0;
  if (!hasModel) return false;
  return body.modelStrict === true || body.strict === true || queryStrict === true;
}

/**
 * Per-request inner-timeout override — lets a NON-premium tenant opt a single
 * long call into the extended vendor budget without flipping plans or premium
 * routing. Carried as `body._builderforce.vendorTimeoutMs` (the gateway-internal
 * passthrough envelope, stripped before vendor dispatch).
 *
 * Returns the requested value clamped to `(0, MAX_VENDOR_CALL_TIMEOUT_MS]`, or
 * `undefined` when absent / non-positive / non-numeric — in which case the
 * caller falls back to the proxy's configured `vendorCallTimeoutMs` (plan
 * default). The clamp keeps a one-off override from holding a Worker isolate
 * open longer than the premium path's own ceiling.
 */
export function resolveVendorTimeoutOverride(
  body: Record<string, unknown>,
): number | undefined {
  const envelope = body['_builderforce'];
  if (!envelope || typeof envelope !== 'object') return undefined;
  const raw = (envelope as Record<string, unknown>).vendorTimeoutMs;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.floor(n), MAX_VENDOR_CALL_TIMEOUT_MS);
}

/**
 * Per-request prompt-cache retention opt-in — lets a bursty tenant with a large
 * stable prefix keep it warm across idle gaps longer than the 5-minute ephemeral
 * default. Carried as `body._builderforce.cacheTtl` ('1h'); any other value
 * (including absent) resolves to the 5-minute default. Honoured only for
 * caching-capable (Anthropic-family) models by the OpenRouter vendor module —
 * see promptCaching.ts. Returns `'1h'` or `undefined` (= default 5m).
 */
export function resolveCacheTtl(body: Record<string, unknown>): '1h' | undefined {
  const envelope = body['_builderforce'];
  if (!envelope || typeof envelope !== 'object') return undefined;
  return (envelope as Record<string, unknown>).cacheTtl === '1h' ? '1h' : undefined;
}
