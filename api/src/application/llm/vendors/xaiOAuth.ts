import { CAPACITY_LIMIT_MARKER, VendorFatalError, VendorRetryableError, fetchWithVendorTimeout, isCapacityLimitBody, type AiModelTier, type VendorCallParams, type VendorCallResult, type VendorEnv, type VendorModule, type VendorStreamResult } from './types';
import { pseudoStreamFromCall } from './pseudoStream';
import { peekResponsesStreamError, responsesStreamResponse } from './responsesStream';
import { buildResponsesBody, normalizeResponsesPayload, type ResponsesPayload } from './responsesApi';
import {
  REASONING_INCLUDE, nextReasoningChain, reasoningReplayKey, toolTurnCallIds, withReplayedReasoning,
  type ReasoningChain,
} from './reasoningReplay';

const ENDPOINT = 'https://api.x.ai/v1/responses';

/**
 * Opt-in to xAI's server-side loop detector on a streamed request, the way xAI's own
 * client (grok-build `xai-grok-sampler`) does. The value is the detector window in
 * tokens (honoured 512–4096; grok-build's default 1024). The server then reports loops
 * mid-stream as `response.doom_loop_check` frames, which the shared translator turns
 * into a stream failure (`responsesStream.ts`) so the turn fails over instead of
 * decaying — chat #106's Grok counted to 593 with nothing to stop it.
 */
const DOOM_LOOP_CHECK_HEADER = 'x-grok-doom-loop-check';
const DOOM_LOOP_WINDOW_TOKENS = 1024;

/**
 * Tool turns looked back over for a saved chain. A run starts on one model and hands the
 * coding to another (`modelRoles.ts`), so when Grok is called again the newest tool turns
 * are usually the coder's, whose calls were never saved here.
 */
const REASONING_LOOKBACK_TURNS = 8;

/**
 * The reasoning chain this request replays: the newest saved one among its recent tool
 * turns. Empty on any miss or failure — a request without replay is exactly the request
 * this vendor always sent, so the store can never break a turn.
 */
async function loadReasoningChain(params: VendorCallParams): Promise<ReasoningChain> {
  const store = params.reasoningReplay;
  const callIds = toolTurnCallIds(params.messages).slice(0, REASONING_LOOKBACK_TURNS);
  if (!store || callIds.length === 0) return {};
  const load = async (callId: string): Promise<ReasoningChain | null> => {
    try {
      return await store.load(await reasoningReplayKey(params.apiKey, callId));
    } catch {
      return null;
    }
  };
  // The newest turn alone first: in a loop Grok is driving, that one read is the whole cost.
  const newest = await load(callIds[0]!);
  if (newest) return newest;
  const older = await Promise.all(callIds.slice(1).map(load));
  return older.find((chain): chain is ReasoningChain => chain !== null) ?? {};
}

/** Save the chain once a turn completes. Best-effort: losing it costs only the next turn's continuity. */
async function saveReasoningChain(
  params: VendorCallParams,
  prior: ReasoningChain,
  items: ReadonlyArray<Record<string, unknown>>,
): Promise<void> {
  const next = params.reasoningReplay ? nextReasoningChain(prior, items) : null;
  if (!next) return;
  try {
    await params.reasoningReplay!.save(await reasoningReplayKey(params.apiKey, next.firstCallId), next.chain);
  } catch {
    /* best-effort */
  }
}

/**
 * The Responses body, asking for encrypted reasoning (`store:false` is already set by the
 * shared builder) and carrying the chain back in front of the calls it led to.
 *
 * No output cap: Grok reasons before it answers and those reasoning tokens count against
 * `max_output_tokens`, so the composer's 4096 ceiling cut turns off mid-tool-call with
 * nothing usable to show for them. The subscription is flat-rate; the model's own ceiling
 * applies.
 */
function requestBody(params: VendorCallParams, chain: ReasoningChain, extra?: Record<string, unknown>): Record<string, unknown> {
  const body = buildResponsesBody(params, { extra: { include: [REASONING_INCLUDE], ...extra }, omitMaxOutputTokens: true });
  return Object.keys(chain).length > 0
    ? { ...body, input: withReplayedReasoning(body['input'] as Array<Record<string, unknown>>, chain) }
    : body;
}

/**
 * Issue the Responses request and classify a non-2xx answer, returning the still-unread
 * upstream `Response`. Shared by both surfaces so the capacity/entitlement classification
 * below cannot drift between the streamed and non-streamed paths.
 *
 * `extra` carries the per-surface request delta — only `{ stream: true }` today.
 */
async function xaiFetch(params: VendorCallParams, chain: ReasoningChain, extra?: Record<string, unknown>): Promise<Response> {
  // Request/response translation lives in the SHARED Responses helper, not here — the
  // hand-rolled copy in this vendor never read `params.toolChoice`, so a pinned or
  // forced tool degraded to `auto` on Grok with no error.
  const streamed = extra?.stream === true;
  const send = (replay: ReasoningChain): Promise<Response> => {
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${params.apiKey}`,
        ...(streamed ? { [DOOM_LOOP_CHECK_HEADER]: String(DOOM_LOOP_WINDOW_TOKENS) } : {}),
      },
      body: JSON.stringify(requestBody(params, replay, extra)),
    };
    // A STREAM's headers arrive as soon as generation starts, so a deadline on them bounds a
    // hung upstream (this call had none, and a stalled Grok held a turn for minutes) without
    // bounding a long answer — the timer clears once headers land. The buffered call only
    // answers when the whole generation exists, so it keeps the caller's signal alone.
    return streamed
      ? fetchWithVendorTimeout('xai-oauth', params.model, ENDPOINT, init, params.timeoutMs, params.signal)
      : fetch(ENDPOINT, { ...init, signal: params.signal });
  };
  let response = await send(chain);
  // Replayed reasoning is the one thing in this body the request never carried before.
  // If xAI refuses the request with it, send it once more without — a turn that loses
  // its prior reasoning is the old behaviour, never a new way to fail.
  if ((response.status === 400 || response.status === 422) && Object.keys(chain).length > 0) {
    await response.body?.cancel().catch(() => undefined);
    response = await send({});
  }
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

/** The buffered call, for a chain already loaded — shared by `call` and the stream fallback. */
async function callWith(params: VendorCallParams, chain: ReasoningChain): Promise<VendorCallResult> {
  const response = await xaiFetch(params, chain);
  const payload = await response.json() as ResponsesPayload;
  await saveReasoningChain(params, chain, (payload.output ?? []) as Array<Record<string, unknown>>);
  return normalizeResponsesPayload(payload);
}

async function call(params: VendorCallParams): Promise<VendorCallResult> {
  return callWith(params, await loadReasoningChain(params));
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
  const chain = await loadReasoningChain(params);
  let response: Response;
  try {
    response = await xaiFetch(params, chain, { stream: true });
  } catch (error) {
    if (!(error instanceof VendorFatalError)) throw error;
    return pseudoStreamFromCall(await callWith(params, chain), params);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.body || !contentType.includes('text/event-stream')) {
    const payload = await response.json() as ResponsesPayload;
    await saveReasoningChain(params, chain, (payload.output ?? []) as Array<Record<string, unknown>>);
    return pseudoStreamFromCall(normalizeResponsesPayload(payload), params);
  }
  const body = await peekResponsesStreamError(response.body, 'xai-oauth', params.model);
  return {
    response: responsesStreamResponse(body, params.model, {
      onTurnComplete: (items) => saveReasoningChain(params, chain, items),
    }),
  };
}

export const xaiOAuthModule: VendorModule = {
  id: 'xai-oauth', autoRoute: false,
  // Keep the subscription route on xAI's current stable model. Pinning the stale
  // grok-4.3 id made model availability indistinguishable from a real plan rejection:
  // both surfaced as the same 403 and told the owner to upgrade. grok-4.6 (Aug 2026)
  // is the flagship xAI's docs recommend for code; grok-4.5 stays routable for a
  // workspace that pinned it.
  catalog: [
    { id: 'grok-4.6', label: 'Grok 4.6', brand: 'xAI SuperGrok', tier: 'ULTRA', capabilities: ['tools', 'structured_output', 'vision'], contextWindow: 500000 },
    { id: 'grok-4.5', label: 'Grok 4.5', brand: 'xAI SuperGrok', tier: 'ULTRA', capabilities: ['tools', 'structured_output', 'vision'], contextWindow: 500000 },
  ],
  tierFor(): AiModelTier { return 'ULTRA'; },
  apiKeyFrom(env: VendorEnv): string | null { return env.XAI_OAUTH_TOKEN ?? null; },
  call,
  // The Responses API's own SSE is not OpenAI-chat-shaped, so it is TRANSLATED
  // frame-by-frame by the shared `responsesStream` adapter rather than buffered and
  // replayed. `usage` and `model` still ride the trailing chunk `readUsage` expects.
  callStream,
};
