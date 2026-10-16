/**
 * The BYO provider catalog — WHICH providers exist and WHICH gateway vendor each
 * one dispatches on. Pure data plus the two derivations over it.
 *
 * Carved out of `tenantProviderKeyService` to break a real import cycle, not for
 * tidiness. `providerAuthAlerts` needs `PROVIDER_VENDOR_MAP` / `isSupportedProvider`
 * to translate a failed vendor into the provider whose account is broken; the
 * credential resolver needs the alerts, so it can hand routing a per-tenant "this
 * account is known-bad" set. Both pointing at each other deadlocks at module-eval
 * time (these constants are built eagerly at import). A LEAF that both depend on
 * is the standard inversion, and it costs nothing: this module imports nothing but
 * the pure, import-free `@builderforce/model-catalog` package.
 *
 * `tenantProviderKeyService` re-exports every symbol here, so no existing caller
 * changed and there is exactly one definition of each.
 *
 * The provider IDS (and how each one connects) are not declared here: they are the
 * vocabulary every host shares, so they live in `@builderforce/model-catalog`
 * (`providers.ts`) and the web app derives from the same list. This module keeps
 * only the gateway's concerns over them — the vendor each dispatches on and the
 * env var its key overrides. Importing a pure, import-free package keeps it a LEAF.
 */

import { LLM_PROVIDERS, isLlmProvider, supportsSubscription, type LlmProvider } from '@builderforce/model-catalog';

export type { LlmProvider };

export const SUPPORTED_PROVIDERS: readonly LlmProvider[] = LLM_PROVIDERS;

export type ProviderAuthType = 'api_key' | 'oauth';

/** A BYO provider → the gateway vendor id + operator env-var name its tenant key
 *  overrides. Whether a provider ALSO offers a connected subscription is shared
 *  provider data (`supportsSubscription` in `@builderforce/model-catalog`), not a
 *  gateway column — the OAuth path is resolved separately, so it isn't part of the
 *  api-key overlay.
 *
 *  `ollama-local` and `freetoken` (the shared `local_runtime` entries) are the ones whose
 *  "key" is not a bare credential: each stores the composed `<apiKey>::<baseUrl>::<model>`
 *  sentinel its vendor splits — written by `selfHostedCredential.ts`. */
export const PROVIDER_VENDOR_MAP: Record<LlmProvider, {
  vendorId: string;
  envKey: 'CLAUDE_API_KEY' | 'OPENAI_API_KEY' | 'GOOGLE_API_KEY' | 'META_API_KEY'
    | 'KIMI_CODE_API_KEY' | 'MOONSHOT_API_KEY' | 'QWEN_API_KEY' | 'MINIMAX_API_KEY' | 'XAI_API_KEY'
    | 'OLLAMA_API_KEY' | 'OLLAMA_LOCAL_CONFIG' | 'FREETOKEN_CONFIG';
}> = {
  anthropic: { vendorId: 'anthropic', envKey: 'CLAUDE_API_KEY' },
  openai:    { vendorId: 'openai',    envKey: 'OPENAI_API_KEY' },
  google:    { vendorId: 'googleai',  envKey: 'GOOGLE_API_KEY' },
  meta:      { vendorId: 'meta',      envKey: 'META_API_KEY' },
  // OAuth, not an API key: a Kimi Code subscription issues no `sk-` key at all — its own
  // config leaves `api_key` empty beside an OAuth record — so the card connects by
  // device-code redirect (`kimiOAuth.ts`). The vendor id is unchanged because the access
  // token is a Bearer for the SAME endpoint, so nothing downstream has to know.
  kimi:      { vendorId: 'kimi-code', envKey: 'KIMI_CODE_API_KEY' },
  moonshot:  { vendorId: 'moonshot',  envKey: 'MOONSHOT_API_KEY' },
  qwen:      { vendorId: 'qwen',      envKey: 'QWEN_API_KEY' },
  minimax:   { vendorId: 'minimax',   envKey: 'MINIMAX_API_KEY' },
  xai:       { vendorId: 'xai',       envKey: 'XAI_API_KEY' },
  ollama:    { vendorId: 'ollama',    envKey: 'OLLAMA_API_KEY' },
  'ollama-local': { vendorId: 'ollama-local', envKey: 'OLLAMA_LOCAL_CONFIG' },
  freetoken: { vendorId: 'freetoken', envKey: 'FREETOKEN_CONFIG' },
};

export function isSupportedProvider(p: string): p is LlmProvider {
  return isLlmProvider(p);
}

/**
 * The gateway vendor a connected provider actually DISPATCHES on — which depends on
 * HOW it authenticates, not just which provider it is.
 *
 * A connected SUBSCRIPTION (OAuth) rides its own vendor because the transport differs
 * from the api-key one: ChatGPT/Codex → `openai-codex`, SuperGrok → `xai-oauth`. Only
 * Anthropic shares one vendor across both modes (the `anthropic` vendor prefers the
 * OAuth token when bound). Mapping an OAuth provider to its api-key vendor id
 * (`openai` / `xai`) yields a vendor the tenant has NO credential for: the seed picks a
 * `direct/<vendor>/…` flagship that can't dispatch, the tenant's BYO precedence stops
 * matching (`vendorForModel` returns the oauth id), and the proxy's BYO boundary filter
 * drops it — the "connected accounts were never tried" failure. THE single mapping;
 * derive every vendor-id set from it.
 */
export function byoVendorIdFor(provider: LlmProvider, authType: ProviderAuthType): string {
  if (authType === 'oauth') {
    if (provider === 'openai') return 'openai-codex';
    if (provider === 'xai') return 'xai-oauth';
  }
  return PROVIDER_VENDOR_MAP[provider].vendorId;
}

/** Every gateway vendor id one provider can dispatch on — its api-key vendor, plus its
 *  subscription vendor when it offers a subscription that rides a vendor of its own. */
function byoVendorIdsFor(provider: LlmProvider): string[] {
  const ids = [byoVendorIdFor(provider, 'api_key')];
  if (supportsSubscription(provider)) ids.push(byoVendorIdFor(provider, 'oauth'));
  return [...new Set(ids)];
}

/**
 * Every gateway vendor id ANY connected BYO account can dispatch on, across both auth
 * modes — derived, so a provider added to the shared list (or a new subscription
 * vendor in {@link byoVendorIdFor}) joins every vendor-id set built from it.
 */
export const BYO_VENDOR_IDS: readonly string[] = [...new Set(SUPPORTED_PROVIDERS.flatMap(byoVendorIdsFor))];

/**
 * Gateway vendor id → the BYO provider that owns it. The inverse of
 * {@link byoVendorIdFor}, including the OAuth-only vendor ids that have no row of
 * their own in {@link PROVIDER_VENDOR_MAP}. Lives here rather than in the alert
 * module so the mapping and its inverse cannot drift apart.
 */
const PROVIDER_BY_VENDOR: ReadonlyMap<string, LlmProvider> = new Map<string, LlmProvider>(
  SUPPORTED_PROVIDERS.flatMap((p) => byoVendorIdsFor(p).map((vendorId) => [vendorId, p] as const)),
);

/** The BYO provider a gateway vendor id belongs to, or `null` for an operator-only
 *  vendor (openrouter, cloudflare, cerebras, …) that no tenant can own. */
export function providerForVendor(vendorId: string): LlmProvider | null {
  return PROVIDER_BY_VENDOR.get(vendorId) ?? null;
}
