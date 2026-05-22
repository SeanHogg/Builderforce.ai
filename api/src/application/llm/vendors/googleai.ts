/**
 * Google AI (Gemini) vendor module — direct call to Google's Generative Language
 * API via its OpenAI-compatible surface at
 * `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`.
 *
 * Used as the primary premium fallback for the gateway's cascade: after the
 * 2-attempt free budget is exhausted, the chain falls through here so callers
 * always see a successful response from a high-reliability paid endpoint.
 *
 * All catalog entries are classified PREMIUM — even `gemini-2.5-flash-lite`,
 * the cheapest model, is paid and reserved for fallback rather than primary
 * Free-pool rotation. Authenticates with `GOOGLE_API_KEY`.
 */

import {
  executeChatCompletion,
  executeChatCompletionStream,
  type AiModelTier,
  type VendorCallParams,
  type VendorCallResult,
  type VendorModelEntry,
  type VendorModule,
  type VendorStreamResult,
} from './types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

const CATALOG: ReadonlyArray<VendorModelEntry> = [
  { id: 'gemini-2.5-flash',      tier: 'PREMIUM', label: 'Gemini 2.5 Flash (Google AI)',      brand: 'Google' },
  { id: 'gemini-2.5-flash-lite', tier: 'PREMIUM', label: 'Gemini 2.5 Flash Lite (Google AI)', brand: 'Google' },
  { id: 'gemini-2.5-pro',        tier: 'PREMIUM', label: 'Gemini 2.5 Pro (Google AI)',        brand: 'Google' },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function tierForGoogleAiModel(modelId: string): AiModelTier {
  return CATALOG_BY_ID.get(modelId)?.tier ?? 'PREMIUM';
}

function buildBody(params: VendorCallParams): Record<string, unknown> {
  const { model, messages, tools, toolChoice, maxTokens, temperature, topP, extraBody } = params;
  return {
    model,
    messages,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
    ...(temperature != null ? { temperature } : {}),
    ...(topP != null ? { top_p: topP } : {}),
    ...(extraBody ?? {}),
  };
}

export const googleAiModule: VendorModule = {
  id: 'googleai',
  catalog: CATALOG,
  tierFor: tierForGoogleAiModel,
  apiKeyFrom(env) { return env.GOOGLE_API_KEY ?? null; },
  async call(params: VendorCallParams): Promise<VendorCallResult> {
    return executeChatCompletion({
      vendorId: 'googleai',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: { ...buildBody(params), stream: false },
      ...(params.title ? { title: params.title } : {}),
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
    });
  },
  async callStream(params: VendorCallParams): Promise<VendorStreamResult> {
    return executeChatCompletionStream({
      vendorId: 'googleai',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: buildBody(params),
      ...(params.title ? { title: params.title } : {}),
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
    });
  },
};
