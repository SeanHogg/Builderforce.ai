/**
 * The browser's built-in model as a picker row (PRD 42 · A2).
 *
 * The vendor is only known at runtime (Gemini Nano in Chrome, Phi-4-mini in Edge), so
 * this row cannot live in the static `LOCAL_MODEL_CATALOG`. It is derived from the
 * browser prober's own row — the probe `state` (`ready` / `downloadable` / `downloading`)
 * is the row's state — and the page-engine store (`pageEngines/modelStore.ts`) lists it
 * beside the catalog and routes its download to {@link downloadBuiltInModel} by the row's
 * `source.kind: 'browser'`. A browser without the model has no row at all.
 */

import type { LocalCatalogModel, LocalModel } from '@builderforce/local-inference';
import type { PageEngine } from '../pageEngines/types';
import { downloadBuiltInModel } from './download';

/** The probe's non-ready states a picker row can be in. */
export type BuiltInModelState = NonNullable<LocalModel['state']>;

export interface BuiltInModelEntry {
  row: LocalCatalogModel;
  state: BuiltInModelState;
}

export interface BuiltInModels {
  /** This browser's built-in model row with its state, or null when it has none. */
  entry(): Promise<BuiltInModelEntry | null>;
  /** Download it (inside a user activation). Rejects on refusal or abort. */
  download(onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void>;
}

/** The catalog-shaped row of a probed built-in model. */
function rowOf(model: LocalModel): LocalCatalogModel {
  return {
    ref: model.ref,
    runtime: 'browser',
    model: model.model,
    label: model.label ?? model.model,
    family: 'built-in',
    params: 0,
    bytes: 0,
    contextTokens: model.contextTokens ?? 0,
    tools: false,
    uses: ['chat'],
    recommended: true,
    source: { kind: 'browser' },
    requires: { minBufferBytes: 0 },
  };
}

export function createBuiltInModels(prober: Pick<PageEngine, 'probe'>): BuiltInModels {
  return {
    async entry() {
      const probe = await prober.probe();
      const model = probe?.models[0];
      if (!model) return null;
      return { row: rowOf(model), state: model.state ?? 'ready' };
    },
    async download(onProgress, signal) {
      const result = await downloadBuiltInModel({ onProgress, ...(signal ? { signal } : {}) });
      if (result === 'unavailable') throw new Error('engine_unavailable: browser');
    },
  };
}
