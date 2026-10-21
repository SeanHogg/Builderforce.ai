/**
 * THE fetch shim for every in-page engine — one `fetch` that answers
 * `POST <engine root>/v1/chat/completions` from the matching {@link PageEngine} and
 * passes every other request to the host's own fetch.
 *
 * Lent to `createLocalFirstStream` (or `completeLocalFirst`) as the local fetch, it makes
 * a page engine indistinguishable from Ollama to the shared streamer: the same OpenAI
 * SSE, the same failover and the same Stop. Three rules carry that:
 *
 *  - the FIRST chunk is pulled before the 200 is answered, so a refusal or a failure at
 *    the engine is a non-2xx the failover can still route around — nothing reached the
 *    user yet;
 *  - a failure AFTER the first chunk is an in-band `error` frame: the turn is committed,
 *    so the streamer reports an interruption rather than failing over;
 *  - an abort is re-thrown, never answered — a Stop is not a refusal.
 *
 * A non-streaming request is answered as one JSON completion folded from the same chunks.
 */

import { localChatCompletionsUrl, type LocalRuntimeProbe } from '@builderforce/local-inference';
import type { LocalFetch } from '../localFirstTransport';
import {
  PageEngineError,
  abortReason,
  errorMessage,
  type ChatCompletionChunk,
  type ChatCompletionsRequest,
  type PageEngine,
} from './types';

/** Read at CALL time so a harness that swaps the global is honoured. */
const globalFetch: LocalFetch = (input, init) => fetch(input, init);

/** A non-2xx the streamer maps to an error — and the failover moves past. */
function refusal(status: number, code: string, message = code): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The answer for a failure before anything streamed: the engine's own status when it
 *  gave one, else a 500 named for the runtime. */
function refusalFor(engine: PageEngine, e: unknown): Response {
  if (e instanceof PageEngineError) return refusal(e.status, e.code, e.message);
  return refusal(500, `${engine.runtime}_engine_failed`, errorMessage(e));
}

/** A failure after the stream opened, as its in-band frame. An engine's code rides in
 *  the message too — a streamer keeps only the message, and the chat's error banner
 *  localizes by the code (`chatErrorAction`). */
function inBandError(e: unknown): { message: string; code?: string } {
  if (!(e instanceof PageEngineError)) return { message: errorMessage(e) };
  return { code: e.code, message: e.message.includes(e.code) ? e.message : `${e.code}: ${e.message}` };
}

const encoder = new TextEncoder();
const sseFrame = (data: unknown): Uint8Array => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
const DONE_FRAME = encoder.encode('data: [DONE]\n\n');

/**
 * The OpenAI SSE body for a stream already known to have started. The engine's iterator
 * lives exactly as long as the body: returned on the last frame, an error or a cancel,
 * so the engine releases its session.
 */
function sseBody(
  first: IteratorResult<ChatCompletionChunk>,
  chunks: AsyncIterator<ChatCompletionChunk>,
  signal: AbortSignal | undefined,
): ReadableStream<Uint8Array> {
  let pending: IteratorResult<ChatCompletionChunk> | null = first;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = pending ?? (await chunks.next());
        pending = null;
        if (next.done) {
          controller.enqueue(DONE_FRAME);
          controller.close();
          return;
        }
        controller.enqueue(sseFrame(next.value));
      } catch (e) {
        if (signal?.aborted) {
          controller.error(e);
          return;
        }
        controller.enqueue(sseFrame({ error: inBandError(e) }));
        controller.close();
      }
    },
    cancel() {
      void chunks.return?.(undefined);
    },
  });
}

/** Fold a chunk stream into one `chat.completion` — content concatenated, tool calls
 *  assembled by index, the last finish reason and usage kept. */
export async function foldChunks(chunks: AsyncIterator<ChatCompletionChunk>): Promise<Record<string, unknown>> {
  let content = '';
  let model: string | undefined;
  let finish: string | null = null;
  let usage: ChatCompletionChunk['usage'];
  const calls = new Map<number, { id?: string; type: string; function: { name: string; arguments: string } }>();
  for (;;) {
    const next = await chunks.next();
    if (next.done) break;
    const chunk = next.value;
    model = chunk.model ?? model;
    if (chunk.usage) usage = chunk.usage;
    for (const choice of chunk.choices ?? []) {
      if (typeof choice.delta?.content === 'string') content += choice.delta.content;
      for (const call of choice.delta?.tool_calls ?? []) {
        const slot = calls.get(call.index) ?? { type: 'function', function: { name: '', arguments: '' } };
        if (call.id) slot.id = call.id;
        if (call.function?.name) slot.function.name += call.function.name;
        if (call.function?.arguments) slot.function.arguments += call.function.arguments;
        calls.set(call.index, slot);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }
  const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
  const message = { role: 'assistant', content, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) };
  return {
    object: 'chat.completion',
    ...(model ? { model } : {}),
    choices: [{ index: 0, message, finish_reason: finish ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop') }],
    ...(usage ? { usage } : {}),
  };
}

/** Answer one chat-completions request from `engine`. */
async function answer(engine: PageEngine, init: RequestInit): Promise<Response> {
  const signal = init.signal ?? undefined;
  if (signal?.aborted) throw abortReason(signal);
  let body: ChatCompletionsRequest;
  try {
    body = JSON.parse(typeof init.body === 'string' ? init.body : '') as ChatCompletionsRequest;
    if (!body || typeof body !== 'object') throw new Error('not an object');
  } catch {
    return refusal(400, 'invalid_request');
  }
  let chunks: AsyncIterator<ChatCompletionChunk> | undefined;
  try {
    chunks = (await engine.chatCompletions(body, signal))[Symbol.asyncIterator]();
    if (body.stream !== true) {
      return new Response(JSON.stringify(await foldChunks(chunks)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const first = await chunks.next();
    return new Response(sseBody(first, chunks, signal), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  } catch (e) {
    void chunks?.return?.(undefined);
    if (signal?.aborted) throw e;
    return refusalFor(engine, e);
  }
}

/**
 * A `fetch` that answers each engine's chat route in the page and passes every other
 * request to `base` — the HTTP runtimes keep reaching their servers through it.
 */
export function pageEnginesFetch(engines: readonly PageEngine[], base: LocalFetch = globalFetch): LocalFetch {
  const routes = new Map(engines.map((engine) => [localChatCompletionsUrl(engine.baseUrl), engine]));
  return (input, init) => {
    const engine = (init.method ?? 'GET').toUpperCase() === 'POST' ? routes.get(input) : undefined;
    return engine ? answer(engine, init) : base(input, init);
  };
}

/** Every engine's probe, concurrently, keeping the ones with something to serve. An
 *  engine's probe never rejects — its failure is handled (and reported) in
 *  `memoizedProbe` — so one engine's failure cannot sink the others'. */
export async function probePageEngines(
  engines: readonly PageEngine[],
  options?: { fresh?: boolean },
): Promise<LocalRuntimeProbe[]> {
  const probes = await Promise.all(engines.map((engine) => engine.probe(options)));
  return probes.filter((p): p is LocalRuntimeProbe => p !== null);
}
