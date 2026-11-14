/**
 * The BYO LLM PROVIDER vocabulary — which bring-your-own provider accounts exist and
 * HOW a tenant connects each one, as data every host reads.
 *
 * WHY HERE. The provider list used to be restated three times — the gateway's union,
 * the web app's `LlmProvider` type and the settings page's card array — and they had
 * drifted (the web type had lost `freetoken`, the card list had neither self-hosted
 * runtime). A provider the gateway accepts but a host does not name is not an error
 * anywhere: it simply never renders, never ranks, never labels. One list, imported by
 * all of them, is the only shape where adding a provider cannot be half-done.
 *
 * WHAT IS NOT HERE. Gateway concerns — the vendor a provider dispatches on, the env
 * var its key overrides, credential storage — stay with the gateway
 * (`api/.../llmProviderCatalog.ts`). This module owns the words and the connect shape,
 * nothing that needs a secret or a network. Pure and I/O-free.
 */
/** Every BYO provider, in the order hosts list them. */
export const LLM_PROVIDER_INFO = [
    { id: 'anthropic', label: 'Anthropic (Claude)', credential: 'api_key', keyPlaceholder: 'sk-ant-…', subscription: 'paste', signInDomains: ['claude.ai', 'anthropic.com'] },
    { id: 'openai', label: 'OpenAI', credential: 'api_key', keyPlaceholder: 'sk-…', subscription: 'paste', signInDomains: ['openai.com'] },
    { id: 'google', label: 'Google (Gemini)', credential: 'api_key', keyPlaceholder: 'AIza…', subscription: null },
    { id: 'meta', label: 'Meta AI (MUSE)', credential: 'api_key', keyPlaceholder: 'meta-…', subscription: null },
    // A Kimi Code subscription issues no API key at all — its own config leaves `api_key`
    // empty beside an OAuth record — so it connects by device-code redirect, never paste.
    { id: 'kimi', label: 'Kimi', credential: 'api_key', keyPlaceholder: 'sk-…', subscription: 'device', signInDomains: ['kimi.ai', 'kimi.com'] },
    { id: 'moonshot', label: 'Moonshot AI', credential: 'api_key', keyPlaceholder: 'sk-…', subscription: null },
    { id: 'qwen', label: 'Qwen', credential: 'api_key', keyPlaceholder: 'sk-…', subscription: null },
    { id: 'minimax', label: 'MiniMax', credential: 'api_key', keyPlaceholder: 'sk-…', subscription: null },
    { id: 'xai', label: 'xAI (Grok)', credential: 'api_key', keyPlaceholder: 'xai-…', subscription: 'paste', signInDomains: ['x.ai'] },
    { id: 'ollama', label: 'Ollama Cloud', credential: 'api_key', keyPlaceholder: 'sk-…', subscription: null },
    {
        id: 'ollama-local', label: 'Ollama', credential: 'local_runtime', keyPlaceholder: '', subscription: null,
        localRuntime: { defaultBaseUrl: 'http://127.0.0.1:11434', exampleModel: 'llama3.1:8b' },
    },
    // FreeToken's engine default; it serves whatever model the tenant loaded, so no example.
    {
        id: 'freetoken', label: 'FreeToken', credential: 'local_runtime', keyPlaceholder: '', subscription: null,
        localRuntime: { defaultBaseUrl: 'http://127.0.0.1:1919' },
    },
];
/** Every BYO provider id, in listing order. */
export const LLM_PROVIDERS = LLM_PROVIDER_INFO.map((p) => p.id);
const INFO_BY_ID = new Map(LLM_PROVIDER_INFO.map((p) => [p.id, p]));
export function isLlmProvider(value) {
    return typeof value === 'string' && INFO_BY_ID.has(value);
}
/** The data for one provider. Total over {@link LlmProvider}. */
export function llmProviderInfo(id) {
    return INFO_BY_ID.get(id);
}
/** Whether the provider offers a consumer-subscription (OAuth) connect. */
export function supportsSubscription(id) {
    return llmProviderInfo(id).subscription !== null;
}
/**
 * Whether `url` is a provider's subscription sign-in page: https, on one of the
 * `signInDomains` of a provider that offers a subscription connect. The gate a host
 * applies before opening a page a webview asked for.
 */
export function isSubscriptionSignInUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return false;
    }
    if (parsed.protocol !== 'https:')
        return false;
    const host = parsed.hostname.toLowerCase();
    return LLM_PROVIDER_INFO.some((p) => (p.signInDomains ?? []).some((domain) => host === domain || host.endsWith(`.${domain}`)));
}
//# sourceMappingURL=providers.js.map