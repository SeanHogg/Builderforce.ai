/**
 * The `local/<runtime>/<model>` ref grammar — THE one spelling of "a model this machine
 * serves directly", wherever the ref is stored (settings, session state, a trace).
 *
 * Mirrors the gateway's `direct/<vendor>/<model>` grammar so a pinned ref is
 * self-describing, and so it can never be confused for a gateway catalog id — which
 * matters because a local ref must NOT be entitlement-checked against a tenant's plan
 * (it spends nothing).
 */

import { isLocalRuntimeId, localRuntime, LOCAL_RUNTIMES, type LocalRuntimeId } from './runtimes.js';

export const LOCAL_MODEL_PREFIX = 'local/';
const GATEWAY_DIRECT_PREFIX = 'direct/';

/** Compose the ref for a model on a local runtime. */
export function formatLocalModelRef(runtime: LocalRuntimeId, model: string): string {
  return `${LOCAL_MODEL_PREFIX}${runtime}/${model}`;
}

/**
 * Split `local/<runtime>/<model>` back apart, or null when `ref` is not a local ref
 * (a gateway catalog id, an Evermind pin, or undefined).
 *
 * Splits on the first two separators ONLY: an Ollama id legitimately contains both `:`
 * and `/` (`qwen3:8b`, `hf.co/user/repo:q4`), so the model segment is whatever remains
 * after the runtime — never re-split.
 */
export function parseLocalModelRef(ref: string | undefined): { provider: LocalRuntimeId; model: string } | null {
  if (!ref || !ref.startsWith(LOCAL_MODEL_PREFIX)) return null;
  const rest = ref.slice(LOCAL_MODEL_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const provider = rest.slice(0, slash);
  const model = rest.slice(slash + 1);
  if (!model || !isLocalRuntimeId(provider)) return null;
  return { provider, model };
}

/**
 * Where a ref runs when a client on the user's machine must make the call: a `local/…`
 * ref, or a gateway `direct/<vendor>/<model>` ref whose vendor a runtime serves
 * (registry `gatewayVendor`). The picker lists a connected Kimi account's models under
 * the gateway spelling (`direct/kimi-code/k3`), and the gateway cannot reach Kimi — so
 * every client resolves a pin through this, never through {@link parseLocalModelRef}
 * alone, or that pick goes to a Worker that answers `local_egress_required`.
 */
export function clientPinOf(ref: string | undefined): { provider: LocalRuntimeId; model: string } | null {
  const local = parseLocalModelRef(ref);
  if (local || !ref || !ref.startsWith(GATEWAY_DIRECT_PREFIX)) return local;
  const rest = ref.slice(GATEWAY_DIRECT_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const vendor = rest.slice(0, slash);
  const model = rest.slice(slash + 1);
  const runtime = LOCAL_RUNTIMES.find((r) => r.gatewayVendor === vendor);
  return runtime && model ? { provider: runtime.id, model } : null;
}

/** Whether a ref names a locally-served model (so it must bypass gateway entitlement). */
export function isLocalModelRef(ref: string | undefined): boolean {
  return parseLocalModelRef(ref) !== null;
}

/**
 * Whether a ref names a model served ON THIS DEVICE — read from the runtime registry's
 * `onDevice`, never a per-runtime branch: a hosted runtime dispatched from here (Kimi
 * Code) is local in grammar but leaves the device.
 */
export function runsOnDevice(ref: string | undefined): boolean {
  const parsed = parseLocalModelRef(ref);
  return !!parsed && localRuntime(parsed.provider).onDevice;
}

/**
 * The `target` a local-first attempt summary carries when the gateway served and named no model
 * (`localFirstTransport` passes the cloud leg no model). It is a placeholder for "the cloud", never a
 * model id: nothing may price, route or name a call by it.
 */
export const GATEWAY_ATTEMPT_TARGET = 'gateway';

/** What a completion reports of how it was served: the local-first attempts and the model that answered. */
export interface ServedResult {
  resolvedModel?: string | undefined;
  localFirst?: ReadonlyArray<{ target: string; outcome: string }> | undefined;
}

function servedAttempt(result: ServedResult): { target: string } | undefined {
  return result.localFirst?.find((attempt) => attempt.outcome === 'served');
}

/** Who answered a completion: whether it ran on this device, and the model that answered. */
export interface ServedIdentity {
  /** The completion ran ON THIS DEVICE — and so cost nothing. */
  onDevice: boolean;
  /** The model that answered, for pricing, routing and the ledger; undefined when the result names none. */
  name: string | undefined;
}

/**
 * THE one reading of who answered a completion. The SERVED attempt decides when there is one (a gateway
 * attempt included — it says the cloud answered); with no attempt the stream's `resolvedModel` does.
 *   - A served LOCAL attempt names the model by its target; whether it runs on the device is the
 *     registry's `onDevice` ({@link runsOnDevice}), so a hosted local-grammar runtime (Kimi Code) is not.
 *   - A served cloud attempt carries only the placeholder {@link GATEWAY_ATTEMPT_TARGET}, so the model
 *     comes from `resolvedModel` — else from the attempt's own target when that is a real model id, else
 *     it is unnamed (and never on the device).
 * The model ASKED FOR (`requested`) is never an answer — a picked local model can fall back to the cloud without
 * a word, so it never decides `onDevice` — and it stands in for the NAME only when the result says nothing of
 * how the call was served: no served attempt AND no resolved model. Once an attempt served, an unnamed answer
 * (a gateway placeholder with nothing resolved) stays unnamed: the request must not name a call the cloud answered.
 */
export function servedIdentity(result: ServedResult, requested?: string): ServedIdentity {
  const served = servedAttempt(result);
  if (!served) return { onDevice: runsOnDevice(result.resolvedModel), name: result.resolvedModel ?? requested };
  if (isLocalModelRef(served.target)) return { onDevice: runsOnDevice(served.target), name: served.target };
  const name = result.resolvedModel ?? (served.target !== GATEWAY_ATTEMPT_TARGET ? served.target : undefined);
  return { onDevice: false, name };
}

/** Whether the completion was answered on this device (see {@link servedIdentity}). */
export function servedOnDevice(result: ServedResult): boolean {
  return servedIdentity(result).onDevice;
}

/** The model that answered (see {@link servedIdentity}). */
export function servedRef(result: ServedResult): string | undefined {
  return servedIdentity(result).name;
}

/**
 * The gateway's `direct/<vendor>/<model>` spelling of a HOSTED runtime's ref — from either spelling
 * (`local/kimi-code/k3` or `direct/kimi-code/k3`, both resolved by {@link clientPinOf}) — or undefined for
 * any other ref. That is the person's own account at a hosted runtime: capped and booked like a direct
 * (BYO) call, never as the device's free work.
 */
export function hostedDirectRef(ref: string | undefined): string | undefined {
  const pin = clientPinOf(ref);
  if (!pin) return undefined;
  const runtime = localRuntime(pin.provider);
  return !runtime.onDevice && runtime.gatewayVendor ? `${GATEWAY_DIRECT_PREFIX}${runtime.gatewayVendor}/${pin.model}` : undefined;
}

/**
 * The catalog id a HOSTED runtime's model is priced under (`local/kimi-code/k3` and `direct/kimi-code/k3`
 * both → `moonshotai/kimi-k3`), from the registry's alias DATA through {@link clientPinOf}. Undefined for
 * any other ref and for a hosted model the registry does not know: that call is unpriced — unknown — and
 * must be reported so, not valued at zero.
 */
export function hostedCatalogId(ref: string | undefined): string | undefined {
  const pin = clientPinOf(ref);
  if (!pin) return undefined;
  const runtime = localRuntime(pin.provider);
  return runtime.onDevice ? undefined : runtime.catalogAliases?.[pin.model];
}

/**
 * The id a call is PRICED under: a hosted runtime's registry catalog alias, else its direct spelling (a live
 * gateway book may know it), else the ref itself. The ONE place that decision is made — the cost and the
 * ledger's valuation both use it.
 */
export function pricedId(ref: string): string {
  return hostedCatalogId(ref) ?? hostedDirectRef(ref) ?? ref;
}
