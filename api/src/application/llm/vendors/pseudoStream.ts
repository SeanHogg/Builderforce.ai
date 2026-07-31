/**
 * pseudoStream — the ONE adapter that turns a non-streaming vendor `call()` into
 * the OpenAI-compatible SSE the gateway contract requires.
 *
 * Two vendors speak the OpenAI *Responses* API, which this codebase consumes
 * non-streamed and then replays as a single chunk: `xai-oauth` (Grok) and
 * `openai-codex` (GPT Codex). Both hand-rolled that replay, and both dropped the
 * same two fields on the floor:
 *
 *  • `usage` — the completion's token counts. The client
 *    (`streamChatCompletion`) only learns tokens from a chunk's `usage`, so every
 *    turn served by these vendors reported NO token usage at all. That is what
 *    made a copied Brain transcript say "Tokens: not reported by the gateway for
 *    this run", which in turn starved the A-vs-B triage of its main signal and
 *    left every such run classified `inconclusive`.
 *  • `model` — the resolved model id. The client falls back to the per-chunk
 *    `model` field whenever the `x-builderforce-model` header isn't readable
 *    (cross-origin without CORS exposure), so omitting it loses the provenance.
 *
 * Emitting usage in its OWN trailing chunk (choices: []) matches what real
 * OpenAI `stream_options: { include_usage: true }` does, which is exactly the
 * shape the client's `readUsage` already handles.
 */
import type { VendorCallParams, VendorCallResult, VendorStreamResult } from './types';

/** The OpenAI chat-completion shape a Responses-API `call()` normalizes into. */
interface NormalizedChatCompletion {
  id?: string;
  choices?: Array<{
    message?: { content?: string; tool_calls?: unknown[] };
    finish_reason?: string;
  }>;
  usage?: unknown;
}

/**
 * Replay a completed {@link VendorCallResult} as a one-shot SSE stream: the
 * content/tool-call chunk, then a usage-only chunk, then `[DONE]`.
 */
export function pseudoStreamFromCall(result: VendorCallResult, params: VendorCallParams): VendorStreamResult {
  const raw = result.raw as NormalizedChatCompletion;
  const choice = raw.choices?.[0];
  const id = raw.id ?? `chatcmpl_${crypto.randomUUID()}`;
  const toolCalls = choice?.message?.tool_calls;

  const chunk = {
    id,
    object: 'chat.completion.chunk',
    model: params.model,
    choices: [{
      index: 0,
      delta: {
        role: 'assistant',
        content: choice?.message?.content ?? '',
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: choice?.finish_reason ?? 'stop',
    }],
  };

  // Token counts ride their own trailing chunk, mirroring OpenAI's
  // `include_usage` behaviour. `result.usage` is the vendor-normalized copy;
  // `raw.usage` is the passthrough — prefer whichever is populated.
  const usage = result.usage && Object.keys(result.usage).length > 0 ? result.usage : raw.usage;
  const frames = [`data: ${JSON.stringify(chunk)}\n\n`];
  if (usage) {
    frames.push(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: params.model, choices: [], usage })}\n\n`);
  }
  frames.push('data: [DONE]\n\n');

  return { response: new Response(frames.join(''), { headers: { 'content-type': 'text/event-stream' } }) };
}
