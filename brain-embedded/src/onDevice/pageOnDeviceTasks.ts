/**
 * `OnDeviceTasks` for a page host — web and Rovr (PRD 42 · B2). Each task walks its
 * `ON_DEVICE_TASK_ROUTES` row over the built-in adapters, then falls to the page engines
 * (bfi / WebLLM through the ONE page fetch shim) via {@link completionOnDeviceTasks}.
 * The adapters and the route table are data; nothing here names a browser API.
 */

import { conformsToJsonSchema } from '@builderforce/json-schema';
import { languageDetectorAdapter } from '../builtInAi/languageDetectorApi';
import { proofreaderAdapter } from '../builtInAi/proofreaderApi';
import { rewriterAdapter } from '../builtInAi/rewriterApi';
import { structuredPromptAdapter } from '../builtInAi/structuredPrompt';
import { summarizerAdapter } from '../builtInAi/summarizerApi';
import { isAbortError, nullOnFailure, type AdapterId, type BuiltInAdapter } from '../builtInAi/taskSession';
import { translatorAdapter } from '../builtInAi/translatorApi';
import { writerAdapter } from '../builtInAi/writerApi';
import { completeLocalFirst, type LocalFetch } from '../localFirstTransport';
import { isServableLocalModel, type LocalRuntimeProbe } from '@builderforce/local-inference';
import { builtInModelIdentity } from '../builtInAi/identity';
import { chunkedSummary, summaryReserveTokens } from './chunkedSummary';
import { completionOnDeviceTasks, type OnDeviceCompletion } from './completionOnDeviceTasks';
import { heuristicLanguage } from './heuristicLanguage';
import { observedTask } from './observedTask';
import type { OnDeviceObserver, OnDeviceTaskKind, OnDeviceTasks, ServedBy, ServedOption, SummarizeOptions } from './onDeviceTasks';
import { ON_DEVICE_TASK_ROUTES } from './taskRoutes';

export const BUILT_IN_ADAPTERS: readonly BuiltInAdapter[] = [
  summarizerAdapter, rewriterAdapter, writerAdapter, proofreaderAdapter,
  languageDetectorAdapter, translatorAdapter, structuredPromptAdapter,
];

export interface PageOnDeviceTasksOptions {
  /** The page engines' completion (see {@link pageEngineCompletion}); null = no page engine here. */
  pageCompletion: OnDeviceCompletion | null;
  /** Whether a page engine has a ready model (the page probe). */
  pageAvailable?: () => Promise<boolean>;
  /** Override the adapters / routes (tests); default = every built-in adapter and the PRD table. */
  adapters?: readonly BuiltInAdapter[];
  routes?: Readonly<Record<OnDeviceTaskKind, readonly AdapterId[]>>;
  /** How long `available()` is reused. */
  availableTtlMs?: number;
  /** Told every call's outcome and who served it (PRD 42 · Part F). Absent ⇒ nothing is reported. */
  observe?: OnDeviceObserver;
}

/** True when a page engine has a model that can be served right now (never a download). */
export async function pageEnginesReady(probe: () => Promise<readonly LocalRuntimeProbe[]>): Promise<boolean> {
  return (await probe()).some((p) => p.models.some(isServableLocalModel));
}

/** The page engines as an {@link OnDeviceCompletion}: local only (no cloud), null on any refusal. */
export function pageEngineCompletion(page: {
  probe(): Promise<readonly LocalRuntimeProbe[]>;
  fetch: LocalFetch;
}): OnDeviceCompletion {
  return async (messages, signal, onServed) => {
    try {
      const reply = await completeLocalFirst({
        probes: await page.probe(),
        messages,
        cloud: null,
        fetch: page.fetch,
        ...(signal ? { signal } : {}),
        ...(onServed
          ? { onAttempt: (r) => { if (r.outcome === 'served' && r.attempt.kind === 'local') onServed(r.attempt.ref); } }
          : {}),
      });
      return reply.trim() ? reply : null;
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) throw e;
      return null;
    }
  };
}

export function pageOnDeviceTasks(options: PageOnDeviceTasksOptions): OnDeviceTasks {
  const adapters = new Map((options.adapters ?? BUILT_IN_ADAPTERS).map((a) => [a.id, a]));
  const routes = options.routes ?? ON_DEVICE_TASK_ROUTES;
  const pageAvailable = options.pageAvailable ?? (async () => options.pageCompletion !== null);
  const page = options.pageCompletion
    ? completionOnDeviceTasks({ complete: options.pageCompletion, available: pageAvailable }) // no observe: the page port reports the call once
    : null;

  type Served = (by: ServedBy) => void;

  /** First non-null answer along the kind's route; `adapterRun` null = this adapter lacks the task. Tells `served` who answered. */
  async function walk<R>(
    kind: OnDeviceTaskKind,
    served: Served,
    adapterRun: (a: BuiltInAdapter) => Promise<R | null> | null,
    tail: ((served: Served) => Promise<R | null>) | null,
  ): Promise<R | null> {
    for (const id of routes[kind]) {
      if (id === 'pageEngine') {
        // The tail reports its OWN engine (bfi / WebLLM) per call, through `served`.
        const r = tail ? await tail(served) : null;
        if (r !== null) return r;
        continue;
      }
      const adapter = adapters.get(id);
      const run = adapter ? adapterRun(adapter) : null;
      const r = run ? await run : null;
      if (r !== null) {
        served({ kind, engine: 'browser', model: builtInModelIdentity().model });
        return r;
      }
    }
    return null;
  }

  /** One observed call: `walk` under the measuring wrapper (every method below is this). */
  const call = <R,>(
    kind: OnDeviceTaskKind,
    o: ServedOption | undefined,
    input: string,
    adapterRun: (a: BuiltInAdapter) => Promise<R | null> | null,
    tail: ((served: Served) => Promise<R | null>) | null,
  ): Promise<R | null> =>
    observedTask({ kind, observe: options.observe, onServed: o?.onServed, input }, (served) =>
      walk(kind, served, adapterRun, tail));

  /** One adapter's summary, chunked to its own window when it can measure one. */
  async function summarizeVia(adapter: BuiltInAdapter, text: string, o: SummarizeOptions): Promise<string | null> {
    if (!adapter.summarize) return null;
    const budget = adapter.budget ? await adapter.budget(o.signal) : null;
    if (!budget) return adapter.summarize(text, o);
    try {
      // A failing measure / chunk is a decline; only an abort escapes the port.
      return await nullOnFailure(() => chunkedSummary({
        text,
        budget,
        reserveTokens: summaryReserveTokens(o),
        summarizeChunk: (chunk) => adapter.summarize!(chunk, o),
        ...(o.signal ? { signal: o.signal } : {}),
      }), o.signal);
    } finally {
      budget.release();
    }
  }

  let cached: { at: number; kinds: ReadonlySet<OnDeviceTaskKind> } | null = null;
  const ttl = options.availableTtlMs ?? 5_000;

  return {
    available: async () => {
      if (cached && Date.now() - cached.at < ttl) return cached.kinds;
      const pageReady = page ? await pageAvailable().catch(() => false) : false;
      const kinds = new Set<OnDeviceTaskKind>();
      for (const [kind, route] of Object.entries(routes) as Array<[OnDeviceTaskKind, readonly AdapterId[]]>) {
        for (const id of route) {
          const ready = id === 'pageEngine' ? kind === 'detectLanguage' || (pageReady && kind !== 'translate') : await adapters.get(id)?.ready().catch(() => false);
          if (ready) { kinds.add(kind); break; }
        }
      }
      cached = { at: Date.now(), kinds };
      return kinds;
    },
    summarize: (text, o) => call('summarize', o, text, (a) => summarizeVia(a, text, o), page && ((served) => page.summarize(text, { ...o, onServed: served }))),
    rewrite: (text, o) => call('rewrite', o, text, (a) => a.rewrite?.(text, o) ?? null, page && ((served) => page.rewrite(text, { ...o, onServed: served }))),
    write: (task, o) => call('write', o, task, (a) => a.write?.(task, o) ?? null, page && ((served) => page.write(task, { ...o, onServed: served }))),
    proofread: (text, o) => call('proofread', o, text, (a) => a.proofread?.(text, o) ?? null, page && ((served) => page.proofread(text, { ...o, onServed: served }))),
    detectLanguage: (text, o) => call('detectLanguage', o, text, (a) => a.detectLanguage?.(text) ?? null, async () => heuristicLanguage(text)),
    translate: (text, o) => call('translate', o, text, (a) => a.translate?.(text, o) ?? null, null),
    json: <T,>(o: Parameters<OnDeviceTasks['json']>[0]): Promise<T | null> =>
      call<T>(
        'json',
        o,
        `${o.system}\n${o.user}`,
        (a) => a.json ? a.json(o).then((v) => (v !== null && conformsToJsonSchema(v, o.schema) ? (v as T) : null)) : null,
        page && ((served) => page.json<T>({ ...o, onServed: served })),
      ),
  };
}
