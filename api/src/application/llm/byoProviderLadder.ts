/**
 * The DEFAULT order of a tenant's UN-RANKED connected providers — by how well each codes.
 *
 * A provider the tenant never ranked used to sort alphabetically (`loadTenantProviderRows`
 * orders by provider id after priority), so an un-ranked Anthropic followed an un-ranked
 * "kimi" for no reason but the alphabet, and that order became the tenant's precedence
 * everywhere it is read (`byoVendorPriorityOrder`, the seed's rank merge, the editor).
 *
 * The rank is DERIVED from the catalog's CODE ladder (`roleLadders.ts`), never a second
 * hand-kept provider table: a provider ranks by the best rung its dispatch vendor's
 * flagships hold, on the vendor its auth type actually dispatches on — a ChatGPT
 * subscription (`openai-codex`, GPT-5) is not the same account as an OpenAI api key
 * (`openai`, GPT-4.1). Plan-gated coders do not count: nothing says the account has them.
 */

import { bestLadderRank } from '@builderforce/model-catalog';
import { byoVendorIdFor, type LlmProvider, type ProviderAuthType } from './llmProviderCatalog';
import { vendorFlagship } from './vendors';

/** The provider's best CODE-ladder rung; providers with no flagship on it sort last. */
export function providerCodeRung(provider: LlmProvider, authType: ProviderAuthType): number {
  const vendor = byoVendorIdFor(provider, authType);
  const flagships = [vendorFlagship(vendor, true), vendorFlagship(vendor, false)]
    .filter((id): id is string => id !== null);
  return bestLadderRank('code', flagships) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Comparator for connected providers: tenant-RANKED ones first by their priority, then
 * the un-ranked ones by {@link providerCodeRung}, then by provider id (stable and total).
 * An explicit tenant rank always wins over the default.
 */
export function compareByoPrecedence(
  a: { provider: LlmProvider; authType: ProviderAuthType; priority: number | null },
  b: { provider: LlmProvider; authType: ProviderAuthType; priority: number | null },
): number {
  if (a.priority !== null || b.priority !== null) {
    if (a.priority === null) return 1;
    if (b.priority === null) return -1;
    if (a.priority !== b.priority) return a.priority - b.priority;
  } else {
    const rung = providerCodeRung(a.provider, a.authType) - providerCodeRung(b.provider, b.authType);
    if (rung !== 0) return rung;
  }
  return a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0;
}
