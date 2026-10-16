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

export type LlmProvider =
  | 'anthropic' | 'openai' | 'google' | 'meta' | 'kimi' | 'moonshot' | 'qwen' | 'minimax' | 'xai'
  | 'ollama' | 'ollama-local' | 'freetoken';

/**
 * How a provider's credential is supplied.
 *  - `api_key`: a pasted vendor key (optionally alongside a subscription connect).
 *  - `local_runtime`: a tenant's OWN self-hosted engine, configured by base URL + the
 *    one model it serves (+ an optional key) — reached only through the tenant's
 *    connected runtime, never from the cloud directly.
 */
export type LlmProviderCredential = 'api_key' | 'local_runtime';

/**
 * How a consumer-subscription (OAuth) connect FINISHES, for a provider that offers one.
 *  - `paste`: the operator copies a code back from the provider's page.
 *  - `device`: nothing to copy — the code rides in the URL and the host polls.
 */
export type LlmProviderSubscriptionGrant = 'paste' | 'device';

/** Connect hints for a `local_runtime` provider — literal examples, never translated. */
export interface LlmLocalRuntimeHints {
  /** The address the runtime listens on by default (its own localhost). */
  readonly defaultBaseUrl: string;
  /** An example model id the runtime serves, when one is conventional. */
  readonly exampleModel?: string;
}

export interface LlmProviderInfo {
  readonly id: LlmProvider;
  /** Brand display name — literal, never translated. A `local_runtime` entry carries
   *  the bare brand; a host adds its own localized "self-hosted" qualifier. */
  readonly label: string;
  readonly credential: LlmProviderCredential;
  /** Format hint for the API-key input — literal. Empty for a `local_runtime`. */
  readonly keyPlaceholder: string;
  /** The subscription connect this provider offers, or `null` for key-only. */
  readonly subscription: LlmProviderSubscriptionGrant | null;
  /** Present exactly when `credential` is `local_runtime`. */
  readonly localRuntime?: LlmLocalRuntimeHints;
}

/** Every BYO provider, in the order hosts list them. */
export const LLM_PROVIDER_INFO: readonly LlmProviderInfo[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', credential: 'api_key', keyPlaceholder: 'sk-ant-…', subscription: 'paste' },
  { id: 'openai',    label: 'OpenAI',             credential: 'api_key', keyPlaceholder: 'sk-…',     subscription: 'paste' },
  { id: 'google',    label: 'Google (Gemini)',    credential: 'api_key', keyPlaceholder: 'AIza…',    subscription: null },
  { id: 'meta',      label: 'Meta AI (MUSE)',     credential: 'api_key', keyPlaceholder: 'meta-…',   subscription: null },
  // A Kimi Code subscription issues no API key at all — its own config leaves `api_key`
  // empty beside an OAuth record — so it connects by device-code redirect, never paste.
  { id: 'kimi',      label: 'Kimi',               credential: 'api_key', keyPlaceholder: 'sk-…',     subscription: 'device' },
  { id: 'moonshot',  label: 'Moonshot AI',        credential: 'api_key', keyPlaceholder: 'sk-…',     subscription: null },
  { id: 'qwen',      label: 'Qwen',               credential: 'api_key', keyPlaceholder: 'sk-…',     subscription: null },
  { id: 'minimax',   label: 'MiniMax',            credential: 'api_key', keyPlaceholder: 'sk-…',     subscription: null },
  { id: 'xai',       label: 'xAI (Grok)',         credential: 'api_key', keyPlaceholder: 'xai-…',    subscription: 'paste' },
  { id: 'ollama',    label: 'Ollama Cloud',       credential: 'api_key', keyPlaceholder: 'sk-…',     subscription: null },
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
export const LLM_PROVIDERS: readonly LlmProvider[] = LLM_PROVIDER_INFO.map((p) => p.id);

const INFO_BY_ID: ReadonlyMap<string, LlmProviderInfo> = new Map(LLM_PROVIDER_INFO.map((p) => [p.id, p]));

export function isLlmProvider(value: unknown): value is LlmProvider {
  return typeof value === 'string' && INFO_BY_ID.has(value);
}

/** The data for one provider. Total over {@link LlmProvider}. */
export function llmProviderInfo(id: LlmProvider): LlmProviderInfo {
  return INFO_BY_ID.get(id)!;
}

/** Whether the provider offers a consumer-subscription (OAuth) connect. */
export function supportsSubscription(id: LlmProvider): boolean {
  return llmProviderInfo(id).subscription !== null;
}
