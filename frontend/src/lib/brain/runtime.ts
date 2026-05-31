'use client';

/**
 * Host wiring for the embeddable brain core (@seanhogg/builderforce-brain-embedded).
 *
 * The package is app-agnostic; this module supplies the builderforce.ai
 * specifics — the gateway URL + tenant token (transport), the `/api/brain`
 * persistence client, and the modality→system-prompt mapping. It's the single
 * place the app meets the package, mirroring how StudioPanel is handed
 * `authToken`/`baseUrl`. Built once as a module constant so BrainProvider's
 * memoized runtime stays stable across renders.
 */

import type { BrainConfig } from '@seanhogg/builderforce-brain-embedded';
import { AUTH_API_URL, getStoredTenantToken, checkUnauthorizedAndRedirect } from '../auth';
import { brain, parseLlmError } from '../builderforceApi';
import { getModality } from '../modality';

export const brainConfig: BrainConfig = {
  transport: {
    baseUrl: AUTH_API_URL,
    getToken: getStoredTenantToken,
    onUnauthorized: (res, hadToken) => checkUnauthorizedAndRedirect(res, hadToken),
    mapError: parseLlmError,
  },
  // The `/api/brain` client already matches BrainPersistenceAdapter's signatures.
  persistence: brain,
  resolveSystemPrompt: (modality) => getModality(modality).brainSystemPrompt,
};
