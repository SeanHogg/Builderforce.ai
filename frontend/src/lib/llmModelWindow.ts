import { contextWindowOf, gatewayModelWindows } from '@seanhogg/builderforce-brain-embedded';
import { readClientCached } from '@/infrastructure/http/readThrough';
import type { LlmModelLists } from '@/lib/useLlmModels';

/** The module-cache key of the shared gateway model lists (`useLlmModels`). */
export const LLM_MODELS_CACHE_KEY = 'llm-models:lists';

/**
 * A model's context window in tokens, or undefined when nobody here knows it.
 *
 * A synchronous read of what the page ALREADY holds — never a fetch: the gateway catalog's
 * windows from the shared, module-cached `/llm/v1/models` surface (a connected account's
 * rows), and for an on-device model the local runtime catalog. This is the same source the
 * Brain's window-fit gate reads (`brain/runWindowSources.ts`); a canvas turn that runs
 * before the catalog loaded, or on a model it carries no row for, gets `undefined`, which
 * keeps the agent's fixed caps rather than guessing a window.
 */
export function cachedModelWindow(ref: string): number | undefined {
  const lists = readClientCached<LlmModelLists>(LLM_MODELS_CACHE_KEY);
  return contextWindowOf(ref, { cloud: gatewayModelWindows(lists?.fundingSurface) });
}
