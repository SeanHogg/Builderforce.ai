import { VendorFatalError, VendorRetryableError, type AiModelTier, type VendorCallParams, type VendorCallResult, type VendorEnv, type VendorModule, type VendorStreamResult } from './types';
import { pseudoStreamFromCall } from './pseudoStream';
import { buildResponsesBody, normalizeResponsesPayload, type ResponsesPayload } from './responsesApi';

const ENDPOINT = 'https://api.x.ai/v1/responses';

async function call(params: VendorCallParams): Promise<VendorCallResult> {
  // Request/response translation lives in the SHARED Responses helper, not here — the
  // hand-rolled copy in this vendor never read `params.toolChoice`, so a pinned or
  // forced tool degraded to `auto` on Grok with no error.
  const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${params.apiKey}` }, body: JSON.stringify(buildResponsesBody(params)), signal: params.signal });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 1000);
    if (response.status === 400 || response.status === 422) throw new VendorFatalError('xai-oauth', response.status, message);
    throw new VendorRetryableError('xai-oauth', params.model, response.status, message);
  }
  return normalizeResponsesPayload(await response.json() as ResponsesPayload);
}

export const xaiOAuthModule: VendorModule = {
  id: 'xai-oauth', autoRoute: false,
  catalog: [{ id: 'grok-4.3', label: 'Grok 4.3', brand: 'xAI SuperGrok', tier: 'ULTRA', capabilities: ['tools', 'structured_output', 'vision'], contextWindow: 1000000 }],
  tierFor(): AiModelTier { return 'ULTRA'; },
  apiKeyFrom(env: VendorEnv): string | null { return env.XAI_OAUTH_TOKEN ?? null; },
  call,
  // Responses API has no OpenAI-shaped SSE of its own, so the completed call is
  // replayed through the SHARED pseudo-stream adapter (which carries `usage` and
  // `model` — this vendor's hand-rolled version dropped both, so every Grok turn
  // reported no tokens to the client).
  async callStream(params: VendorCallParams): Promise<VendorStreamResult> {
    return pseudoStreamFromCall(await call(params), params);
  },
};
