/**
 * The `/` menu's port onto THIS page's on-device model store (PRD 34) — the models the
 * browser runs itself on WebGPU (`bfi`, WebLLM), listed, downloaded and removed from the
 * composer's Model tab.
 *
 * Deferred twice over, for the same reason `runtime.ts` loads `localFirst` lazily: the
 * composer renders on most routes, and neither the engines nor their module have any
 * business on first paint. `localFirst` is imported, and the engines built, only when
 * the Model tab first reads the store; a composer that is never opened costs nothing.
 */
import type { LocalModelStore, PageEngineSet } from '@seanhogg/builderforce-brain-embedded';

let loading: Promise<PageEngineSet> | undefined;
const engines = (): Promise<PageEngineSet> => (loading ??= import('./localFirst').then((m) => m.browserPageEngines()));

export const browserLocalModelStore: LocalModelStore = {
  listLocalModels: async () => (await engines()).store.listLocalModels(),
  download: async (ref, onProgress, signal) => (await engines()).store.download(ref, onProgress, signal),
  remove: async (ref) => (await engines()).store.remove(ref),
  subscribe(listener) {
    let unsubscribe: (() => void) | undefined;
    let gone = false;
    void engines().then((set) => {
      if (!gone) unsubscribe = set.store.subscribe(listener);
    });
    return () => {
      gone = true;
      unsubscribe?.();
    };
  },
};
