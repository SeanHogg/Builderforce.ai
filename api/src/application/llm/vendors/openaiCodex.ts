import { parseSseDataFrames } from '../sseFrames';
import { AUTH_STATUSES, VendorFatalError, VendorRetryableError, type AiModelTier, type VendorCallParams, type VendorCallResult, type VendorEnv, type VendorModule, type VendorStreamResult } from './types';
import { pseudoStreamFromCall } from './pseudoStream';
import { buildResponsesBody, normalizeResponsesPayload, type ResponsesPayload } from './responsesApi';

const ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';

/**
 * The ChatGPT Codex backend is NOT the public `api.openai.com/v1/responses`
 * surface — it is the private endpoint the Codex CLI talks to, and it only
 * accepts the CLI's request contract:
 *
 *  - `stream: true` + `accept: text/event-stream`. A non-streaming request is
 *    rejected outright, which is why a perfectly healthy subscription used to
 *    fail "Test connection" immediately after connecting.
 *  - the `OpenAI-Beta: responses=experimental` opt-in, plus the `originator`
 *    and `session_id` identity headers the backend expects from a CLI client.
 *  - `store: false` (server-side conversation state is not available here), and
 *    therefore `include: ['reasoning.encrypted_content']` so a reasoning model
 *    can carry its own state across turns.
 *
 * Everything else (the chat-completions <-> Responses translation) matches the
 * public Responses shape, so the surrounding gateway machinery is unchanged.
 */
const BETA_HEADER = 'responses=experimental';
const ORIGINATOR = 'codex_cli_rs';

/**
 * Stable marker embedded in the error a Codex 401/403 raises, so the failure is
 * machine-recognisable downstream instead of being one more opaque status.
 *
 * The producer is `callResponses`; the consumer is `providerAuthAlerts`, which
 * matches it on `FailoverEvent.detail` to raise the operator-facing "reconnect
 * your ChatGPT account" prompt. Shared here so producer and consumer can't drift
 * (same pattern as {@link CAPACITY_LIMIT_MARKER} in `vendors/types.ts`).
 */
export const CODEX_AUTH_MARKER = 'chatgpt account not entitled to codex';

type PackedAuth = { accessToken: string; accountId: string };

function unpack(value: string): PackedAuth {
  const auth = JSON.parse(value) as PackedAuth;
  if (!auth.accessToken || !auth.accountId) throw new Error('Incomplete OpenAI Codex auth');
  return auth;
}

/**
 * The shared Responses body plus the two fields ONLY this backend requires: the CLI's
 * mandatory `stream: true`, and `include: ['reasoning.encrypted_content']` so a
 * reasoning model carries its own state across turns without server-side storage.
 *
 * `max_output_tokens` is OMITTED: unlike the public Responses surface, this backend
 * rejects it outright with `400 {"detail":"Unsupported parameter: max_output_tokens"}`,
 * failing the whole request before a token is generated. The Codex CLI does not send
 * it either, and the output ceiling here is a server-side per-model property, so
 * there is nothing to cap client-side. See {@link ResponsesBodyOptions.omitMaxOutputTokens}.
 */
function requestBody(params: VendorCallParams): Record<string, unknown> {
  return buildResponsesBody(params, {
    omitMaxOutputTokens: true,
    extra: { stream: true, include: ['reasoning.encrypted_content'] },
  });
}

/**
 * Collapse the Codex SSE stream into the single terminal `response` object.
 *
 * The backend emits incremental `response.output_text.delta` frames followed by
 * a terminal `response.completed` frame carrying the whole response (id, output
 * items, usage). We prefer the terminal frame and fall back to the accumulated
 * deltas when the stream ends without one. A `response.failed` / `error` frame
 * is an in-band upstream error and is raised, not silently returned as empty.
 */
function aggregateStream(raw: string, model: string): ResponsesPayload {
  let completed: ResponsesPayload | undefined;
  let deltaText = '';
  for (const frame of parseSseDataFrames(raw)) {
    const event = frame as { type?: string; response?: ResponsesPayload; delta?: unknown; error?: { message?: string } | string };
    if (event.type === 'response.completed' && event.response) {
      completed = event.response;
      continue;
    }
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      deltaText += event.delta;
      continue;
    }
    if (event.type === 'response.failed' || event.type === 'error') {
      const err = event.response?.error ?? event.error;
      const message = typeof err === 'string' ? err : err?.message ?? 'Codex stream failed';
      throw new VendorRetryableError('openai-codex', model, 502, message);
    }
  }
  if (completed) return completed;
  if (deltaText) return { output_text: deltaText };
  throw new VendorRetryableError('openai-codex', model, 502, 'Codex stream ended without a response');
}

/**
 * Read the upstream body as either the Codex SSE stream (the normal case) or a
 * plain JSON `response` object, so a backend that answers non-streaming still
 * works. Anything unparseable surfaces as a retryable upstream error rather
 * than a silently empty completion.
 */
async function readPayload(response: Response, model: string): Promise<ResponsesPayload> {
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream') || text.trimStart().startsWith('data:')) {
    return aggregateStream(text, model);
  }
  try {
    return JSON.parse(text) as ResponsesPayload;
  } catch {
    throw new VendorRetryableError('openai-codex', model, 502, text.slice(0, 500) || 'Unreadable Codex response');
  }
}

async function callResponses(params: VendorCallParams): Promise<VendorCallResult> {
  const auth = unpack(params.apiKey);
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${auth.accessToken}`,
      'ChatGPT-Account-Id': auth.accountId,
      'OpenAI-Beta': BETA_HEADER,
      originator: ORIGINATOR,
      session_id: crypto.randomUUID(),
    },
    body: JSON.stringify(requestBody(params)),
    signal: params.signal,
  });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 500);
    // AUTH class (401/403) is FATAL FOR THIS VENDOR, not a transient blip.
    //
    // A 403 here is the entitlement case: the ChatGPT account authenticated fine
    // (the bearer token is live) but is not entitled to Codex — a lapsed plan, a
    // plan without Codex access, or a stale `accountId` from a workspace the user
    // left. Retrying is guaranteed to 403 again until the OPERATOR reconnects the
    // account, so this must not look like an outage the cascade can outwait.
    //
    // We still raise a RETRYABLE error rather than `VendorFatalError`, because
    // "fatal for this vendor" ≠ "fatal for the run": the dispatcher rethrows a
    // VendorFatalError outside 400/422 and would kill an otherwise-servable
    // request just because one connected BYO account lost entitlement. Raising it
    // retryable lets the cascade advance to the tenant's other accounts / the plan
    // pool, while `cooldownStore.classifyFailure` maps 401/403 to the `auth` class
    // — which trips a 30-minute VENDOR-level cooldown on a single strike, i.e. this
    // vendor genuinely stands down instead of being re-probed every request.
    //
    // The marker below is what makes the failure OBSERVABLE: it rides the attempt's
    // `error` text through `kindForStatus` → `kind: 'auth'` → `FailoverEvent.detail`,
    // where `providerAuthAlerts` picks it up and turns it into a "reconnect your
    // ChatGPT account" prompt on Settings ▸ API Keys. Before this, an unentitled
    // account was indistinguishable from a 502 and the operator was never told.
    if (AUTH_STATUSES.has(response.status)) {
      console.error(
        `[vendors] openai-codex/${params.model} auth ${response.status} — connected ChatGPT account is ${response.status === 403 ? 'authenticated but NOT entitled to Codex (lapsed plan / no Codex access / stale accountId)' : 'unauthenticated (token expired or revoked)'}; reconnect it in Settings ▸ API Keys. Failing over to the next model.`,
        message.slice(0, 200),
      );
      throw new VendorRetryableError(
        'openai-codex',
        params.model,
        response.status,
        `${CODEX_AUTH_MARKER} (upstream ${response.status}): ${message.slice(0, 200)}`,
      );
    }
    if (response.status === 400 || response.status === 422) throw new VendorFatalError('openai-codex', response.status, message);
    throw new VendorRetryableError('openai-codex', params.model, response.status, message);
  }
  return normalizeResponsesPayload(await readPayload(response, params.model));
}

export const openAiCodexModule: VendorModule = {
  id: 'openai-codex', autoRoute: false,
  catalog: [{ id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', brand: 'OpenAI Codex', tier: 'ULTRA', capabilities: ['tools', 'structured_output', 'vision'], contextWindow: 400000 }],
  tierFor(): AiModelTier { return 'ULTRA'; },
  apiKeyFrom(env: VendorEnv): string | null { return env.OPENAI_CODEX_AUTH ?? null; },
  call: callResponses,
  // The Codex backend's own SSE is Responses-shaped, not OpenAI-chat-shaped, so the
  // completed call is replayed through the SHARED pseudo-stream adapter (which
  // carries `usage` and `model` — the hand-rolled version here dropped both).
  async callStream(params: VendorCallParams): Promise<VendorStreamResult> {
    return pseudoStreamFromCall(await callResponses(params), params);
  },
};
