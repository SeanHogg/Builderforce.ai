/**
 * BYO model ROUTING — a tenant's connected-provider rows projected onto the model ids
 * that dispatch through that tenant's OWN credential.
 *
 * Lives in the application layer (not in the gateway route it grew up in) because three
 * unrelated surfaces need the same projection and none of them may disagree:
 *   • the model PICKER (`GET /v1/models`) — which models a connected account unlocks;
 *   • the credential PROBE (`byoCredentialHealth`) — which model to test the account with,
 *     on demand from Settings and from the daily sweep;
 *   • anything else that has to name a tenant-keyed route rather than an operator one.
 *
 * A wrong projection here does not fail loudly — it silently resolves onto an
 * operator-funded route, which bills us and makes a "green" connection test prove nothing
 * about the tenant's account. That is why the mapping is one function with no callers
 * allowed to hand-roll their own prefix.
 */

import { getCatalog } from './vendors';
import { byoVendorIdsFromSummaries, type ProviderKeySummary } from './tenantProviderKeyService';

/** Convert a catalog entry into the canonical route that uses the tenant's key.
 *  Prefixing every model as `<vendor>/<id>` is incorrect:
 *   - `anthropic/...` is OpenRouter's namespace, while direct Anthropic catalog
 *     ids are bare (`claude-sonnet-5`);
 *   - factory-built OpenAI-compatible vendors require `direct/<vendor>/...`;
 *   - Google AI owns the bespoke `googleai/...` prefix.
 *  Keep this projection at the provider boundary so the picker and connection
 *  test cannot drift onto an operator-funded or unrecognised route. */
function byoModelRef(entry: { id: string; vendor: string }): string {
  if (entry.vendor === 'anthropic') return entry.id;
  if (entry.vendor === 'googleai') return `googleai/${entry.id}`;
  if (entry.vendor === 'openai-codex') return `openai-codex/${entry.id}`;
  if (entry.vendor === 'xai-oauth') return `xai-oauth/${entry.id}`;
  return `direct/${entry.vendor}/${entry.id}`;
}

/** A tenant's connected-provider rows → the pinnable models served through that
 *  provider's canonical tenant-keyed route. Takes the SUMMARIES (not bare provider
 *  ids) because the route depends on how the provider authenticates: a connected
 *  ChatGPT/SuperGrok subscription serves `openai-codex/…` / `xai-oauth/…` models,
 *  NOT the `direct/<vendor>/…` api-key ones the tenant has no key for. */
export function byoModelsFor(summaries: readonly ProviderKeySummary[]): Array<{ id: string; vendor: string; tier: string; contextWindow?: number }> {
  const vendorIds = byoVendorIdsFromSummaries(summaries);
  if (vendorIds.size === 0) return [];
  return getCatalog()
    .filter((e) => vendorIds.has(e.vendor))
    .map((e) => ({ id: byoModelRef(e), vendor: e.vendor, tier: e.tier, ...(e.contextWindow ? { contextWindow: e.contextWindow } : {}) }));
}
