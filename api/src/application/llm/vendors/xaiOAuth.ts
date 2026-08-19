import { CAPACITY_LIMIT_MARKER, VendorFatalError, VendorRetryableError, isCapacityLimitBody, type AiModelTier, type VendorCallParams, type VendorCallResult, type VendorEnv, type VendorModule, type VendorStreamResult } from './types';
import { pseudoStreamFromCall } from './pseudoStream';
import { peekResponsesStreamError, responsesStreamResponse } from './responsesStream';
import { buildResponsesBody, normalizeResponsesPayload, type ResponsesPayload } from './responsesApi';

const ENDPOINT = 'https://api.x.ai/v1/responses';

/**
 * Issue the Responses request and classify a non-2xx answer, returning the still-unread
 * upstream `Response`. Shared by both surfaces so the capacity/entitlement classification
 * below cannot drift between the streamed and non-streamed paths.
 *
 * `extra` carries the per-surface request delta — only `{ stream: true }` today.
 */
async function xaiFetch(params: VendorCallParams, extra?: Record<string, unknown>): Promise<Response> {
  // Request/response translation lives in the SHARED Responses helper, not here — the
  // hand-rolled copy in this vendor never read `params.toolChoice`, so a pinned or
  // forced tool degraded to `auto` on Grok with no error.
  const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${params.apiKey}` }, body: JSON.stringify(buildResponsesBody(params, extra ? { extra } : undefined)), signal: params.signal });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 1000);
    // xAI reports a depleted weekly SuperGrok/API allowance as 403 — the same
    // status it uses for a genuine entitlement rejection. Preserve the actual HTTP
    // status, but tag the detail so cooldown + operator remediation classify it as
    // capacity (wait for reset / buy credits), never "reconnect or upgrade access".
    if (isCapacityLimitBody(message)) {
      throw new VendorRetryableError(
        'xai-oauth', params.model, response.status,
        `${CAPACITY_LIMIT_MARKER} (upstream ${response.status}): ${message.slice(0, 200)}`,
      );
    }
    if (response.status === 400 || response.status === 422) throw new VendorFatalError('xai-oauth', response.status, message);
    throw new VendorRetryableError('xai-oauth', params.model, response.status, message);
  }
  return response;
}

async function call(params: VendorCallParams): Promise<VendorCallResult> {
  const response = await xaiFetch(params);
  return normalizeResponsesPayload(await response.json() as ResponsesPayload);
}

/**
 * TRUE passthrough streaming, with a self-healing fallback.
 *
 * This used to run the non-streamed call to completion and replay it as one synthetic
 * chunk, so a long Grok answer showed nothing until it was entirely generated. The
 * Responses surface streams natively under `stream: true`, and the frames it emits are
 * the same ones the Codex backend emits, so the SHARED translator handles both.
 *
 * A backend that REFUSES the streaming request (400/422 — a fatal-for-this-vendor
 * classification) falls back to the non-streamed call plus the one-shot replay rather
 * than failing the turn: streaming is a latency improvement, never a new way to break
 * a working Grok credential.
 */
async function callStream(params: VendorCallParams): Promise<VendorStreamResult> {
  let response: Response;
  try {
    response = await xaiFetch(params, { stream: true });
  } catch (error) {
    if (!(error instanceof VendorFatalError)) throw error;
    return pseudoStreamFromCall(await call(params), params);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.body || !contentType.includes('text/event-stream')) {
    return pseudoStreamFromCall(normalizeResponsesPayload(await response.json() as ResponsesPayload), params);
  }
  const body = await peekResponsesStreamError(response.body, 'xai-oauth', params.model);
  return { response: responsesStreamResponse(body, params.model) };
}

export const xaiOAuthModule: VendorModule = {
  id: 'xai-oauth', autoRoute: false,
  // Keep the subscription route on xAI's current stable model. Pinning the stale
  // grok-4.3 id made model availability indistinguishable from a real plan rejection:
  // both surfaced as the same 403 and told the owner to upgrade.
  catalog: [{ id: 'grok-4.5', label: 'Grok 4.5', brand: 'xAI SuperGrok', tier: 'ULTRA', capabilities: ['tools', 'structured_output', 'vision'], contextWindow: 500000 }],
  tierFor(): AiModelTier { return 'ULTRA'; },
  apiKeyFrom(env: VendorEnv): string | null { return env.XAI_OAUTH_TOKEN ?? null; },
  call,
  // The Responses API's own SSE is not OpenAI-chat-shaped, so it is TRANSLATED
  // frame-by-frame by the shared `responsesStream` adapter rather than buffered and
  // replayed. `usage` and `model` still ride the trailing chunk `readUsage` expects.
  callStream,
};
