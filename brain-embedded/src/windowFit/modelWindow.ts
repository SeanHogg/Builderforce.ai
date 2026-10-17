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

/**
 * What a run lends its window-fit gate. The same sources as {@link ModelWindowSources},
 * except the probes are READ ON DEMAND: probing a local runtime is only worth doing for
 * a local target, and a run lives longer than any one probe.
 */
export interface RunWindowSources {
  /** The host's own knowledge of a cloud model's window — its gateway catalog. */
  cloud?: (ref: string) => number | undefined;
  /** The live local runtimes, asked only when the target is a local ref. */
  probes?: () => readonly LocalRuntimeProbe[] | Promise<readonly LocalRuntimeProbe[]>;
}

/** {@link contextWindowOf} over a run's sources. A probe that fails leaves the catalog row. */
export async function resolveContextWindow(modelRef: string | undefined, sources: RunWindowSources = {}): Promise<number | undefined> {
  if (!modelRef) return undefined;
  let probes: readonly LocalRuntimeProbe[] | undefined;
  if (sources.probes && isLocalModelRef(modelRef)) {
    try {
      probes = await sources.probes();
    } catch {
      probes = undefined; // an unreachable runtime reports no live window: the catalog row answers
    }
  }
  return contextWindowOf(modelRef, { ...(sources.cloud ? { cloud: sources.cloud } : {}), ...(probes ? { probes } : {}) });
}
