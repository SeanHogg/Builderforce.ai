/**
 * Weight cache — IndexedDB-backed storage for downloaded ONNX model files.
 *
 * Used by diffusion-engine to avoid re-downloading multi-GB weights on every
 * page load. Falls back to direct fetch when IDB is unavailable.
 *
 * Source chain (configured per VideoEngine instance via `weightSources`):
 *   1. r2-proxy        → https://api.builderforce.ai/api/studio/weights/<path>
 *   2. huggingface-cdn → https://huggingface.co/<repo>/resolve/main/<path>
 *
 * The cache key is the canonical model file path so the same weights satisfy
 * either source.
 */

import type { WeightSource } from '../types';

const DB_NAME = 'builderforce-studio-weights';
const DB_VERSION = 1;
const STORE_NAME = 'weights';

const DEFAULT_R2_BASE = 'https://api.builderforce.ai/api/studio/weights';
const HF_BASE = 'https://huggingface.co';

interface FetchOptions {
  /** Canonical cache key — typically the model file path like 'lcm-dreamshaper-v7/unet/model.onnx'. */
  cacheKey: string;
  /** HuggingFace repo to fall back to when r2-proxy misses. */
  hfRepo: string;
  /** Path within the HF repo. */
  hfPath: string;
  /** Source preference order. */
  sources: WeightSource[];
  /** Builderforce API key for authenticated r2-proxy requests. */
  apiKey: string;
  /** Override the r2-proxy base URL (defaults to https://api.builderforce.ai/api/studio/weights). */
  r2Base?: string;
  /** Progress callback in bytes downloaded. */
  onProgress?: (bytesLoaded: number, bytesTotal: number | null) => void;
  signal?: AbortSignal;
}

export async function getOrFetchWeight(opts: FetchOptions): Promise<ArrayBuffer> {
  const cached = await readFromIdb(opts.cacheKey);
  if (cached) {
    opts.onProgress?.(cached.byteLength, cached.byteLength);
    return cached;
  }

  const buffer = await fetchFromAnySource(opts);
  await writeToIdb(opts.cacheKey, buffer).catch(() => {
    // IDB write failure is non-fatal — the consumer just re-downloads next time.
  });
  return buffer;
}

async function fetchFromAnySource(opts: FetchOptions): Promise<ArrayBuffer> {
  const errors: Error[] = [];
  for (const source of opts.sources) {
    try {
      return await fetchFromSource(source, opts);
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }
  const detail = errors.map((e) => e.message).join(' | ');
  throw new Error(`All weight sources failed for ${opts.cacheKey}: ${detail}`);
}

async function fetchFromSource(source: WeightSource, opts: FetchOptions): Promise<ArrayBuffer> {
  const { url, headers } = resolveSource(source, opts);
  const res = await fetch(url, { headers, signal: opts.signal });
  if (!res.ok || !res.body) {
    throw new Error(`${source} ${url} → HTTP ${res.status}`);
  }

  const totalHeader = res.headers.get('content-length');
  const total = totalHeader ? Number(totalHeader) : null;

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    opts.onProgress?.(received, total);
  }

  const buf = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buf.buffer;
}

function resolveSource(
  source: WeightSource,
  opts: FetchOptions
): { url: string; headers: Record<string, string> } {
  if (source === 'r2-proxy') {
    const base = opts.r2Base ?? DEFAULT_R2_BASE;
    return {
      url: `${base}/${opts.cacheKey}`,
      headers: { Authorization: `Bearer ${opts.apiKey}` },
    };
  }
  return {
    url: `${HF_BASE}/${opts.hfRepo}/resolve/main/${opts.hfPath}`,
    headers: {},
  };
}

async function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function readFromIdb(key: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
    req.onerror = () => resolve(null);
  });
}

async function writeToIdb(key: string, value: ArrayBuffer): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IDB write failed'));
  });
}
