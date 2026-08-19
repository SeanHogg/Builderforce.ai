/**
 * responsesStream — the ONE Responses-API-SSE → OpenAI-chat-SSE passthrough.
 *
 * The third piece of the shared Responses path, alongside {@link ./responsesApi}
 * (request/response translation) and {@link ./pseudoStream} (the one-shot replay).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Both Responses vendors (`openai-codex`, `xai-oauth`) used to answer `callStream`
 * by running the NON-streaming call to completion and then replaying the finished
 * answer as a single synthetic `chat.completion.chunk`. Functionally correct, but
 * it threw away the whole point of streaming: a consumer reading a long Codex
 * answer waited for the entire generation before seeing its first token. The Codex
 * backend has always emitted real `response.output_text.delta` frames — we were
 * buffering them and then pretending.
 *
 * This module transforms those frames as they arrive:
 *
 *   response.created                       → capture the response id
 *   response.output_text.delta             → a content delta chunk
 *   response.output_item.added(function_call)
 *                                          → open a tool_call slot (id + name)
 *   response.function_call_arguments.delta → an arguments delta on that slot
 *   response.completed                     → finish_reason chunk, then the
 *                                            usage-only chunk, then `[DONE]`
 *   response.failed / error                → an OpenAI-shaped error frame
 *
 * The emitted shape is byte-for-byte the contract {@link pseudoStreamFromCall}
 * already produces (content/tool_calls chunk → usage-only chunk → `[DONE]`), so
 * every downstream consumer — `streamChatCompletion`'s `readUsage`, the per-chunk
 * `model` provenance fallback — is unchanged. Only the arrival time differs.
 *
 * IN-BAND FAILURES: a Responses stream can answer `200 OK` and then fail in a
 * `response.failed` frame. {@link peekResponsesStreamError} tees the body and
 * inspects the first chunk for exactly that, mirroring `executeChatCompletionStream`'s
 * first-chunk sniff, so an upstream failure still raises a retryable vendor error
 * the cascade can act on instead of surfacing as an empty answer.
 */
import { parseSseDataFrames, parseSseDataLine } from '../sseFrames';
import { pickUsage, VendorRetryableError, type VendorId } from './types';

/** The Responses stream events this transform reads. Anything else is ignored. */
interface ResponsesStreamEvent {
  type?: string;
  delta?: unknown;
  output_index?: number;
  item?: { type?: string; call_id?: string; id?: string; name?: string };
  response?: { id?: string; usage?: unknown; error?: { message?: string } | string };
  error?: { message?: string } | string;
}

/** The chunk envelope every emitted frame shares. */
function chunk(id: string, model: string, body: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, ...body })}\n\n`;
}

/** Read the human-readable message out of a `response.failed` / `error` frame. */
function errorMessage(event: ResponsesStreamEvent): string {
  const err = event.response?.error ?? event.error;
  if (typeof err === 'string') return err;
  return err?.message ?? 'Responses stream failed';
}

/**
 * Tee `body`, read its first chunk, and raise a retryable vendor error when that
 * chunk already carries an in-band failure. Returns the leg to keep reading.
 *
 * Same contract as `executeChatCompletionStream`'s peek: an upstream that answers
 * 200 and then fails must still look like a vendor failure to the cascade, not
 * like a successful empty completion.
 */
export async function peekResponsesStreamError(
  body: ReadableStream<Uint8Array>,
  vendorId: VendorId,
  model: string,
): Promise<ReadableStream<Uint8Array>> {
  const [peek, pass] = body.tee();
  const reader = peek.getReader();
  const { value } = await reader.read();
  reader.cancel().catch(() => undefined);
  const text = value ? new TextDecoder().decode(value) : '';
  if (!text.includes('"error"') && !text.includes('response.failed')) return pass;
  for (const frame of parseSseDataFrames(text)) {
    const event = frame as ResponsesStreamEvent;
    if (event.type === 'response.failed' || event.type === 'error' || event.error) {
      await pass.cancel().catch(() => undefined);
      throw new VendorRetryableError(vendorId, model, 502, `embedded chunk error: ${errorMessage(event).slice(0, 200)}`);
    }
  }
  return pass;
}

/**
 * Transform a Responses-API SSE body into an OpenAI-compatible chat SSE body,
 * emitting each delta as it arrives.
 *
 * Buffers only up to the next newline — never the whole generation — so the first
 * `response.output_text.delta` reaches the consumer as soon as the upstream sends it.
 */
export function responsesSseToChatSse(
  body: ReadableStream<Uint8Array>,
  opts: { model: string },
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';
  let responseId = `chatcmpl_${crypto.randomUUID()}`;
  let sawFirstDelta = false;
  let sawToolCall = false;
  let closed = false;
  /** Responses numbers its output items globally; chat numbers tool_calls from 0. */
  const toolSlotByOutputIndex = new Map<number, number>();

  /** Translate one parsed Responses frame into zero or more chat SSE frames. */
  function translate(event: ResponsesStreamEvent): string[] {
    const model = opts.model;
    switch (event.type) {
      case 'response.created':
        if (event.response?.id) responseId = event.response.id;
        return [];

      case 'response.output_text.delta': {
        if (typeof event.delta !== 'string' || event.delta === '') return [];
        const delta: Record<string, unknown> = sawFirstDelta
          ? { content: event.delta }
          : { role: 'assistant', content: event.delta };
        sawFirstDelta = true;
        return [chunk(responseId, model, { choices: [{ index: 0, delta, finish_reason: null }] })];
      }

      case 'response.output_item.added': {
        if (event.item?.type !== 'function_call') return [];
        const outputIndex = typeof event.output_index === 'number' ? event.output_index : toolSlotByOutputIndex.size;
        const slot = toolSlotByOutputIndex.size;
        toolSlotByOutputIndex.set(outputIndex, slot);
        sawToolCall = true;
        const toolCall = {
          index: slot,
          id: event.item.call_id ?? event.item.id ?? `call_${slot}`,
          type: 'function',
          function: { name: event.item.name ?? '', arguments: '' },
        };
        const delta: Record<string, unknown> = sawFirstDelta
          ? { tool_calls: [toolCall] }
          : { role: 'assistant', content: '', tool_calls: [toolCall] };
        sawFirstDelta = true;
        return [chunk(responseId, model, { choices: [{ index: 0, delta, finish_reason: null }] })];
      }

      case 'response.function_call_arguments.delta': {
        if (typeof event.delta !== 'string' || event.delta === '') return [];
        const outputIndex = typeof event.output_index === 'number' ? event.output_index : 0;
        const slot = toolSlotByOutputIndex.get(outputIndex) ?? 0;
        return [chunk(responseId, model, {
          choices: [{
            index: 0,
            delta: { tool_calls: [{ index: slot, function: { arguments: event.delta } }] },
            finish_reason: null,
          }],
        })];
      }

      case 'response.completed': {
        if (closed) return [];
        closed = true;
        const frames = [chunk(responseId, model, {
          choices: [{ index: 0, delta: {}, finish_reason: sawToolCall ? 'tool_calls' : 'stop' }],
        })];
        // Token counts ride their own trailing chunk, mirroring OpenAI's
        // `include_usage` behaviour — the only shape `readUsage` reads.
        const usage = pickUsage(event.response?.usage);
        if (usage && Object.keys(usage).length > 0) {
          frames.push(chunk(responseId, model, { choices: [], usage }));
        }
        frames.push('data: [DONE]\n\n');
        return frames;
      }

      case 'response.failed':
      case 'error': {
        if (closed) return [];
        closed = true;
        return [
          `data: ${JSON.stringify({ error: { message: errorMessage(event), type: 'upstream_error' } })}\n\n`,
          'data: [DONE]\n\n',
        ];
      }

      default:
        return [];
    }
  }

  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          // An upstream that ends without `response.completed` still owes the
          // consumer a terminated stream, or the reader hangs until timeout.
          if (!closed) {
            closed = true;
            controller.enqueue(encoder.encode(chunk(responseId, opts.model, {
              choices: [{ index: 0, delta: {}, finish_reason: sawToolCall ? 'tool_calls' : 'stop' }],
            })));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          }
          controller.close();
          return;
        }
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        // The trailing element is whatever arrived after the last newline — an
        // incomplete frame that must wait for the next read.
        pending = lines.pop() ?? '';
        let emitted = false;
        for (const line of lines) {
          const parsed = parseSseDataLine(line);
          if (parsed === undefined) continue;
          for (const frame of translate(parsed as ResponsesStreamEvent)) {
            controller.enqueue(encoder.encode(frame));
            emitted = true;
          }
        }
        if (emitted) return;
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => undefined);
    },
  });
}

/** Wrap a Responses SSE upstream body as the OpenAI-shaped `Response` a vendor's
 *  `callStream` must resolve to. */
export function responsesStreamResponse(body: ReadableStream<Uint8Array>, model: string): Response {
  return new Response(responsesSseToChatSse(body, { model }), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Transfer-Encoding': 'chunked',
    },
  });
}
