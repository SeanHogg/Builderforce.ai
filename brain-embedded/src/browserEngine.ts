/**
 * The browser's OWN model as a local-first runtime — Chrome's built-in model (Gemini
 * Nano) behind the Prompt API, as one {@link PageEngine}.
 *
 * Nothing about local-first changes for it. The registry knows it as the `browser`
 * runtime (`reach: 'page'`, so no HTTP prober ever contacts it); {@link promptApiEngine}
 * reports its one model the way an HTTP probe reports a runtime's catalog, and answers a
 * chat completion as OpenAI chunks that the ONE page shim (`pageEnginesFetch`) serves as
 * SSE. The shared streamer drives it exactly like Ollama: same plan (a tool turn never
 * goes to it — the Prompt API has no tool-call protocol), same failover (a refusal, an
 * oversized prompt or an unavailable model is thrown before the first chunk, so the
 * gateway answers invisibly), same Stop.
 *
 * Readiness is asked WITHOUT starting a download: a model that is `downloadable` or
 * `downloading` is not offered — a chat turn must never be the thing that pulls a
 * multi-gigabyte model onto someone's machine.
 */

import {
  BROWSER_ENGINE_BASE_URL,
  formatLocalModelRef,
  type LocalRuntimeProbe,
} from '@builderforce/local-inference';
import {
  PageEngineError,
  errorMessage,
  hasTools,
  memoizedProbe,
  type ChatCompletionChunk,
  type ChatCompletionsRequest,
  type PageEngine,
} from './pageEngines/types';
import { reportPageEngineFailure } from './pageEngines/engineFailure';
import { messageText } from './pageEngines/messages';
import {
  promptApiAvailability,
  promptApiFactory,
  promptApiInputQuota,
  promptApiMeasure,
  promptStreamDeltas,
  type PromptApiMessage,
  type PromptApiSession,
} from './builtInAi/promptApi';
import { builtInModelIdentity } from './builtInAi/identity';

/**
 * The browser engine's one model — which model and which fallback window are the VENDOR'S
 * data ({@link builtInModelIdentity}), not constants here: Edge's `LanguageModel` is
 * Phi-4-mini, not Gemini Nano, and is named and windowed accordingly (PRD 42 · A1).
 */

/** Maps the Prompt API availability onto the probe-row `state` vocabulary. */
function probeState(availability: 'available' | 'downloadable' | 'downloading'): 'ready' | 'downloadable' | 'downloading' {
  return availability === 'available' ? 'ready' : availability;
}

// ── Probe ────────────────────────────────────────────────────────────────────

/** The browser runtime's probe (null when no built-in model is present at all) and its reset. */
export type BrowserEngineProber = Pick<PageEngine, 'probe' | 'invalidate'>;

/**
 * The session's input budget, read once from a throwaway session. Only ever called for a
 * model that is `available` — creating a session for an `available` model downloads
 * nothing (PRD 42 · A2: never a surprise download).
 */
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

async function probeOnce(
  knownQuota: () => number | undefined,
  learnQuota: (q: number) => void,
): Promise<LocalRuntimeProbe | null> {
  const identity = builtInModelIdentity();
  const availability = await promptApiAvailability();
  if (availability === 'unavailable') return null;
  // A `downloadable`/`downloading` model is reported as a row with its `state` so the
  // picker can offer an opt-in Download — but it is never offered for a chat turn, and we
  // never measure its quota (creating a session could start the download).
  if (availability !== 'available') {
    return {
      provider: 'browser',
      endpoint: { baseUrl: BROWSER_ENGINE_BASE_URL },
      reachable: true,
      models: [
        {
          ref: formatLocalModelRef('browser', identity.model),
          provider: 'browser',
          model: identity.model,
          label: identity.label,
          tools: false,
          contextTokens: identity.fallbackContextTokens,
          state: probeState(availability),
        },
      ],
    };
  }
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
        ref: formatLocalModelRef('browser', identity.model),
        provider: 'browser',
        model: identity.model,
        label: identity.label,
        tools: false,
        contextTokens: contextTokens ?? identity.fallbackContextTokens,
        state: 'ready',
      },
    ],
  };
  return probe;
}

/**
 * A memoizing prober for the browser engine. The input quota, once learned, is kept for
 * the prober's lifetime (it is a property of the installed model).
 */
export function createBrowserEngineProber(
  config: { ttlMs?: number; now?: () => number } = {},
): BrowserEngineProber {
  let quota: number | undefined;
  return memoizedProbe(
    'browser',
    () =>
      probeOnce(
        () => quota,
        (q) => {
          quota = q;
        },
      ),
    config,
  );
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
    const text = messageText(content);
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

// ── The engine ───────────────────────────────────────────────────────────────

const isQuotaError = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === 'QuotaExceededError';

// The chunk names THIS browser's model — the vendor's id, not a hard-coded one (A1).
const engineModelId = (): string => builtInModelIdentity().model;

const chunk = (delta: { content?: string }, finish: string | null): ChatCompletionChunk => ({
  model: engineModelId(),
  choices: [{ index: 0, delta, finish_reason: finish }],
});

/** The session's deltas as OpenAI chunks, closed by a `stop` chunk. The session lives
 *  exactly as long as the iteration — destroyed on the last chunk, an error or an early
 *  return (the shim returns the iterator when the body is cancelled). */
async function* sessionChunks(session: PromptApiSession, prompt: string, signal: AbortSignal | undefined) {
  try {
    for await (const delta of promptStreamDeltas(session.promptStreaming(prompt, signal ? { signal } : undefined))) {
      yield chunk({ content: delta }, null);
    }
    yield chunk({}, 'stop');
  } catch (e) {
    if (isQuotaError(e) && !signal?.aborted) throw new PageEngineError(413, 'context_exceeded', errorMessage(e));
    throw e;
  } finally {
    session.destroy();
  }
}

/** Open a session for one request — or refuse it before anything streams. */
async function promptApiCompletions(
  body: ChatCompletionsRequest,
  signal?: AbortSignal,
): Promise<AsyncIterable<ChatCompletionChunk>> {
  if (hasTools(body)) throw new PageEngineError(400, 'tools_unsupported');
  const turn = toPromptApiTurn(body.messages);
  if ('error' in turn) throw new PageEngineError(400, turn.error);

  const factory = promptApiFactory();
  if (!factory || (await promptApiAvailability(factory)) !== 'available') {
    throw new PageEngineError(503, 'browser_engine_unavailable');
  }
  let session: PromptApiSession;
  try {
    session = await factory.create({
      ...(turn.initialPrompts.length > 0 ? { initialPrompts: turn.initialPrompts } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw isQuotaError(e)
      ? new PageEngineError(413, 'context_exceeded', errorMessage(e))
      : new PageEngineError(503, 'browser_engine_unavailable', errorMessage(e));
  }
  // Refuse an oversized prompt up front when the build can measure it — the failover
  // then hands it to the cloud without the engine ever starting.
  const quota = promptApiInputQuota(session);
  // A build that cannot measure skips the up-front check (the engine still refuses an
  // oversized prompt itself), and says why.
  const needed = await promptApiMeasure(session, turn.prompt, signal).catch((e: unknown) => {
    if (!signal?.aborted) reportPageEngineFailure('browser', 'measure', e);
    return undefined;
  });
  if (quota !== undefined && needed !== undefined && (session.inputUsage ?? 0) + needed > quota) {
    session.destroy();
    throw new PageEngineError(413, 'context_exceeded');
  }
  return sessionChunks(session, turn.prompt, signal);
}

/** Chrome's built-in model as a page engine — hand it to `pageEnginesFetch` and probe it
 *  alongside the others. SSR safe: without the Prompt API its probe is simply null. */
export const promptApiEngine: PageEngine = {
  runtime: 'browser',
  baseUrl: BROWSER_ENGINE_BASE_URL,
  ...createBrowserEngineProber(),
  chatCompletions: promptApiCompletions,
};
