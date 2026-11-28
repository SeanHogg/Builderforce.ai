/**
 * Rovr's device settings — one typed accessor over `chrome.storage.local`, so a key is
 * spelled in exactly one place.
 */
import type { KeyValueStore } from './keyValue';
import { REPORT_ERRORS_SETTING } from '../telemetry/errorEvents';

const BFI_SERVE_URL = 'settings.bfiServeUrl';
/** The key before the `bfi-serve` rename: read once, copied to {@link BFI_SERVE_URL} and removed (INF-G019 drops this). */
const LEGACY_SYNAPSE_URL = 'settings.synapseUrl';
const TASK_PROJECT = 'settings.taskProjectId';
const PINNED_MODEL = 'settings.pinnedModel';

export interface RovrSettings {
  synapseUrl(): Promise<string | null>;
  setSynapseUrl(url: string | null): Promise<void>;
  /** The project new tasks are filed in, or null to keep them on this device. */
  taskProjectId(): Promise<number | null>;
  setTaskProjectId(id: number | null): Promise<void>;
  /** The model the person pinned in the picker (`local/<runtime>/<model>`), or null for
   *  automatic routing — local first, failover to the gateway. */
  pinnedModel(): Promise<string | null>;
  setPinnedModel(ref: string | null): Promise<void>;
  reportErrors(): Promise<boolean>;
  setReportErrors(on: boolean): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export function createSettings(storage: KeyValueStore, workspace?: { scope(): string | null; subscribe(listener: () => void): () => void }): RovrSettings {
  const setOrRemove = (key: string, value: unknown) => (value === null || value === '' ? storage.remove(key) : storage.set(key, value));
  const projectKey = (scope: string | null | undefined): string => scope ? `${TASK_PROJECT}.${scope}` : TASK_PROJECT;
  return {
    synapseUrl: async () => {
      const current = await storage.get<string>(BFI_SERVE_URL);
      if (current !== undefined && current !== null) return current;
      const legacy = await storage.get<string>(LEGACY_SYNAPSE_URL);
      if (legacy === undefined || legacy === null) return null;
      await storage.set(BFI_SERVE_URL, legacy);
      await storage.remove(LEGACY_SYNAPSE_URL);
      return legacy;
    },
    setSynapseUrl: async (url) => {
      await setOrRemove(BFI_SERVE_URL, url?.trim() ?? null);
      // A cleared (or replaced) address must not resurrect from the retired key on the next read.
      await storage.remove(LEGACY_SYNAPSE_URL);
    },
    async taskProjectId() {
      const scope = workspace?.scope();
      const key = projectKey(scope);
      const current = await storage.get<number>(key);
      if (current !== undefined || !scope) return current ?? null;
      const legacy = await storage.get<number>(TASK_PROJECT);
      if (legacy === undefined || workspace?.scope() !== scope) return null;
      await storage.set(key, legacy);
      await storage.remove(TASK_PROJECT);
      return legacy;
    },
    async setTaskProjectId(id) {
      const scope = workspace?.scope();
      if (scope) await storage.remove(TASK_PROJECT);
      await setOrRemove(projectKey(scope), id);
    },
    pinnedModel: async () => (await storage.get<string>(PINNED_MODEL)) ?? null,
    setPinnedModel: (ref) => setOrRemove(PINNED_MODEL, ref),
    reportErrors: async () => (await storage.get<boolean>(REPORT_ERRORS_SETTING)) === true,
    setReportErrors: (on) => storage.set(REPORT_ERRORS_SETTING, on),
    subscribe(listener) {
      const stopStorage = storage.subscribe((keys) => keys.some((k) => k.startsWith('settings.')) && listener());
      let scope = workspace?.scope();
      const stopWorkspace = workspace?.subscribe(() => {
        const next = workspace.scope();
        if (next !== scope) { scope = next; listener(); }
      });
      return () => { stopStorage(); stopWorkspace?.(); };
    },
  };
}
