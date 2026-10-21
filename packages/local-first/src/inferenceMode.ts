/**
 * THE INFERENCE MODE — what a person chooses about where models run, on every host
 * (the web app, Rovr, the VS Code extension). The eight platform capabilities stay as
 * ADVANCED overrides; the mode is what people see, and it derives the capabilities.
 *
 *   - `local-only` — never reaches the gateway: inference, connected features, sync and
 *     direct providers are off whatever an override says (the promise the mode makes).
 *   - `hybrid`     — local first, then the gateway's Auto route (the gateway itself puts
 *     the free tier first). A picked model runs FIRST, never hard-pinned: if it fails,
 *     the turn falls back to the local engine and then Auto. Connected features on; sync
 *     per its own setting.
 *   - `specific`   — exactly the person's pick (a cloud model, the BYO pool, Kimi Code, or
 *     one local model), hard-pinned: no local attempt, no fallback; no pick is an error
 *     (`no_specific_model`), never a silent Hybrid. Gateway inference AND direct providers on.
 *
 * Picking a model never changes the mode by itself — Specific is chosen in the mode
 * control. What each mode does with a pick is brain-embedded's `createHostModelStream`.
 *
 * Default: `hybrid` once signed in, `local-only` signed out. A host persists only the
 * person's explicit choice; an unset mode is re-derived, so signing in moves an
 * undecided person onto Hybrid and their heartbeat / assigned work / insights keep
 * working.
 *
 * Pure — no storage, no host.
 */
import { LOCAL_FIRST_POLICY, type PlatformPolicySnapshot } from './policy.js';

export type InferenceMode = 'local-only' | 'hybrid' | 'specific';

/** Every mode, in the order a control lists them (the recommended one first). */
export const INFERENCE_MODES: readonly InferenceMode[] = Object.freeze(['hybrid', 'local-only', 'specific']);

export function isInferenceMode(value: unknown): value is InferenceMode {
  return typeof value === 'string' && (INFERENCE_MODES as readonly string[]).includes(value);
}

/** The mode a person who never chose runs in. */
export function defaultInferenceMode(context: { signedIn: boolean }): InferenceMode {
  return context.signedIn ? 'hybrid' : 'local-only';
}

/**
 * The capability patch a mode decides. Fields it does not name (sync in Hybrid and
 * Specific, model downloads, external MCP, git remotes) keep their own setting.
 */
export function policyForInferenceMode(mode: InferenceMode): Partial<PlatformPolicySnapshot> {
  switch (mode) {
    case 'local-only':
      // Exactly the denied default for everything that reaches the platform: a signed-out
      // person on a fresh install sends nothing. (Sign-in itself is the host's explicit,
      // scoped `authenticate` grant, and is the way onto Hybrid.)
      return { gatewayInference: false, connectedFeatures: false, synchronize: false, directProviders: false };
    case 'hybrid':
      return { gatewayInference: true, connectedFeatures: true, directProviders: false };
    case 'specific':
      return { gatewayInference: true, connectedFeatures: true, directProviders: true };
  }
}

/** The capabilities `local-only` holds off whatever an advanced override says. */
const LOCAL_ONLY_LOCKED: readonly (keyof PlatformPolicySnapshot)[] = ['gatewayInference', 'connectedFeatures', 'synchronize', 'directProviders'];

export interface ResolvedInferencePolicy {
  /** The mode in force — the chosen one, else the derived default. */
  mode: InferenceMode;
  /** Whether the person chose it (false ⇒ derived; a host may ask on first run). */
  chosen: boolean;
  /** The full capability snapshot to apply. */
  snapshot: PlatformPolicySnapshot;
}

/**
 * THE composition every host runs: the denied default, then the mode's patch, then the
 * person's explicit per-capability overrides — with `local-only` keeping its promise.
 */
export function resolveInferencePolicy(input: {
  mode?: InferenceMode | null;
  signedIn: boolean;
  overrides?: Partial<PlatformPolicySnapshot>;
}): ResolvedInferencePolicy {
  const chosen = isInferenceMode(input.mode);
  const mode = chosen ? (input.mode as InferenceMode) : defaultInferenceMode(input);
  const snapshot: PlatformPolicySnapshot = {
    ...LOCAL_FIRST_POLICY,
    ...policyForInferenceMode(mode),
    ...(input.overrides ?? {}),
  };
  if (mode === 'local-only') for (const field of LOCAL_ONLY_LOCKED) snapshot[field] = false;
  return { mode, chosen, snapshot };
}
