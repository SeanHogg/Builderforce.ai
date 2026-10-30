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

/**
 * Whether the completion was answered ON THIS DEVICE — and so cost nothing. THE one rule, read from the
 * registry's `onDevice` through {@link runsOnDevice}: from the SERVED attempt when there was one (a
 * gateway attempt included — it says the cloud answered), else from the model the stream resolved. A
 * hosted local-grammar runtime (Kimi Code) leaves the device; a gateway answer, even after a local
 * attempt fell over, is not on-device; the model merely ASKED FOR is never an answer; and a result that
 * names no answer is not claimed free.
 */
export function servedOnDevice(result: ServedResult): boolean {
  const served = servedAttempt(result);
  return runsOnDevice(served ? served.target : result.resolvedModel);
}

/**
 * The model that ANSWERED, for pricing, routing and the ledger. A served LOCAL attempt names it; a
 * served cloud attempt carries only a placeholder (see {@link GATEWAY_ATTEMPT_TARGET}), so the model
 * comes from the stream's `resolvedModel` — falling back to the attempt's own target when that is a
 * real model id. Undefined when the result names nothing; the model asked for is not an answer.
 */
export function servedRef(result: ServedResult): string | undefined {
  const served = servedAttempt(result);
  if (served && isLocalModelRef(served.target)) return served.target;
  if (result.resolvedModel) return result.resolvedModel;
  return served && served.target !== GATEWAY_ATTEMPT_TARGET ? served.target : undefined;
}

/**
 * The gateway's `direct/<vendor>/<model>` spelling of a HOSTED local-grammar ref (`local/kimi-code/k3`
 * → `direct/kimi-code/k3`), or undefined for any other ref. That is the person's own account at a
 * hosted runtime: capped and booked like a direct (BYO) call, never as the device's free work.
 */
export function hostedDirectRef(ref: string | undefined): string | undefined {
  const parsed = parseLocalModelRef(ref);
  if (!parsed) return undefined;
  const runtime = localRuntime(parsed.provider);
  return !runtime.onDevice && runtime.gatewayVendor ? `${GATEWAY_DIRECT_PREFIX}${runtime.gatewayVendor}/${parsed.model}` : undefined;
}

/**
 * The catalog id a HOSTED runtime's model is priced under (`local/kimi-code/k3` → `moonshotai/kimi-k3`),
 * from the registry's alias DATA. Undefined for any other ref and for a hosted model the registry does
 * not know: that call is unpriced — unknown — and must be reported so, not valued at zero.
 */
export function hostedCatalogId(ref: string | undefined): string | undefined {
  const parsed = parseLocalModelRef(ref);
  if (!parsed) return undefined;
  const runtime = localRuntime(parsed.provider);
  return runtime.onDevice ? undefined : runtime.catalogAliases?.[parsed.model];
}
