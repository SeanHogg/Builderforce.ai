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

/** What a model call reported about who served it - the local-first runner's attempts and the resolved model. */
export interface ServedResult {
  resolvedModel?: string;
  localFirst?: ReadonlyArray<{ target: string; outcome: string }>;
}

/** What actually SERVED a call, as its transport reported it: the attempt marked `served` wins, else the resolved model. */
function servedTarget(result: ServedResult): string | undefined {
  return result.localFirst?.find((attempt) => attempt.outcome === 'served')?.target ?? result.resolvedModel;
}

/**
 * THE rule for "this call was free": it was served by a model ON THIS DEVICE ({@link runsOnDevice}). Judged by
 * what SERVED it; `requestedModel` is accepted for signature parity but never a fallback - what was asked for
 * is not what answered, and a call nothing identifies has an unknown cost, not a free one. A hosted runtime
 * dispatched from here (`local/kimi-code`) is not on the device: paid, counted against a cap, no saving booked.
 */
export function servedOnDevice(result: ServedResult, _requestedModel?: string): boolean {
  return runsOnDevice(servedTarget(result));
}
