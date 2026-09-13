/**
 * Cache keys for a connected provider's MODEL CHOICE — one leaf, so every writer
 * invalidates the SAME keys the readers fill.
 *
 * A leaf (it imports only the cache) because the writers are the credential service
 * (`tenantProviderKeyService` — a key set, rotated or removed changes what the account
 * can call) and the selection store (`providerModelSelection`), and the credential
 * service is itself imported by the catalog reader. Keeping the key formats here breaks
 * what would otherwise be a cycle between them.
 */

import type { Env } from '../../env';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';

/** Every provider's selected models for one tenant — read on each credential resolve. */
export const providerModelSelectionCacheKey = (tenantId: number): string =>
  `provider-model-selection:${tenantId}`;

/** What one tenant's key for one provider reports from its own `GET /models`. */
export const providerAccountModelsCacheKey = (tenantId: number, provider: string): string =>
  `provider-account-models:${tenantId}:${provider}`;

/**
 * Call from every write to a provider CREDENTIAL. A new key can serve a different model
 * set (a Token Plan is a subset of pay-as-you-go), and a removed key cascades its
 * selection away in the database — both cached views must follow.
 */
export async function invalidateProviderModelCaches(env: Env, tenantId: number, provider: string): Promise<void> {
  await Promise.all([
    invalidateCached(env, providerModelSelectionCacheKey(tenantId)),
    invalidateCached(env, providerAccountModelsCacheKey(tenantId, provider)),
  ]);
}
