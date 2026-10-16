/**
 * The `local/<runtime>/<model>` ref grammar — THE one spelling of "a model this machine
 * serves directly", wherever the ref is stored (settings, session state, a trace).
 *
 * Mirrors the gateway's `direct/<vendor>/<model>` grammar so a pinned ref is
 * self-describing, and so it can never be confused for a gateway catalog id — which
 * matters because a local ref must NOT be entitlement-checked against a tenant's plan
 * (it spends nothing).
 */

import { isLocalRuntimeId, type LocalRuntimeId } from './runtimes.js';

export const LOCAL_MODEL_PREFIX = 'local/';

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

/** Whether a ref names a locally-served model (so it must bypass gateway entitlement). */
export function isLocalModelRef(ref: string | undefined): boolean {
  return parseLocalModelRef(ref) !== null;
}
