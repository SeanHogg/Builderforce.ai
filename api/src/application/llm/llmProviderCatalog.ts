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
 * is the standard inversion, and it costs nothing: this module imports nothing.
 *
 * `tenantProviderKeyService` re-exports every symbol here, so no existing caller
 * changed and there is exactly one definition of each.
 */

export type LlmProvider =
  | 'anthropic' | 'openai' | 'google' | 'meta' | 'kimi' | 'moonshot' | 'qwen' | 'minimax' | 'xai';

export const SUPPORTED_PROVIDERS: readonly LlmProvider[] = [
  'anthropic', 'openai', 'google', 'meta', 'kimi', 'moonshot', 'qwen', 'minimax', 'xai',
];

export type ProviderAuthType = 'api_key' | 'oauth';

/** A BYO provider → the gateway vendor id + operator env-var name its tenant key
 *  overrides. `oauth` marks the provider that ALSO supports a connected
 *  subscription (Anthropic today) — the OAuth path is resolved separately via
 *  `resolveAnthropicOAuthToken`, so it isn't part of the api-key overlay. */
export const PROVIDER_VENDOR_MAP: Record<LlmProvider, {
  vendorId: string;
  envKey: 'CLAUDE_API_KEY' | 'OPENAI_API_KEY' | 'GOOGLE_API_KEY' | 'META_API_KEY'
    | 'KIMI_CODE_API_KEY' | 'MOONSHOT_API_KEY' | 'QWEN_API_KEY' | 'MINIMAX_API_KEY' | 'XAI_API_KEY';
  oauth: boolean;
}> = {
  anthropic: { vendorId: 'anthropic', envKey: 'CLAUDE_API_KEY', oauth: true },
  openai:    { vendorId: 'openai',    envKey: 'OPENAI_API_KEY', oauth: true },
  google:    { vendorId: 'googleai',  envKey: 'GOOGLE_API_KEY', oauth: false },
  meta:      { vendorId: 'meta',      envKey: 'META_API_KEY',   oauth: false },
  kimi:      { vendorId: 'kimi-code', envKey: 'KIMI_CODE_API_KEY', oauth: false },
  moonshot:  { vendorId: 'moonshot',  envKey: 'MOONSHOT_API_KEY', oauth: false },
  qwen:      { vendorId: 'qwen',      envKey: 'QWEN_API_KEY', oauth: false },
  minimax:   { vendorId: 'minimax',   envKey: 'MINIMAX_API_KEY', oauth: false },
  xai:       { vendorId: 'xai',       envKey: 'XAI_API_KEY', oauth: true },
};

export function isSupportedProvider(p: string): p is LlmProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(p);
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

/**
 * Gateway vendor id → the BYO provider that owns it. The inverse of
 * {@link byoVendorIdFor}, including the OAuth-only vendor ids that have no row of
 * their own in {@link PROVIDER_VENDOR_MAP}. Lives here rather than in the alert
 * module so the mapping and its inverse cannot drift apart.
 */
const PROVIDER_BY_VENDOR: ReadonlyMap<string, LlmProvider> = new Map<string, LlmProvider>([
  ...SUPPORTED_PROVIDERS.map((p) => [PROVIDER_VENDOR_MAP[p].vendorId, p] as const),
  ['openai-codex', 'openai'],
  ['xai-oauth', 'xai'],
]);

/** The BYO provider a gateway vendor id belongs to, or `null` for an operator-only
 *  vendor (openrouter, cloudflare, cerebras, …) that no tenant can own. */
export function providerForVendor(vendorId: string): LlmProvider | null {
  return PROVIDER_BY_VENDOR.get(vendorId) ?? null;
}
