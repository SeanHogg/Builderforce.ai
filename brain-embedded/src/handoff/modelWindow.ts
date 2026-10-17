/**
 * THE context-window resolver for a hand-off target — how many tokens the model about to
 * serve can hold, or `undefined` when nobody knows.
 *
 * A local ref (`local/<runtime>/<model>`) is answered by the runtime's own live report
 * (a probe's `contextTokens`) first, then by the shipped catalog row (`LOCAL_MODEL_CATALOG`
 * — the WebLLM 4k rows, Bonsai 32k/65k). A cloud ref is answered only by what the host
 * already knows (`sources.cloud`): `@builderforce/model-catalog` carries no window, and a
 * guessed one would shrink a 200k model's transcript for nothing. Unknown means "keep
 * today's budget" — the gateway fits a cloud request to a model that can hold it.
 */

import { isLocalModelRef, localCatalogModel, type LocalModel, type LocalRuntimeProbe } from '@builderforce/local-inference';

/** Where a window may come from. Every source is optional. */
export interface ModelWindowSources {
  /** Live local runtime probes (or their flattened models). A runtime's own report wins
   *  over the catalog: an Ollama model can be loaded with a different `num_ctx`. */
  probes?: readonly LocalRuntimeProbe[];
  models?: readonly LocalModel[];
  /** The host's own knowledge of a cloud model's window (a gateway catalog), if any. */
  cloud?: (ref: string) => number | undefined;
}

const positive = (n: number | undefined): number | undefined =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;

/** The model's context window in tokens, or undefined when unknown. */
export function contextWindowOf(modelRef: string | undefined, sources: ModelWindowSources = {}): number | undefined {
  if (!modelRef) return undefined;
  if (isLocalModelRef(modelRef)) {
    const live = [...(sources.models ?? []), ...(sources.probes ?? []).flatMap((p) => p.models)]
      .find((m) => m.ref === modelRef)?.contextTokens;
    return positive(live) ?? positive(localCatalogModel(modelRef)?.contextTokens);
  }
  return positive(sources.cloud?.(modelRef));
}
