/**
 * Rovr's PLATFORM POLICY — derived from the person's INFERENCE MODE (Local only · Hybrid ·
 * Specific), the same mode the web app and the VS Code host enforce.
 *
 * The decision rules are the shared ones (`@builderforce/local-first`
 * `resolveInferencePolicy`): an unchosen mode is `hybrid` signed in and `local-only`
 * signed out, so a fresh, signed-out install sends nothing to the platform, and a
 * signed-in person on first run has gateway inference and connected features. What is
 * Rovr's own is only the persistence, all in `chrome.storage.local`:
 *
 *   - `policy.inferenceMode` — the person's explicit choice (absent = unchosen);
 *   - `policy.<capability>`  — ADVANCED per-capability overrides; only a key actually
 *     stored overrides the mode, and Local only keeps its promise over any of them;
 *   - `session.key`          — the credential, whose presence is "signed in".
 *
 * A change to any of them in any extension context (the panel's `/` menu, a sign-in, the
 * worker) recomputes the snapshot everywhere through the storage subscription — which is
 * what makes a revocation abort in-flight sends.
 */
import {
  createPlatformPolicy,
  isInferenceMode,
  LOCAL_FIRST_POLICY,
  resolveInferencePolicy,
  type InferenceMode,
  type MutablePlatformPolicy,
  type PlatformCapability,
  type PlatformPolicySnapshot,
} from '@builderforce/local-first';
import { SESSION_CREDENTIAL_KEY } from '../auth/session';
import type { KeyValueStore } from './keyValue';

const PREFIX = 'policy.';
export const INFERENCE_MODE_KEY = `${PREFIX}inferenceMode`;
const FIELDS = Object.keys(LOCAL_FIRST_POLICY) as Array<keyof PlatformPolicySnapshot>;
const storageKey = (field: keyof PlatformPolicySnapshot): string => `${PREFIX}${field}`;

export interface RovrInferenceModeState {
  mode: InferenceMode;
  /** The person chose it (false ⇒ derived from sign-in; ask on a signed-in first run). */
  chosen: boolean;
  signedIn: boolean;
  /**
   * The first read of storage has landed. Until it has, `mode` is only the refused
   * placeholder — a surface renders no mode (and offers no "Switch to Hybrid") rather
   * than show Local only to someone who chose Hybrid.
   */
  loaded: boolean;
}

export interface RovrPlatformPolicy extends MutablePlatformPolicy {
  /** The first read of the persisted policy has landed. */
  ready(): Promise<void>;
  /** Re-read storage now (e.g. right after a sign-in, before the next platform call). */
  refresh(): Promise<void>;
  /** Grant or revoke ONE capability as an advanced override, persisted before it applies. */
  setCapability(field: keyof PlatformPolicySnapshot, on: boolean): Promise<void>;
  /** The mode in force, and whether it was chosen. */
  inferenceMode(): RovrInferenceModeState;
  /** Choose a mode — persisted first, then applied. */
  setInferenceMode(mode: InferenceMode): Promise<void>;
  /** Called after every recompute (mode, sign-in or override changed). */
  subscribeMode(listener: (state: RovrInferenceModeState) => void): () => void;
}

export function createRovrPlatformPolicy(storage: KeyValueStore): RovrPlatformPolicy {
  const policy = createPlatformPolicy();
  // Refused until the first read lands (`loaded: false`): nothing reaches the platform
  // meanwhile, and no surface presents the placeholder as the person's mode.
  let state: RovrInferenceModeState = { mode: 'local-only', chosen: false, signedIn: false, loaded: false };
  const modeListeners = new Set<(state: RovrInferenceModeState) => void>();

  const load = async (): Promise<void> => {
    const overrides: Partial<PlatformPolicySnapshot> = {};
    for (const field of FIELDS) {
      const stored = await storage.get<boolean>(storageKey(field));
      if (typeof stored === 'boolean') overrides[field] = stored;
    }
    const stored = await storage.get<string>(INFERENCE_MODE_KEY);
    const signedIn = typeof (await storage.get<string>(SESSION_CREDENTIAL_KEY)) === 'string';
    const resolved = resolveInferencePolicy({ mode: isInferenceMode(stored) ? stored : null, signedIn, overrides });
    state = { mode: resolved.mode, chosen: resolved.chosen, signedIn, loaded: true };
    policy.set(resolved.snapshot);
    for (const listener of [...modeListeners]) listener(state);
  };
  const ready = load();
  storage.subscribe((keys) => {
    if (keys.some((key) => key.startsWith(PREFIX) || key === SESSION_CREDENTIAL_KEY)) void load();
  });

  return {
    snapshot: () => policy.snapshot(),
    allows: (capability: PlatformCapability) => policy.allows(capability),
    assert: (capability: PlatformCapability) => policy.assert(capability),
    subscribe: (listener) => policy.subscribe(listener),
    set: (patch) => policy.set(patch),
    ready: () => ready,
    refresh: load,
    async setCapability(field, on) {
      // Persist FIRST: a toggle that survives a restart is the whole point, and the
      // storage subscription replays it into every other context.
      await storage.set(storageKey(field), on);
      await load();
    },
    inferenceMode: () => state,
    async setInferenceMode(mode) {
      await storage.set(INFERENCE_MODE_KEY, mode);
      await load();
    },
    subscribeMode(listener) {
      modeListeners.add(listener);
      return () => modeListeners.delete(listener);
    },
  };
}
