/**
 * Host wiring for the embeddable brain core (@seanhogg/builderforce-brain-embedded).
 *
 * The package is app-agnostic; this module supplies the builderforce.ai
 * specifics — the gateway URL + tenant token (transport), the local-first stream
 * over it, the `/api/brain` persistence client, and the modality→system-prompt
 * mapping. It's the single place the app meets the package, mirroring how
 * StudioPanel is handed `authToken`/`baseUrl`. Built once as a module constant so BrainProvider's
 * memoized runtime stays stable across renders.
 */

import type { BrainConfig, BrainStreamFn, BrainTransport } from '@seanhogg/builderforce-brain-embedded';
import { AUTH_API_URL, getStoredTenantToken, checkUnauthorizedAndRedirect } from '../auth';
import { brain, parseLlmError } from '../builderforceApi';
import { getModality } from '../modality';

/**
 * The local-first Brain stream over `transport`, loaded on the first turn rather than
 * with this module: it sits in the root layout's static closure, and the browser-engine
 * probe and shim (`localFirst.ts`) have no business on every route's first paint.
 */
export function lazyLocalFirstStream(transport: BrainTransport): BrainStreamFn {
  let loading: Promise<BrainStreamFn> | null = null;
  return async (opts, handlers) => {
    loading ??= import('./localFirst').then((m) => m.createBrowserLocalFirstStream(transport));
    return (await loading)(opts, handlers);
  };
}

const transport: BrainTransport = {
  baseUrl: AUTH_API_URL,
  getToken: getStoredTenantToken,
  onUnauthorized: (res, hadToken) => checkUnauthorizedAndRedirect(res, hadToken),
  mapError: parseLlmError,
};

export const brainConfig: BrainConfig = {
  transport,
  // Tool-free, unpinned turns run on the browser's own model first (see localFirst.ts).
  stream: lazyLocalFirstStream(transport),
  // The `/api/brain` client already matches BrainPersistenceAdapter's signatures.
  persistence: brain,
  resolveSystemPrompt: (modality) => getModality(modality).brainSystemPrompt,
};

// Run steps survive offline + reload (IndexedDB-backed step outbox). Browser-only, once.
// Loaded lazily: this module sits in the root layout's static closure, and the outbox
// wiring has no business on every route's first paint.
if (typeof window !== 'undefined') {
  void import('./stepDurability').then((m) => m.installBrowserStepDurability());
}
