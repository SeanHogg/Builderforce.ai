import { request, type LlmProvider } from './builderforceApi';

/**
 * Typed client for a connected provider's MODEL SELECTION — the models its public catalog
 * lists (marked with what the tenant's key can call) and the tenant's ordered choice.
 * Mirrors `api/src/presentation/routes/providerModelRoutes.ts`.
 */

export interface ProviderModelChoice {
  /** The provider's bare model id (`deepseek-v4-flash`). */
  id: string;
  /** Seen in the key's own model list — `null` when that list could not be read. */
  onAccount: boolean | null;
  /** Listed in the provider's public catalog. */
  inCatalog: boolean;
}

export interface ProviderModelsView {
  /** The provider offers a model choice at all. */
  supported: boolean;
  connected: boolean;
  /** The key's own model list was read, so `onAccount` is a real answer. */
  accountChecked: boolean;
  models: ProviderModelChoice[];
  /** The saved order; empty = the provider's default model. */
  selected: string[];
  maxSelected: number;
}

export const providerModelsApi = {
  list: (provider: LlmProvider): Promise<ProviderModelsView> =>
    request<ProviderModelsView>(`/llm/provider-keys/${provider}/models`),

  save: (provider: LlmProvider, models: string[]): Promise<{ ok: true; selected: string[] }> =>
    request<{ ok: true; selected: string[] }>(`/llm/provider-keys/${provider}/models`, {
      method: 'PUT',
      body: JSON.stringify({ models }),
    }),
};
