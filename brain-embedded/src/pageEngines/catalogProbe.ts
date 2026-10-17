/**
 * A catalog-backed engine's probe: the `LOCAL_MODEL_CATALOG` rows for its runtime that
 * this device can run AND that are already downloaded, reported exactly like an HTTP
 * runtime's `/v1/models`. Shared by the WebLLM and `bfi` engines, so "what does a page
 * engine serve" is answered one way. `isReady` must only LOOK in a cache — never fetch.
 * `contextOf` lets an engine report the window it will SERVE when that is smaller than
 * the trained one (`bfi` sizes its KV cache to the device); hand-off packs to it.
 */

import {
  formatLocalModelRef,
  localCatalogFor,
  localModelFit,
  type LocalCatalogModel,
  type LocalDeviceSupport,
  type LocalRuntimeId,
  type LocalRuntimeProbe,
} from '@builderforce/local-inference';
import { reportPageEngineFailure } from './engineFailure';

export async function catalogProbe(
  runtime: LocalRuntimeId,
  baseUrl: string,
  support: LocalDeviceSupport,
  isReady: (row: LocalCatalogModel) => Promise<boolean>,
  contextOf: (row: LocalCatalogModel) => number = (row) => row.contextTokens,
): Promise<LocalRuntimeProbe | null> {
  if (!support.supported) return null;
  const fitting = localCatalogFor(runtime).filter((row) => localModelFit(row, support).fits);
  // One row whose cache lookup fails is not offered — and the reason is reported — while
  // the rest still are.
  const ready = await Promise.all(
    fitting.map((row) =>
      isReady(row).catch((e: unknown) => {
        reportPageEngineFailure(runtime, 'cache_lookup', e);
        return false;
      }),
    ),
  );
  const rows = fitting.filter((_, i) => ready[i]);
  if (rows.length === 0) return null;
  return {
    provider: runtime,
    endpoint: { baseUrl },
    reachable: true,
    models: rows.map((row) => ({
      ref: formatLocalModelRef(runtime, row.model),
      provider: runtime,
      model: row.model,
      label: row.label,
      tools: row.tools,
      contextTokens: contextOf(row),
    })),
  };
}
