/**
 * The download manager for catalog models published as ONE Hugging Face file (the
 * `hf-file` source — the Bonsai GGUFs the `bfi` engine loads). Weights land in Cache
 * Storage under their resolve URL, so they survive reloads, are evictable by the browser
 * like any site data, and stream back out without ever being held in memory whole.
 *
 * Downloads happen only when the picker asks (PRD 34 §3.4) — never from a chat turn. The
 * fetch carries no credentials: the files are public, and a credential-free cross-origin
 * request is also what a `COEP: credentialless` page may make.
 */

import { localCatalogModel, type LocalCatalogModel } from '@builderforce/local-inference';

/** The Cache Storage bucket the page engines' own downloads live in. */
export const LOCAL_MODEL_CACHE = 'builderforce-local-models';

/** Where a published file is fetched from (Hugging Face redirects to its CDN). */
export function hfResolveUrl(repo: string, file: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${file}`;
}

/** The stored size, recorded at download (a cached Response keeps headers verbatim). */
const BYTES_HEADER = 'x-builderforce-model-bytes';

export type HfFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface HfModelStore {
  status(ref: string): Promise<'absent' | 'ready'>;
  /** Stream the file into the cache, reporting 0..1. A failed or cancelled download
   *  leaves nothing behind (Cache Storage `put` is all-or-nothing). */
  download(ref: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<void>;
  remove(ref: string): Promise<void>;
  /** The cached file as a byte stream plus its size — what `BfiEngine.load` takes. */
  open(ref: string): Promise<{ stream: ReadableStream<Uint8Array>; bytes: number }>;
}

export interface HfModelStoreOptions {
  caches?: CacheStorage;
  fetch?: HfFetch;
}

/** The catalog row for an `hf-file` model, or a thrown `unknown_model`. */
function hfRow(ref: string): LocalCatalogModel & { source: { kind: 'hf-file'; repo: string; file: string } } {
  const row = localCatalogModel(ref);
  if (!row || row.source.kind !== 'hf-file') throw new Error(`unknown_model: ${ref}`);
  return row as LocalCatalogModel & { source: { kind: 'hf-file'; repo: string; file: string } };
}

const urlOf = (ref: string): string => {
  const { source } = hfRow(ref);
  return hfResolveUrl(source.repo, source.file);
};

export function createHfModelStore(options: HfModelStoreOptions = {}): HfModelStore {
  const storage = (): CacheStorage => {
    const caches = options.caches ?? (globalThis as { caches?: CacheStorage }).caches;
    if (!caches) throw new Error('cache_storage_unavailable');
    return caches;
  };
  const fetchImpl: HfFetch = options.fetch ?? ((input, init) => fetch(input, init));

  /** The cached entry, or undefined. Looks only — no bucket is created to answer. */
  const entry = async (ref: string): Promise<Response | undefined> => {
    const caches = storage();
    if (!(await caches.has(LOCAL_MODEL_CACHE))) return undefined;
    return (await caches.open(LOCAL_MODEL_CACHE)).match(urlOf(ref));
  };

  return {
    async status(ref) {
      try {
        return (await entry(ref)) ? 'ready' : 'absent';
      } catch {
        return 'absent';
      }
    },

    async download(ref, onProgress, signal) {
      const row = hfRow(ref);
      const url = urlOf(ref);
      // Ask once for durable storage so a gigabyte is not the first thing evicted.
      await (globalThis as { navigator?: { storage?: { persist?(): Promise<boolean> } } }).navigator?.storage
        ?.persist?.()
        .catch(() => false);
      const res = await fetchImpl(url, { credentials: 'omit', ...(signal ? { signal } : {}) });
      if (!res.ok || !res.body) throw new Error(`download_failed: HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || row.bytes;
      let loaded = 0;
      const counted = res.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            loaded += chunk.byteLength;
            onProgress?.(Math.min(1, loaded / total));
            controller.enqueue(chunk);
          },
        }),
      );
      const cache = await storage().open(LOCAL_MODEL_CACHE);
      await cache.put(
        url,
        new Response(counted, {
          headers: { 'content-type': 'application/octet-stream', [BYTES_HEADER]: String(total) },
        }),
      );
      if (loaded !== total) {
        await cache.delete(url);
        throw new Error(`download_incomplete: ${loaded} of ${total} bytes`);
      }
    },

    async remove(ref) {
      const caches = storage();
      if (!(await caches.has(LOCAL_MODEL_CACHE))) return;
      await (await caches.open(LOCAL_MODEL_CACHE)).delete(urlOf(ref));
    },

    async open(ref) {
      const res = await entry(ref);
      if (!res?.body) throw new Error(`model_not_downloaded: ${ref}`);
      const bytes = Number(res.headers.get(BYTES_HEADER)) || hfRow(ref).bytes;
      return { stream: res.body, bytes };
    },
  };
}
