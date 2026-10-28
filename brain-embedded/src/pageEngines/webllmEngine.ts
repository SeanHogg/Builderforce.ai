/**
 * WebLLM (`@mlc-ai/web-llm`) as a page engine — MLC's prebuilt models on WebGPU, answering
 * the `webllm` runtime's chat route through the ONE page shim.
 *
 * The library is several megabytes, so it is imported LAZILY and only when there is
 * something for it to do: a probe first asks Cache Storage whether WebLLM has ever cached
 * a model (`webllm/model`) and answers null without importing anything when it has not.
 * A host that never downloads a WebLLM model never loads the chunk.
 *
 * WebLLM keeps one model resident per engine. The engine is created on first use — a
 * `WebWorkerMLCEngine` when the host supplies a worker (`workerUrl`, a module running
 * `WebWorkerMLCEngineHandler`), else an in-page `MLCEngine` — and `reload`s whenever a
 * call names a different model. (This is exactly what `CreateMLCEngine` /
 * `CreateWebWorkerMLCEngine` do, split so the engine exists BEFORE its first load and a
 * cancelled download can `unload()` it, which aborts WebLLM's in-flight fetches.) A chat call NEVER downloads: a model that is not in WebLLM's cache is a
 * 503 before anything streams, and only the picker's `models.download` fetches weights.
 */

import {
  WEBLLM_ENGINE_BASE_URL,
  localCatalogModel,
  formatLocalModelRef,
  type LocalDeviceSupport,
  type LogprobEngine,
} from '@builderforce/local-inference';
import { catalogProbe } from './catalogProbe';
import { reportPageEngineFailure } from './engineFailure';
import { messageText } from './messages';
import { createResidentModel } from './residentModel';
import {
  PageEngineError,
  abortReason,
  errorMessage,
  hasTools,
  memoizedProbe,
  type ChatCompletionChunk,
  type ChatCompletionsRequest,
  type PageEngine,
} from './types';
import { webGpuSupport } from './webgpu';

/** WebLLM's load progress report. */
export interface WebLlmProgressReport {
  progress: number;
  text?: string;
}

interface WebLlmEngineConfig {
  initProgressCallback?: (report: WebLlmProgressReport) => void;
}

/** The slice of a WebLLM engine (in-page or worker proxy) this adapter drives. */
export interface WebLlmEngineLike {
  reload(modelId: string): Promise<void>;
  setInitProgressCallback(callback: (report: WebLlmProgressReport) => void): void;
  interruptGenerate(): unknown;
  unload(): Promise<void>;
  chat: {
    completions: {
      create(request: Record<string, unknown>): Promise<AsyncIterable<ChatCompletionChunk>>;
    };
  };
}

/** The slice of the `@mlc-ai/web-llm` module this adapter imports. */
export interface WebLlmModule {
  MLCEngine: new (config?: WebLlmEngineConfig) => WebLlmEngineLike;
  WebWorkerMLCEngine: new (worker: Worker, config?: WebLlmEngineConfig) => WebLlmEngineLike;
  hasModelInCache(modelId: string): Promise<boolean>;
  deleteModelAllInfoInCache(modelId: string): Promise<void>;
}

/** WebLLM's own cache, as the model store drives it — the picker's one API delegates here. */
export interface WebLlmModelCache {
  has(modelId: string): Promise<boolean>;
  /** Fetch the weights into WebLLM's cache (by loading the model), reporting 0..1. */
  download(modelId: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<void>;
  remove(modelId: string): Promise<void>;
}

export interface WebLlmPageEngine extends PageEngine {
  models: WebLlmModelCache;
  /** The PreFetch gate's tier-3 engine (`@builderforce/local-inference`
   *  `createLogprobPort`): warm only while a model is resident; never loads one. */
  logprobEngine: LogprobEngine;
}

export interface WebLlmEngineOptions {
  /** The module loader — the lazy import by default; a test passes a fake. */
  loadWebLlm?: () => Promise<WebLlmModule>;
  /** A module worker running WebLLM's `WebWorkerMLCEngineHandler`; absent = in-page. */
  workerUrl?: string | URL;
  support?: () => Promise<LocalDeviceSupport>;
  /** Where WebLLM's Cache API entries live (`globalThis.caches` by default). */
  caches?: Pick<CacheStorage, 'has'>;
  ttlMs?: number;
  now?: () => number;
}

/** The Cache Storage bucket WebLLM writes model shards into (its default backend). */
export const WEBLLM_MODEL_CACHE = 'webllm/model';

/** The fields of an OpenAI request WebLLM accepts; gateway extras are dropped. */
const FORWARDED_FIELDS = [
  'tools',
  'tool_choice',
  'temperature',
  'top_p',
  'max_tokens',
  'stop',
  'seed',
  'frequency_penalty',
  'presence_penalty',
  'response_format',
] as const;

const defaultLoader = (): Promise<WebLlmModule> => import('@mlc-ai/web-llm') as unknown as Promise<WebLlmModule>;

/**
 * The request's messages as WebLLM takes them: ONE system message, first (WebLLM rejects
 * a system message anywhere else), and string content (a non-vision model rejects parts).
 */
function toWebLlmMessages(messages: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(messages) || messages.length === 0) throw new PageEngineError(400, 'no_messages');
  const system: string[] = [];
  const rest: Array<Record<string, unknown>> = [];
  for (const raw of messages) {
    const message = (raw ?? {}) as Record<string, unknown>;
    const text = messageText(message.content);
    if (text === null) throw new PageEngineError(400, 'non_text_content_unsupported');
    if (message.role === 'system') system.push(text);
    else rest.push({ ...message, content: text });
  }
  const joined = system.filter((s) => s.trim().length > 0).join('\n\n');
  return [...(joined ? [{ role: 'system', content: joined }] : []), ...rest];
}

export function createWebLlmEngine(options: WebLlmEngineOptions = {}): WebLlmPageEngine {
  const load = options.loadWebLlm ?? defaultLoader;
  const support = options.support ?? (() => webGpuSupport());
  let module: Promise<WebLlmModule> | undefined;
  const webllm = (): Promise<WebLlmModule> => (module ??= load());

  // One resident engine; every load is chained so two reloads never race.
  const resident = createResidentModel(async (): Promise<WebLlmEngineLike> => {
    const lib = await webllm();
    return options.workerUrl
      ? new lib.WebWorkerMLCEngine(new Worker(options.workerUrl, { type: 'module' }))
      : new lib.MLCEngine();
  });

  const residentEngine = (modelId: string, onProgress?: (fraction: number) => void): Promise<WebLlmEngineLike> =>
    resident.acquire(modelId, async (engine) => {
      engine.setInitProgressCallback((r) => onProgress?.(r.progress));
      await engine.reload(modelId);
    });

  /** Only LOOKS: no bucket means WebLLM never cached anything, so it is not imported. */
  const cached = async (modelId: string): Promise<boolean> => {
    const storage = options.caches ?? (globalThis as { caches?: Pick<CacheStorage, 'has'> }).caches;
    if (storage && !(await storage.has(WEBLLM_MODEL_CACHE))) return false;
    return (await webllm()).hasModelInCache(modelId);
  };

  const prober = memoizedProbe(
    'webllm',
    async () => catalogProbe('webllm', WEBLLM_ENGINE_BASE_URL, await support(), (row) => cached(row.model)),
    options,
  );

  async function chatCompletions(
    body: ChatCompletionsRequest,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<ChatCompletionChunk>> {
    const modelId = typeof body.model === 'string' ? body.model : '';
    const row = localCatalogModel(formatLocalModelRef('webllm', modelId));
    if (!row) throw new PageEngineError(404, 'model_not_found');
    if (hasTools(body) && !row.tools) throw new PageEngineError(400, 'tools_unsupported');
    const messages = toWebLlmMessages(body.messages);
    // A cache that cannot be read is a refusal with its reason — never a silent "not
    // downloaded" the person would answer by downloading again.
    const ready = await cached(modelId).catch((e: unknown) => {
      throw new PageEngineError(503, 'webllm_cache_unreadable', errorMessage(e));
    });
    if (!ready) throw new PageEngineError(503, 'model_not_downloaded');
    if (signal?.aborted) throw abortReason(signal);
    let live: WebLlmEngineLike;
    try {
      live = await residentEngine(modelId);
    } catch (e) {
      throw new PageEngineError(503, 'webllm_engine_unavailable', errorMessage(e));
    }
    const request: Record<string, unknown> = { messages, stream: true, stream_options: { include_usage: true } };
    for (const field of FORWARDED_FIELDS) if (body[field] !== undefined) request[field] = body[field];
    // An empty `tools` still trips WebLLM's function-calling model check.
    if (!hasTools(body)) {
      delete request.tools;
      delete request.tool_choice;
    }
    return interruptible(await live.chat.completions.create(request), live, signal);
  }

  const models: WebLlmModelCache = {
    // A failed lookup rejects: the model store reads it (and reports why) per row.
    has: (modelId) => cached(modelId),
    async download(modelId, onProgress, signal) {
      if (signal?.aborted) throw abortReason(signal);
      // Unloading aborts WebLLM's in-flight fetches; the shards already cached stay, so a
      // retry resumes rather than starting over.
      const onAbort = () =>
        void resident.engine?.unload().catch((e: unknown) => reportPageEngineFailure('webllm', 'unload', e));
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        await residentEngine(modelId, onProgress);
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
      if (signal?.aborted) throw abortReason(signal);
      onProgress?.(1);
      prober.invalidate();
    },
    async remove(modelId) {
      // The engine (and its worker) stays for the next model; only the weights go.
      await resident.evict(modelId)?.unload();
      await (await webllm()).deleteModelAllInfoInCache(modelId);
      prober.invalidate();
    },
  };

  // Tier 3 reads the RESIDENT model only: a non-streaming call with `logprobs` (WebLLM
  // returns at most five alternatives per token). No resident model ⇒ not warm.
  const logprobEngine: LogprobEngine = {
    runtime: 'webllm',
    warm: () => resident.resident !== undefined && resident.engine !== undefined,
    maxTopLogprobs: 5,
    async complete(body) {
      const engine = resident.engine;
      if (resident.resident === undefined || !engine) return undefined;
      return (await engine.chat.completions.create({ ...body, stream: false })) as unknown;
    },
  };

  return { runtime: 'webllm', baseUrl: WEBLLM_ENGINE_BASE_URL, ...prober, chatCompletions, models, logprobEngine };
}

/** WebLLM has no request signal: an abort interrupts the generation instead, and the
 *  iteration then rejects with the abort reason so the shim re-throws it. */
async function* interruptible(
  stream: AsyncIterable<ChatCompletionChunk>,
  engine: WebLlmEngineLike,
  signal: AbortSignal | undefined,
): AsyncGenerator<ChatCompletionChunk> {
  const onAbort = () => void engine.interruptGenerate();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) throw abortReason(signal);
      yield chunk;
    }
    if (signal?.aborted) throw abortReason(signal);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
