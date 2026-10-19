/**
 * Rovr's PLATFORM POLICY — the API-denied default the offline-first architecture review
 * (docs/design/vsix-offline-first-architecture-review.md, G01/G02/G12) asks every modality
 * to start from. Rovr works on this device alone until the person explicitly grants a
 * capability; internet connectivity and sign-in on their own grant NOTHING.
 *
 * The decision rules are the shared ones (`@builderforce/local-first`: every capability
 * denied by default, `authenticate` implied by any connected capability, one snapshot
 * shape across Web/Rovr/VSIX). What is Rovr's own is only the persistence: each
 * capability lives under its OWN `policy.*` key in `chrome.storage.local`, so granting
 * sync never smuggles in gateway inference, and a change in any extension context (the
 * Settings toggles in the panel) reaches the service worker's outboxes through the
 * storage subscription — which is what makes revoking permission abort in-flight sends.
 */
import {
  createPlatformPolicy,
  LOCAL_FIRST_POLICY,
  type MutablePlatformPolicy,
  type PlatformCapability,
  type PlatformPolicySnapshot,
} from '@builderforce/local-first';
import type { KeyValueStore } from './keyValue';

const PREFIX = 'policy.';
const FIELDS = Object.keys(LOCAL_FIRST_POLICY) as Array<keyof PlatformPolicySnapshot>;
const storageKey = (field: keyof PlatformPolicySnapshot): string => `${PREFIX}${field}`;

export interface RovrPlatformPolicy extends MutablePlatformPolicy {
  /** The first read of the persisted capabilities has landed. */
  ready(): Promise<void>;
  /** Grant or revoke ONE capability, persisted on its own key before it applies. */
  setCapability(field: keyof PlatformPolicySnapshot, on: boolean): Promise<void>;
}

export function createRovrPlatformPolicy(storage: KeyValueStore): RovrPlatformPolicy {
  const policy = createPlatformPolicy();

  // A capability absent from storage is DENIED (the shared default), so a key removed in
  // another context — or never written, as on a fresh install — reads back as off.
  const load = async (): Promise<void> => {
    const full = { ...LOCAL_FIRST_POLICY } as Record<keyof PlatformPolicySnapshot, boolean>;
    for (const field of FIELDS) {
      const stored = await storage.get<boolean>(storageKey(field));
      if (typeof stored === 'boolean') full[field] = stored;
    }
    policy.set(full);
  };
  const ready = load();
  storage.subscribe((keys) => {
    if (keys.some((key) => key.startsWith(PREFIX))) void load();
  });

  return {
    snapshot: () => policy.snapshot(),
    allows: (capability: PlatformCapability) => policy.allows(capability),
    assert: (capability: PlatformCapability) => policy.assert(capability),
    subscribe: (listener) => policy.subscribe(listener),
    set: (patch) => policy.set(patch),
    ready: () => ready,
    async setCapability(field, on) {
      // Persist FIRST: a toggle that survives a restart is the whole point, and the
      // storage subscription replays the same value into every other context.
      await storage.set(storageKey(field), on);
      policy.set({ [field]: on });
    },
  };
}
