/**
 * Tokenizer store — the CLIP tokenizer files, kept in the SAME IndexedDB weight
 * store as the model weights (no second store).
 *
 * `AutoTokenizer.from_pretrained` always touches the network on a cold start
 * (transformers.js' Cache API entry is best-effort and keyed by the HF host).
 * The two JSON files the tokenizer is built from are tiny, so "available
 * offline" stores them next to the weights under `tokenizer/<repo>/<file>` and
 * the engine builds the tokenizer straight from them — no network, no
 * dependence on transformers.js' own cache behaviour.
 *
 * Values are raw `ArrayBuffer`s like every other entry in the store (the
 * frozen storage format, see `../residency/weight-store.ts`).
 */

import { CLIPTokenizer, type PreTrainedTokenizer } from '@huggingface/transformers';
import { weightStore } from '../residency/weight-store';
import { HF_BASE } from '../weight-cache';

const TOKENIZER_FILES = ['tokenizer.json', 'tokenizer_config.json'] as const;

/** The store key for one tokenizer file of `repo`. */
export function tokenizerCacheKey(repo: string, file: (typeof TOKENIZER_FILES)[number]): string {
  return `tokenizer/${repo}/${file}`;
}

/** Whether both tokenizer files for `repo` are stored. */
export async function isTokenizerStored(repo: string): Promise<boolean> {
  const store = weightStore();
  const have = await Promise.all(TOKENIZER_FILES.map((f) => store.has(tokenizerCacheKey(repo, f))));
  return have.every(Boolean);
}

/** The tokenizer built from the stored files, or null when they are not (both) stored. */
export async function loadStoredTokenizer(repo: string): Promise<PreTrainedTokenizer | null> {
  const store = weightStore();
  const [json, config] = await Promise.all(TOKENIZER_FILES.map((f) => store.read(tokenizerCacheKey(repo, f))));
  if (!json || !config) return null;
  try {
    const decode = (buf: ArrayBuffer): unknown => JSON.parse(new TextDecoder().decode(buf));
    // SD's tokenizer is the standard CLIP BPE (see `tokenizerRepo` in the registry).
    return new CLIPTokenizer(decode(json) as never, decode(config) as never);
  } catch {
    // Corrupt entry — a miss; the caller falls back to the network loader.
    return null;
  }
}

/**
 * Download any missing tokenizer files for `repo` from Hugging Face into the
 * store. Resolves to the bytes held for the tokenizer. Throws when a download
 * fails or the bytes could not be persisted.
 */
export async function storeTokenizerFiles(repo: string, signal?: AbortSignal): Promise<number> {
  const store = weightStore();
  let bytes = 0;
  for (const file of TOKENIZER_FILES) {
    const key = tokenizerCacheKey(repo, file);
    let buf = await store.read(key);
    if (!buf) {
      const url = `${HF_BASE}/${repo}/resolve/main/${file}`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`tokenizer ${url} → HTTP ${res.status}`);
      buf = await res.arrayBuffer();
      if (!(await store.write(key, buf))) {
        throw new Error(`The tokenizer file ${file} could not be saved for offline use.`);
      }
    }
    bytes += buf.byteLength;
  }
  return bytes;
}
