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

/** What a completion reports of how it was served: the local-first attempts and the model that answered. */
export interface ServedResult {
  resolvedModel?: string | undefined;
  localFirst?: ReadonlyArray<{ target: string; outcome: string }> | undefined;
}

/** The local ref a local-first stream's SERVED attempt names, when a local model answered. */
export function servedLocalTarget(result: Pick<ServedResult, 'localFirst'>): string | undefined {
  return result.localFirst?.find((attempt) => attempt.outcome === 'served' && isLocalModelRef(attempt.target))?.target;
}

/**
 * Whether the completion was answered ON THIS DEVICE — and so cost nothing. The served local-first
 * attempt wins; a pinned local call (no attempt summaries) is read from the model that answered, else
 * the one asked for. A hosted local-grammar runtime (Kimi Code) leaves the device, and a gateway
 * answer (even after a local attempt fell over) is not on-device either.
 */
export function servedOnDevice(result: ServedResult, requested?: string): boolean {
  return runsOnDevice(servedLocalTarget(result) ?? result.resolvedModel ?? requested);
}
