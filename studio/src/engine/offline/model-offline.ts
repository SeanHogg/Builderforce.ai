/**
 * Make a model available offline — download every file the model needs into
 * the existing IndexedDB weight store, then the engine runs with no network.
 *
 * What "available" means: every ONNX file of the model AND both tokenizer
 * files are in the store. The weights are the very entries `getOrFetchWeight`
 * reads on a normal load (same keys), so a model the user already ran is
 * already most of the way there; only the tokenizer is extra.
 *
 * A tiny raw-bytes manifest (`offline/<model>/manifest.json`, same store, same
 * raw-ArrayBuffer format) remembers the sizes so the UI can show "1.9 GB
 * stored" without reading multi-GB values back.
 */

import type { DiffusionModelId, WeightSource } from '../../types';
import { MODEL_REGISTRY } from '../diffusion-models';
import { weightStore } from '../residency/weight-store';
import { modelWeightFiles, weightRequest } from '../residency/weight-prefetch';
import { DEFAULT_WEIGHT_SOURCES, deriveR2Base, getOrFetchWeight } from '../weight-cache';
import { isTokenizerStored, storeTokenizerFiles } from './tokenizer-store';

export interface OfflineProgress {
  /** Bytes stored so far across all files (including files already stored, when their size is known). */
  loadedBytes: number;
  /** Total bytes when every file's size is known, else null. */
  totalBytes: number | null;
  /** The file currently downloading. */
  file: string;
  /** 1-based index of the current file, and how many there are (a fallback for a percentage). */
  fileIndex: number;
  fileCount: number;
}

export interface PrepareModelOfflineOptions {
  model: DiffusionModelId;
  /** Builderforce API origin (the r2-proxy weights base is derived from it). */
  baseUrl?: string;
  /** Bearer token for the authenticated r2-proxy. */
  authToken: string;
  weightSources?: WeightSource[];
  onProgress?: (progress: OfflineProgress) => void;
  signal?: AbortSignal;
}

export interface ModelOfflineStatus {
  available: boolean;
  /** Bytes the model occupies offline, when known (null for a model stored before this feature, or not stored). */
  sizeBytes: number | null;
}

interface OfflineManifest {
  v: 1;
  sizes: Record<string, number>;
  tokenizerBytes: number;
}

const manifestKey = (model: DiffusionModelId): string => `offline/${model}/manifest.json`;
const weightKey = (model: DiffusionModelId, file: string): string => `${model}/${file}`;

async function readManifest(model: DiffusionModelId): Promise<OfflineManifest | null> {
  const buf = await weightStore().read(manifestKey(model));
  if (!buf) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(buf)) as OfflineManifest;
    return parsed?.v === 1 && parsed.sizes ? parsed : null;
  } catch {
    return null;
  }
}

function abortError(): DOMException {
  return new DOMException('Offline download cancelled', 'AbortError');
}

/** Whether `model` (weights + tokenizer) is in the store, and how big it is. */
export async function getModelOfflineStatus(model: DiffusionModelId): Promise<ModelOfflineStatus> {
  const descriptor = MODEL_REGISTRY[model];
  if (descriptor.engine !== 'lcm-diffusion') return { available: false, sizeBytes: null };
  const store = weightStore();
  const files = modelWeightFiles(descriptor);
  const stored = await Promise.all(files.map((f) => store.has(weightKey(model, f))));
  const available = stored.every(Boolean) && (await isTokenizerStored(descriptor.tokenizerRepo));
  if (!available) return { available: false, sizeBytes: null };
  const manifest = await readManifest(model);
  const known = manifest && files.every((f) => manifest.sizes[weightKey(model, f)] !== undefined);
  const sizeBytes = known
    ? files.reduce((sum, f) => sum + manifest.sizes[weightKey(model, f)], manifest.tokenizerBytes)
    : null;
  return { available: true, sizeBytes };
}

/** Whether `model` can start with no network (weights AND tokenizer stored). */
export async function isModelAvailableOffline(model: DiffusionModelId): Promise<boolean> {
  return (await getModelOfflineStatus(model)).available;
}

/**
 * Download everything `model` needs into the weight store. Files already stored
 * are skipped, so a cancelled or failed run resumes where it stopped. Rejects
 * with an `AbortError` when `signal` aborts.
 */
export async function prepareModelOffline(opts: PrepareModelOfflineOptions): Promise<void> {
  const { model, signal } = opts;
  const descriptor = MODEL_REGISTRY[model];
  if (descriptor.engine !== 'lcm-diffusion') {
    throw new Error(`Model '${model}' cannot be made available offline yet.`);
  }
  const store = weightStore();
  if (!store.canPersist()) throw new Error('Offline storage (IndexedDB) is not available in this browser.');

  const source = {
    apiKey: opts.authToken,
    weightSources: opts.weightSources ?? DEFAULT_WEIGHT_SOURCES,
    r2Base: deriveR2Base(opts.baseUrl),
  };
  const files = modelWeightFiles(descriptor);
  const previous = await readManifest(model);
  const sizes: Record<string, number> = {};
  for (const f of files) {
    const known = previous?.sizes[weightKey(model, f)];
    if (known !== undefined) sizes[weightKey(model, f)] = known;
  }

  let doneBytes = 0; // bytes of files finished in this run
  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) throw abortError();
    const file = files[i];
    const key = weightKey(model, file);
    const report = (current: number, currentTotal: number | null): void => {
      const projected = files.map((f) => sizes[weightKey(model, f)]);
      const totalBytes =
        currentTotal !== null && projected.every((s, idx) => s !== undefined || idx === i)
          ? projected.reduce<number>((sum, s, idx) => sum + (idx === i ? currentTotal : s), 0)
          : null;
      opts.onProgress?.({ loadedBytes: doneBytes + current, totalBytes, file, fileIndex: i + 1, fileCount: files.length });
    };

    if (await store.has(key)) {
      // Already stored (a normal run, or a resumed download) — nothing to fetch.
      const size = sizes[key] ?? 0;
      doneBytes += size;
      report(0, size || null);
      continue;
    }

    let persistFailed = false;
    let buffer: ArrayBuffer;
    try {
      buffer = await getOrFetchWeight({
        ...weightRequest(descriptor, file, source),
        signal,
        onProgress: report,
        onPersistFailed: () => {
          persistFailed = true;
        },
      });
    } catch (err) {
      // getOrFetchWeight turns an aborted fetch into "All weight sources failed".
      if (signal?.aborted) throw abortError();
      throw err;
    }
    if (persistFailed) throw new Error(`${file} could not be saved for offline use (storage full or blocked).`);
    sizes[key] = buffer.byteLength;
    doneBytes += buffer.byteLength;
  }

  if (signal?.aborted) throw abortError();
  let tokenizerBytes: number;
  try {
    tokenizerBytes = await storeTokenizerFiles(descriptor.tokenizerRepo, signal);
  } catch (err) {
    if (signal?.aborted) throw abortError();
    throw err;
  }

  const manifest: OfflineManifest = { v: 1, sizes, tokenizerBytes };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  // Size bookkeeping only — availability never depends on it.
  await store.write(manifestKey(model), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}
