import { parseSseDataFrames } from '../sseFrames';
import { AUTH_STATUSES, VendorFatalError, VendorRetryableError, pickUsage, type AiModelTier, type VendorCallParams, type VendorCallResult, type VendorEnv, type VendorModule, type VendorStreamResult } from './types';
import { pseudoStreamFromCall } from './pseudoStream';

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

/** The Responses API rejects `max_output_tokens` below this. The connection
 *  test asks for a handful of tokens, so it must be floored rather than passed
 *  through verbatim. */
const MIN_OUTPUT_TOKENS = 16;

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

function requestBody(params: VendorCallParams): Record<string, unknown> {
  const tools = params.tools?.map((raw) => {
    const tool = raw as { type?: string; function?: { name?: string; description?: string; parameters?: unknown } };
    return tool.type === 'function' && tool.function ? { type: 'function', ...tool.function } : raw;
  });
  const instructions = params.messages
    .filter((message) => message['role'] === 'system' || message['role'] === 'developer')
    .map((message) => typeof message['content'] === 'string' ? message['content'] : JSON.stringify(message['content'] ?? ''))
    .filter(Boolean)
    .join('\n\n') || 'You are a helpful assistant.';
  const input = params.messages
    .filter((message) => message['role'] !== 'system' && message['role'] !== 'developer')
    .flatMap((message) => {
    const role = String(message['role'] ?? 'user');
    if (role === 'tool') {
      return [{ type: 'function_call_output', call_id: String(message['tool_call_id'] ?? ''), output: typeof message['content'] === 'string' ? message['content'] : JSON.stringify(message['content'] ?? '') }];
    }
    const items: Array<Record<string, unknown>> = [];
    if (message['content'] !== undefined && message['content'] !== null && message['content'] !== '') {
      const content = typeof message['content'] === 'string'
        ? [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: message['content'] }]
        : message['content'];
      items.push({ role, content });
    }
    if (role === 'assistant' && Array.isArray(message['tool_calls'])) {
      for (const raw of message['tool_calls']) {
        const call = raw as { id?: string; function?: { name?: string; arguments?: string } };
        items.push({ type: 'function_call', call_id: call.id ?? '', name: call.function?.name ?? '', arguments: call.function?.arguments ?? '{}' });
      }
    }
    return items;
  });
  const rawChoice = params.toolChoice as { type?: string; function?: { name?: string } } | string | undefined;
  const toolChoice = rawChoice && typeof rawChoice === 'object' && rawChoice.type === 'function'
    ? { type: 'function', name: rawChoice.function?.name }
    : rawChoice;
  const maxOutputTokens = params.maxTokens ? Math.max(params.maxTokens, MIN_OUTPUT_TOKENS) : undefined;
  return {
    model: params.model,
    instructions,
    input,
    store: false,
    stream: true,
    include: ['reasoning.encrypted_content'],
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
  };
}

type ResponsesPayload = {
  id?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }>; name?: string; arguments?: string; call_id?: string }>;
  output_text?: string;
  usage?: unknown;
  error?: { message?: string } | string;
};

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
  const raw = await readPayload(response, params.model);
  const content = raw.output_text ?? raw.output?.flatMap((item) => item.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join('') ?? '';
  const toolCalls = raw.output?.filter((item) => item.type === 'function_call').map((item, index) => ({ id: item.call_id ?? `call_${index}`, type: 'function', function: { name: item.name ?? '', arguments: item.arguments ?? '{}' } })) ?? [];
  const usage = pickUsage(raw.usage);
  const chatRaw = { id: raw.id ?? `chatcmpl_${crypto.randomUUID()}`, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }], usage };
  return { raw: chatRaw, content, usage };
}

export const openAiCodexModule: VendorModule = {
  id: 'openai-codex', autoRoute: false,
  catalog: [{ id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', brand: 'OpenAI Codex', tier: 'ULTRA', capabilities: ['tools', 'structured_output', 'vision'], contextWindow: 400000 }],
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
