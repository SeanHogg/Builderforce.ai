/**
 * The browser's OWN model as a local-first runtime — Chrome's built-in model (Gemini
 * Nano) behind the Prompt API, answering the same OpenAI chat route every other local
 * runtime answers.
 *
 * Nothing about local-first changes for it. The registry knows it as the `browser`
 * runtime (`reach: 'page'`, so no HTTP prober ever contacts it); {@link
 * browserEngineProbe} reports its one model the way an HTTP probe reports a runtime's
 * catalog; and {@link browserEngineFetch} is a `fetch` that answers
 * `POST <browser root>/v1/chat/completions` from the Prompt API as OpenAI SSE. Handed to
 * `createLocalFirstStream` as its local fetch, the shared streamer drives it exactly
 * like Ollama: same plan (a tool turn never goes to it — the Prompt API has no tool-call
 * protocol), same failover (a refusal, an oversized prompt or an unavailable model is a
 * non-2xx BEFORE anything streamed, so the gateway answers invisibly), same Stop.
 *
 * Readiness is asked WITHOUT starting a download: a model that is `downloadable` or
 * `downloading` is not offered — a chat turn must never be the thing that pulls a
 * multi-gigabyte model onto someone's machine.
 */

import {
  BROWSER_ENGINE_BASE_URL,
  formatLocalModelRef,
  localChatCompletionsUrl,
  localRuntime,
  type LocalRuntimeProbe,
} from '@builderforce/local-inference';
import type { LocalFetch } from './localFirstTransport';
import {
  promptApiAvailability,
  promptApiFactory,
  promptApiInputQuota,
  promptApiMeasure,
  promptStreamDeltas,
  type PromptApiMessage,
  type PromptApiSession,
} from './promptApi';

/** The id the browser engine's one model goes by (`local/browser/gemini-nano`). */
export const BROWSER_ENGINE_MODEL = 'gemini-nano';

/** The window assumed when the browser will not say (Gemini Nano's smallest shipped
 *  input quota, rounded down) — conservative, so the plan sends a long call to the cloud
 *  rather than discovering the overflow at the engine. */
export const BROWSER_ENGINE_FALLBACK_CONTEXT_TOKENS = 4_096;

/** How long an availability answer is trusted. It changes only when the browser finishes
 *  a download or an admin flips a policy, so asking per turn would be pure overhead. */
export const BROWSER_ENGINE_PROBE_TTL_MS = 30_000;

/** Read at CALL time so a harness that swaps the global is honoured. */
const globalFetch: LocalFetch = (input, init) => fetch(input, init);

// ── Probe ────────────────────────────────────────────────────────────────────

export interface BrowserEngineProber {
  /** The browser runtime's probe, or null when the model is not ready on this browser. */
  probe(options?: { fresh?: boolean }): Promise<LocalRuntimeProbe | null>;
  invalidate(): void;
}

/** The session's input budget, read once from a throwaway session. Creating a session
 *  for an `available` model downloads nothing. */
async function readInputQuota(): Promise<number | undefined> {
  const factory = promptApiFactory();
  if (!factory) return undefined;
  try {
    const session = await factory.create();
    try {
      return promptApiInputQuota(session);
    } finally {
      session.destroy();
    }
  } catch {
    return undefined;
  }
}

async function probeOnce(knownQuota: () => number | undefined, learnQuota: (q: number) => void) {
  if ((await promptApiAvailability()) !== 'available') return null;
  let contextTokens = knownQuota();
  if (contextTokens === undefined) {
    contextTokens = await readInputQuota();
    if (contextTokens !== undefined) learnQuota(contextTokens);
  }
  const probe: LocalRuntimeProbe = {
    provider: 'browser',
    endpoint: { baseUrl: BROWSER_ENGINE_BASE_URL },
    reachable: true,
    models: [
      {
        ref: formatLocalModelRef('browser', BROWSER_ENGINE_MODEL),
        provider: 'browser',
        model: BROWSER_ENGINE_MODEL,
        label: localRuntime('browser').label,
        tools: false,
        contextTokens: contextTokens ?? BROWSER_ENGINE_FALLBACK_CONTEXT_TOKENS,
      },
    ],
  };
  return probe;
}

/**
 * A memoizing prober for the browser engine — the twin of `createLocalRuntimeProber`.
 * Concurrent callers share one in-flight answer; the input quota, once learned, is kept
 * for the prober's lifetime (it is a property of the installed model).
 */
export function createBrowserEngineProber(
  config: { ttlMs?: number; now?: () => number } = {},
): BrowserEngineProber {
  const ttlMs = config.ttlMs ?? BROWSER_ENGINE_PROBE_TTL_MS;
  const now = config.now ?? (() => Date.now());
  let memo: { at: number; value: Promise<LocalRuntimeProbe | null> } | undefined;
  let quota: number | undefined;
  return {
    probe(options = {}) {
      const at = now();
      if (!options.fresh && memo && at - memo.at < ttlMs) return memo.value;
      const value = probeOnce(
        () => quota,
        (q) => {
          quota = q;
        },
      ).catch(() => null);
      memo = { at, value };
      return value;
    },
    invalidate() {
      memo = undefined;
    },
  };
}

const sharedProber = createBrowserEngineProber();

/** The browser runtime's probe on this page, or null when its model is not ready. SSR
 *  safe: without the Prompt API (a server, any non-Chrome browser) it is simply null. */
export function browserEngineProbe(options?: { fresh?: boolean }): Promise<LocalRuntimeProbe | null> {
  return sharedProber.probe(options);
}

// ── The in-page chat route ───────────────────────────────────────────────────

/** The request messages as the Prompt API takes them: a seeded conversation plus the
 *  prompt — or why this request cannot be served here. */
export function toPromptApiTurn(
  messages: unknown,
): { initialPrompts: PromptApiMessage[]; prompt: string } | { error: string } {
  if (!Array.isArray(messages) || messages.length === 0) return { error: 'no_messages' };
  const system: string[] = [];
  const turns: PromptApiMessage[] = [];
  for (const raw of messages) {
    const { role, content, tool_calls } = (raw ?? {}) as { role?: unknown; content?: unknown; tool_calls?: unknown };
    if (Array.isArray(tool_calls) && tool_calls.length > 0) return { error: 'tool_messages_unsupported' };
    const text = textOf(content);
    if (text === null) return { error: 'non_text_content_unsupported' };
    if (role === 'system') system.push(text);
    else if (role === 'user' || role === 'assistant') turns.push({ role, content: text });
    else return { error: 'tool_messages_unsupported' };
  }
  const last = turns.pop();
  if (!last || last.role !== 'user') return { error: 'last_message_not_user' };
  const joined = system.filter((s) => s.trim().length > 0).join('\n\n');
  return {
    initialPrompts: [...(joined ? [{ role: 'system' as const, content: joined }] : []), ...turns],
    prompt: last.content,
  };
}

/** Plain text of a message's content, or null when it carries anything else (an image —
 *  the built-in model reads text only). */
function textOf(content: unknown): string | null {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    const { type, text } = (part ?? {}) as { type?: unknown; text?: unknown };
    if (type !== 'text' || typeof text !== 'string') return null;
    parts.push(text);
  }
  return parts.join('\n');
}

/** A non-2xx the streamer maps to an error — and the failover moves past. */
function refusal(status: number, code: string, message = code): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const isQuotaError = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === 'QuotaExceededError';
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const abortReason = (signal: AbortSignal): unknown => signal.reason ?? new DOMException('Aborted', 'AbortError');

const encoder = new TextEncoder();
const sseFrame = (data: unknown): Uint8Array => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
const deltaFrame = (content: string) => ({
  model: BROWSER_ENGINE_MODEL,
  choices: [{ index: 0, delta: { content }, finish_reason: null }],
});

/**
 * The OpenAI SSE body for a stream already known to have started. The session lives
 * exactly as long as the body: destroyed on the last frame, an error or a cancel. A
 * failure after the first delta is an in-band `error` frame — the turn is already
 * committed, so the streamer reports it as an interruption rather than failing over.
 */
function sseBody(
  first: IteratorResult<string>,
  deltas: AsyncGenerator<string>,
  session: PromptApiSession,
  signal: AbortSignal | undefined,
): ReadableStream<Uint8Array> {
  let pending: IteratorResult<string> | null = first;
  let destroyed = false;
  const release = (): void => {
    if (destroyed) return;
    destroyed = true;
    session.destroy();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = pending ?? (await deltas.next());
        pending = null;
        if (next.done) {
          const stop = { index: 0, delta: {}, finish_reason: 'stop' };
          controller.enqueue(sseFrame({ model: BROWSER_ENGINE_MODEL, choices: [stop] }));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          release();
          return;
        }
        controller.enqueue(sseFrame(deltaFrame(next.value)));
      } catch (e) {
        release();
        if (signal?.aborted) {
          controller.error(e);
          return;
        }
        controller.enqueue(sseFrame({ error: { message: messageOf(e) } }));
        controller.close();
      }
    },
    cancel() {
      release();
      void deltas.return(undefined);
    },
  });
}

/** Answer one chat-completions request from the Prompt API. */
async function answerFromPromptApi(init: RequestInit): Promise<Response> {
  const signal = init.signal ?? undefined;
  if (signal?.aborted) throw abortReason(signal);
  let body: { messages?: unknown; tools?: unknown; stream?: unknown };
  try {
    body = JSON.parse(typeof init.body === 'string' ? init.body : '') as typeof body;
  } catch {
    return refusal(400, 'invalid_request');
  }
  if (Array.isArray(body.tools) && body.tools.length > 0) return refusal(400, 'tools_unsupported');
  const turn = toPromptApiTurn(body.messages);
  if ('error' in turn) return refusal(400, turn.error);

  const factory = promptApiFactory();
  if (!factory || (await promptApiAvailability(factory)) !== 'available') {
    return refusal(503, 'browser_engine_unavailable');
  }
  let session: PromptApiSession;
  try {
    session = await factory.create({
      ...(turn.initialPrompts.length > 0 ? { initialPrompts: turn.initialPrompts } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    return isQuotaError(e)
      ? refusal(413, 'context_exceeded', messageOf(e))
      : refusal(503, 'browser_engine_unavailable', messageOf(e));
  }

  try {
    // Refuse an oversized prompt up front when the build can measure it — the failover
    // then hands it to the cloud without the engine ever starting.
    const quota = promptApiInputQuota(session);
    const needed = await promptApiMeasure(session, turn.prompt, signal).catch(() => undefined);
    if (quota !== undefined && needed !== undefined && (session.inputUsage ?? 0) + needed > quota) {
      session.destroy();
      return refusal(413, 'context_exceeded');
    }
    const deltas = promptStreamDeltas(session.promptStreaming(turn.prompt, signal ? { signal } : undefined));
    if (body.stream !== true) {
      let text = '';
      for await (const delta of deltas) text += delta;
      session.destroy();
      const choice = { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' };
      return new Response(JSON.stringify({ model: BROWSER_ENGINE_MODEL, choices: [choice] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Pull the FIRST delta before answering, so a refusal or failure at the engine is a
    // non-2xx the failover can still route around — nothing has reached the user yet.
    const first = await deltas.next();
    return new Response(sseBody(first, deltas, session, signal), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  } catch (e) {
    session.destroy();
    if (signal?.aborted) throw e;
    return isQuotaError(e)
      ? refusal(413, 'context_exceeded', messageOf(e))
      : refusal(500, 'browser_engine_failed', messageOf(e));
  }
}

/**
 * A `fetch` that answers the browser runtime's chat route in the page and passes every
 * other request to `base`. Lend it to `createLocalFirstStream` (or `completeLocalFirst`)
 * as the local fetch; the HTTP runtimes keep reaching their servers through `base`.
 */
export function browserEngineFetch(base: LocalFetch = globalFetch): LocalFetch {
  const route = localChatCompletionsUrl(BROWSER_ENGINE_BASE_URL);
  return (input, init) =>
    input === route && (init.method ?? 'GET').toUpperCase() === 'POST' ? answerFromPromptApi(init) : base(input, init);
}
