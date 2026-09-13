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
 *
 * Imports the provider catalog LEAF (not `tenantProviderKeyService`) so the credential
 * resolver can use these projections without an import cycle.
 */

import { getCatalog, tierForModel } from './vendors';
import { byoVendorIdFor } from './llmProviderCatalog';
import type { ProviderRouteSpec } from './tenantProviderKeyService';
import type { ProviderModelSelections } from './providerModelSelection';

/** Convert a catalog entry into the canonical route that uses the tenant's key.
 *  Prefixing every model as `<vendor>/<id>` is incorrect:
 *   - `anthropic/...` is OpenRouter's namespace, while direct Anthropic catalog
 *     ids are bare (`claude-sonnet-5`);
 *   - factory-built OpenAI-compatible vendors require `direct/<vendor>/...`;
 *   - Google AI owns the bespoke `googleai/...` prefix.
 *  Keep this projection at the provider boundary so the picker and connection
 *  test cannot drift onto an operator-funded or unrecognised route. */
export function byoModelRef(entry: { id: string; vendor: string }): string {
  if (entry.vendor === 'anthropic') return entry.id;
  if (entry.vendor === 'googleai') return `googleai/${entry.id}`;
  if (entry.vendor === 'openai-codex') return `openai-codex/${entry.id}`;
  if (entry.vendor === 'xai-oauth') return `xai-oauth/${entry.id}`;
  return `direct/${entry.vendor}/${entry.id}`;
}

/**
 * A tenant's SELECTED provider models (1165) as tenant-keyed route refs, keyed by the
 * DISPATCH vendor — the shape the BYO seed reads (`byoAutoSeedModels.selectedModels`) and
 * the set a cloud pin is validated against. A provider with no selection is absent, so
 * it keeps leading with its default flagship.
 */
export function byoSelectedModelRefs(
  summaries: readonly ProviderRouteSpec[],
  selections: ProviderModelSelections,
): Record<string, string[]> {
  const refs: Record<string, string[]> = {};
  for (const summary of summaries) {
    const chosen = selections[summary.provider];
    if (!chosen?.length) continue;
    const vendor = byoVendorIdFor(summary.provider, summary.authType);
    refs[vendor] = chosen.map((id) => byoModelRef({ id, vendor }));
  }
  return refs;
}

/** A tenant's connected-provider rows → the pinnable models served through that
 *  provider's canonical tenant-keyed route. Takes the SUMMARIES (not bare provider
 *  ids) because the route depends on how the provider authenticates: a connected
 *  ChatGPT/SuperGrok subscription serves `openai-codex/…` / `xai-oauth/…` models,
 *  NOT the `direct/<vendor>/…` api-key ones the tenant has no key for.
 *
 *  A provider with a model SELECTION contributes exactly that list, in its order, instead
 *  of its static catalog — so the picker offers what routing will try, in the order it
 *  will try it, including models the static catalog never listed. */
export function byoModelsFor(
  summaries: readonly ProviderRouteSpec[],
  selections: ProviderModelSelections = {},
): Array<{ id: string; vendor: string; tier: string; contextWindow?: number }> {
  const catalog = getCatalog();
  const seen = new Set<string>();
  // `summaries` is already sorted by the tenant's precedence. Walk it first, then
  // the models within that provider, rather than filtering the registry catalog:
  // filtering preserved registry order and silently discarded the user's ordering
  // before the picker ever received it.
  return summaries.flatMap((summary) => {
    const vendor = byoVendorIdFor(summary.provider, summary.authType);
    const vendorCatalog = catalog.filter((entry) => entry.vendor === vendor);
    const chosen = selections[summary.provider];
    const entries = chosen?.length
      ? chosen.map((id) => {
          const ref = byoModelRef({ id, vendor });
          const contextWindow = vendorCatalog.find((entry) => entry.id === id)?.contextWindow;
          return { id: ref, vendor, tier: tierForModel(ref), ...(contextWindow ? { contextWindow } : {}) };
        })
      : vendorCatalog.map((entry) => ({ id: byoModelRef(entry), vendor: entry.vendor, tier: entry.tier, ...(entry.contextWindow ? { contextWindow: entry.contextWindow } : {}) }));
    return entries.filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
  });
}
