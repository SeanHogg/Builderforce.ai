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
 *                                          → open a tool_call slot (id + name), with
 *                                            its arguments when the frame carries them
 *                                            (xAI delivers a streamed call WHOLE)
 *   response.function_call_arguments.delta → an arguments delta on that slot
 *   response.function_call_arguments.done / response.output_item.done
 *                                          → the WHOLE arguments, when no delta
 *                                            carried them (opening the slot if needed)
 *   response.completed                     → any call or text ONLY the terminal
 *                                            output carries, the finish_reason chunk
 *                                            (with the upstream evidence), the
 *                                            usage-only chunk, then `[DONE]`
 *   response.incomplete                    → the same, with finish_reason `length`
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
import { UPSTREAM_EVIDENCE_FIELD, upstreamTurnEvidence } from './responsesApi';

/** The Responses stream events this transform reads. Anything else is ignored. */
interface ResponsesStreamEvent {
  type?: string;
  delta?: unknown;
  output_index?: number;
  /** `response.function_call_arguments.done` carries the call's COMPLETE arguments. */
  arguments?: unknown;
  item?: { type?: string; call_id?: string; id?: string; name?: string; arguments?: unknown };
  /** `output` rides the terminal frame: the turn's complete item list, authoritative for order. */
  response?: { id?: string; usage?: unknown; error?: { message?: string } | string; output?: unknown };
  error?: { message?: string } | string;
  /** xAI's `response.doom_loop_check` payload: the CUMULATIVE set of loop triggers so far. */
  doom_loop_check?: { triggers?: unknown };
}

/**
 * Loosest tail-repetition threshold still treated as a real loop — grok-build's default
 * recovery policy (`DoomLoopRecoveryPolicy::DEFAULT_MAX_THRESHOLD`). Lower is tighter.
 */
const DOOM_LOOP_MAX_THRESHOLD = 64;
/** `tail_repetition:{threshold}@{channel}`, in the reasoning or the visible reply. */
const TAIL_REPETITION = /^tail_repetition:(\d+)@(?:thinking|response)$/;

/**
 * The trigger that makes this check a real loop, or null. A tail repetition counts in
 * EITHER channel. grok-build acts only on `@thinking` and leaves a visible loop to its
 * user, but here a visible loop is a failed turn too: chat #105's Grok wrote an
 * ever-growing tool name (`…_reset_all_reset_all_reset_all`) line after line, where no
 * line repeats verbatim and each repeated unit is too short for the client's own guard.
 * `low_logprob` and unknown kinds stay warn-only.
 */
function confidentDoomLoopTrigger(event: ResponsesStreamEvent): string | null {
  const triggers = event.doom_loop_check?.triggers;
  if (!Array.isArray(triggers)) return null;
  for (const trigger of triggers) {
    const match = typeof trigger === 'string' ? TAIL_REPETITION.exec(trigger) : null;
    if (match && Number(match[1]) <= DOOM_LOOP_MAX_THRESHOLD) return trigger as string;
  }
  return null;
}

/**
 * Slot key for a call first seen in the terminal output list. Past any streamed
 * `output_index`, so a rebuilt call can never land on a slot a streamed one holds.
 */
const TERMINAL_INDEX_BASE = 1_000_000;

/** The visible text of a terminal `message` item: its `output_text` parts, joined. */
function messageText(item: Record<string, unknown>): string {
  const content = item['content'];
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => part as { type?: unknown; text?: unknown } | null)
    .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part!.text as string)
    .join('');
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
  opts: {
    model: string;
    /**
     * Handed the finished turn's output items (reasoning and function calls, in
     * output order) once it completes, before the stream closes — so a vendor can keep
     * what the chat shape has no slot for (`reasoningReplay.ts`). Never called for a
     * turn that failed, was cut off, or ended without its terminal frame.
     */
    onTurnComplete?: (items: ReadonlyArray<Record<string, unknown>>) => Promise<void>;
  },
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
  /** Slots whose arguments already arrived as deltas, so a `.done` frame restating the
   *  whole string is not appended a second time. */
  const argsSeen = new Set<number>();
  /** Slots whose COMPLETE arguments arrived on the frame that opened them, so a delta
   *  restating them is not appended a second time. */
  const argsWhole = new Set<number>();
  /** Ids (`call_id` and item `id`) of every call already opened, so the terminal output
   *  can tell which of its calls never streamed. */
  const openedCallIds = new Set<string>();
  /** Whether any visible text streamed, so text only the terminal output carries is
   *  emitted once and never twice. */
  let sawText = false;
  /** Calls rebuilt from the terminal output — reported in the upstream evidence. */
  let recoveredCalls = 0;
  /** Reasoning and function-call items as the stream completed them, in output order. */
  const completedItems: Array<Record<string, unknown>> = [];
  /** Every item the stream finished, of any type — the evidence when the terminal frame
   *  carries no output list. */
  const streamedItems: Array<Record<string, unknown>> = [];
  /** Set by a clean `response.completed`: the turn's items, owed to `onTurnComplete`. */
  let finishedItems: ReadonlyArray<Record<string, unknown>> | null = null;

  /**
   * Open a chat tool_call slot for a Responses function_call item, with its arguments
   * when the item already carries them. xAI documents that a streamed call "is returned
   * in whole in a single chunk, not streamed across chunks"; reading only the id and name
   * here left such a call with empty arguments unless a later frame restated them.
   */
  function openToolCall(outputIndex: number, item: NonNullable<ResponsesStreamEvent['item']>): string[] {
    const slot = toolSlotByOutputIndex.size;
    toolSlotByOutputIndex.set(outputIndex, slot);
    sawToolCall = true;
    for (const id of [item.call_id, item.id]) if (id) openedCallIds.add(id);
    const toolCall = {
      index: slot,
      id: item.call_id ?? item.id ?? `call_${slot}`,
      type: 'function',
      function: { name: item.name ?? '', arguments: '' },
    };
    const delta: Record<string, unknown> = sawFirstDelta
      ? { tool_calls: [toolCall] }
      : { role: 'assistant', content: '', tool_calls: [toolCall] };
    sawFirstDelta = true;
    const frames = [chunk(responseId, opts.model, { choices: [{ index: 0, delta, finish_reason: null }] })];
    if (typeof item.arguments === 'string' && item.arguments !== '') {
      argsSeen.add(slot);
      argsWhole.add(slot);
      frames.push(argumentsChunk(slot, item.arguments));
    }
    return frames;
  }

  /** A visible-text chunk; the first one of the turn also carries the assistant role. */
  function textChunk(text: string): string {
    const delta: Record<string, unknown> = sawFirstDelta ? { content: text } : { role: 'assistant', content: text };
    sawFirstDelta = true;
    sawText = true;
    return chunk(responseId, opts.model, { choices: [{ index: 0, delta, finish_reason: null }] });
  }

  /**
   * Whatever the terminal output list carries that the stream never announced: a
   * function call no `output_item` frame opened, and text no delta streamed. Without
   * this, a backend that puts a call only in `response.completed` hands the loop a turn
   * with ZERO tool calls while the call sits in the payload — indistinguishable, from the
   * client, from a model that would not call tools.
   */
  function recoverFromTerminalOutput(output: ReadonlyArray<Record<string, unknown>>): string[] {
    const frames: string[] = [];
    if (!sawText) {
      const text = output.filter((item) => item['type'] === 'message').map(messageText).join('');
      if (text) frames.push(textChunk(text));
    }
    output.forEach((raw, index) => {
      if (raw['type'] !== 'function_call') return;
      const item = raw as NonNullable<ResponsesStreamEvent['item']>;
      const ids = [item.call_id, item.id].filter((id): id is string => !!id);
      if (ids.length > 0 ? ids.some((id) => openedCallIds.has(id)) : toolSlotByOutputIndex.has(index)) return;
      frames.push(...openToolCall(TERMINAL_INDEX_BASE + index, item));
      recoveredCalls += 1;
    });
    return frames;
  }

  function argumentsChunk(slot: number, args: string): string {
    return chunk(responseId, opts.model, {
      choices: [{ index: 0, delta: { tool_calls: [{ index: slot, function: { arguments: args } }] }, finish_reason: null }],
    });
  }

  /** Translate one parsed Responses frame into zero or more chat SSE frames. */
  function translate(event: ResponsesStreamEvent): string[] {
    const model = opts.model;
    switch (event.type) {
      case 'response.created':
        if (event.response?.id) responseId = event.response.id;
        return [];

      case 'response.output_text.delta': {
        if (typeof event.delta !== 'string' || event.delta === '') return [];
        return [textChunk(event.delta)];
      }

      case 'response.output_item.added': {
        if (event.item?.type !== 'function_call') return [];
        const outputIndex = typeof event.output_index === 'number' ? event.output_index : toolSlotByOutputIndex.size;
        return openToolCall(outputIndex, event.item);
      }

      case 'response.function_call_arguments.delta': {
        if (typeof event.delta !== 'string' || event.delta === '') return [];
        const outputIndex = typeof event.output_index === 'number' ? event.output_index : 0;
        const slot = toolSlotByOutputIndex.get(outputIndex) ?? 0;
        if (argsWhole.has(slot)) return [];
        argsSeen.add(slot);
        return [argumentsChunk(slot, event.delta)];
      }

      // A backend may deliver a call's arguments WHOLE — on `function_call_arguments.done`
      // or on the finished `output_item.done` — without ever streaming deltas. Reading
      // only the deltas turned such a call into empty arguments, which fail every required
      // parameter; five in a row trip the loop's failure breaker and the run ends mid-task.
      case 'response.function_call_arguments.done':
      case 'response.output_item.done': {
        const isItem = event.type === 'response.output_item.done';
        if (isItem && event.item) streamedItems.push(event.item as unknown as Record<string, unknown>);
        if (isItem && (event.item?.type === 'reasoning' || event.item?.type === 'function_call')) {
          completedItems.push(event.item as unknown as Record<string, unknown>);
        }
        if (isItem && event.item?.type !== 'function_call') return [];
        const outputIndex = typeof event.output_index === 'number' ? event.output_index : 0;
        const frames: string[] = [];
        let slot = toolSlotByOutputIndex.get(outputIndex);
        if (slot === undefined) {
          // Only a finished ITEM carries the name needed to open a call never announced.
          if (!isItem || !event.item) return [];
          frames.push(...openToolCall(outputIndex, event.item));
          slot = toolSlotByOutputIndex.get(outputIndex)!;
        }
        const args = isItem ? event.item?.arguments : event.arguments;
        if (!argsSeen.has(slot) && typeof args === 'string' && args !== '') {
          argsSeen.add(slot);
          frames.push(argumentsChunk(slot, args));
        }
        return frames;
      }

      // `incomplete` is "stopped at the output cap" — and a reasoning model's thinking
      // tokens count against that cap. Reporting it as a clean `stop` made a truncated
      // turn indistinguishable from a finished one; `length` is the finish reason every
      // consumer already reads as "cut off".
      case 'response.completed':
      case 'response.incomplete': {
        if (closed) return [];
        closed = true;
        const output = Array.isArray(event.response?.output) ? event.response!.output as Array<Record<string, unknown>> : null;
        const frames: string[] = [];
        if (event.type === 'response.completed') {
          finishedItems = output ?? completedItems;
          if (output) frames.push(...recoverFromTerminalOutput(output));
        }
        const finish = event.type === 'response.incomplete' ? 'length' : sawToolCall ? 'tool_calls' : 'stop';
        frames.push(chunk(responseId, model, {
          choices: [{ index: 0, delta: {}, finish_reason: finish }],
          // What the vendor actually returned, counted before translation — see
          // `UpstreamTurnEvidence`. The terminal list is authoritative; without one,
          // the items the stream finished stand in for it.
          [UPSTREAM_EVIDENCE_FIELD]: upstreamTurnEvidence(output ?? streamedItems, recoveredCalls),
        }));
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

      // xAI's server-side loop detector, opted into by the xai-oauth vendor's
      // `x-grok-doom-loop-check` header. A confident loop ends the stream as a failure —
      // the caller routes the turn to another model — rather than forwarding minutes of a
      // model talking to itself. Anything less is ignored.
      case 'response.doom_loop_check': {
        const trigger = confidentDoomLoopTrigger(event);
        if (!trigger || closed) return [];
        closed = true;
        return [
          `data: ${JSON.stringify({ error: { message: `the model got stuck in a loop (xAI doom-loop check: ${trigger})`, type: 'upstream_error' } })}\n\n`,
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
        // A terminal frame has been sent: stop reading, so an aborted generation is not
        // left running (and billing) upstream while nothing consumes it.
        if (closed) {
          // Awaited while the response is still open, so the Worker cannot drop the
          // write once the client has its last byte. Best-effort: a failed save only
          // costs the next turn its continuity.
          if (finishedItems && opts.onTurnComplete) {
            const items = finishedItems;
            finishedItems = null;
            await opts.onTurnComplete(items).catch(() => undefined);
          }
          reader.cancel().catch(() => undefined);
          controller.close();
          return;
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
export function responsesStreamResponse(
  body: ReadableStream<Uint8Array>,
  model: string,
  hooks?: { onTurnComplete?: (items: ReadonlyArray<Record<string, unknown>>) => Promise<void> },
): Response {
  return new Response(responsesSseToChatSse(body, { model, ...hooks }), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Transfer-Encoding': 'chunked',
    },
  });
}
