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
import { deferredLocalModelStore, type LocalModelStore } from '@seanhogg/builderforce-brain-embedded';

let loading: Promise<LocalModelStore> | undefined;

export const browserLocalModelStore: LocalModelStore = deferredLocalModelStore(
  () => (loading ??= import('./localFirst').then((m) => m.browserPageEngines().store)),
);
