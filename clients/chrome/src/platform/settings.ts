/**
 * Rovr's device settings — one typed accessor over `chrome.storage.local`, so a key is
 * spelled in exactly one place.
 */
import type { KeyValueStore } from './keyValue';
import { REPORT_ERRORS_SETTING } from '../telemetry/errorEvents';

const SYNAPSE_URL = 'settings.synapseUrl';
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

export function createSettings(storage: KeyValueStore): RovrSettings {
  const setOrRemove = (key: string, value: unknown) => (value === null || value === '' ? storage.remove(key) : storage.set(key, value));
  return {
    synapseUrl: async () => (await storage.get<string>(SYNAPSE_URL)) ?? null,
    setSynapseUrl: (url) => setOrRemove(SYNAPSE_URL, url?.trim() ?? null),
    taskProjectId: async () => (await storage.get<number>(TASK_PROJECT)) ?? null,
    setTaskProjectId: (id) => setOrRemove(TASK_PROJECT, id),
    pinnedModel: async () => (await storage.get<string>(PINNED_MODEL)) ?? null,
    setPinnedModel: (ref) => setOrRemove(PINNED_MODEL, ref),
    reportErrors: async () => (await storage.get<boolean>(REPORT_ERRORS_SETTING)) === true,
    setReportErrors: (on) => storage.set(REPORT_ERRORS_SETTING, on),
    subscribe: (listener) => storage.subscribe((keys) => keys.some((k) => k.startsWith('settings.')) && listener()),
  };
}
