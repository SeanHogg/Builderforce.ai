/**
 * Ollama as a dense EMBEDDER for a host's knowledge index
 * (docs/design/deterministic-knowledge-index.md, "Where it runs") — only while Ollama
 * already holds an EMBEDDING model resident (`/api/ps`, its card's `capabilities`
 * naming `embedding`). Asking never loads a model: a host's index reads warmth through
 * {@link residentModelTracker} and embeds only through what is already resident.
 *
 * The embedder's fingerprint names the engine, the model, its weights' digest and its
 * width, so an index coded under another model (or a re-pull under the same name) is
 * re-embedded on idle, never mixed. Structurally an `EmbedderPort`
 * (`@seanhogg/builderforce-memory/knowledge`) — this package stays free of that import.
 */

import { fetchLocal, localAuthHeaders, normalizeLocalBaseUrl } from './endpoint.js';
import { DEFAULT_PROBE_TIMEOUT_MS, ollamaCard, ollamaLoadedModels, type FetchLike } from './probe.js';
import type { LocalEndpoint } from './runtimes.js';
import { residentModelTracker } from './logprobs.js';

/** The resident embedding model: the id to request it by and its weights' digest. */
export interface ResidentEmbedModel {
  model: string;
  digest?: string;
}

/** A batch embedder over one resident model — an `EmbedderPort` by shape. */
export interface LocalTextEmbedder {
  fingerprint: string;
  dims: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

/** A fixed text whose embedding's length is the model's width. */
const DIMS_PROBE = 'dimensions';

/** An embed batch is real work, unlike a localhost catalog read. */
export const OLLAMA_EMBED_TIMEOUT_MS = 60_000;

/**
 * The embedding model Ollama holds resident right now, or undefined when none is (or
 * the runtime is not answering). A resident CHAT model is not an embedder.
 */
export async function ollamaResidentEmbedModel(
  fetchImpl: FetchLike,
  endpoint: LocalEndpoint,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<ResidentEmbedModel | undefined> {
  for (const loaded of await ollamaLoadedModels(fetchImpl, endpoint, timeoutMs)) {
    const model = loaded.ids[0]!;
    const card = await ollamaCard(fetchImpl, endpoint, model, timeoutMs);
    if (card?.capabilities?.includes('embedding')) return { model, ...(loaded.digest ? { digest: loaded.digest } : {}) };
  }
  return undefined;
}

/** `POST /api/embed` — one vector per text, or a throw naming why there are none. */
export async function ollamaEmbed(
  fetchImpl: FetchLike,
  endpoint: LocalEndpoint,
  model: string,
  texts: readonly string[],
  timeoutMs: number = OLLAMA_EMBED_TIMEOUT_MS,
): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetchLocal(endpoint, fetchImpl, `${normalizeLocalBaseUrl(endpoint.baseUrl)}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...localAuthHeaders(endpoint) },
      body: JSON.stringify({ model, input: texts }),
      signal: abort.signal,
    });
    if (!res.ok) throw new Error(`ollama embed ${model}: HTTP ${res.status}`);
    const rows = ((await res.json()) as { embeddings?: unknown }).embeddings;
    if (!Array.isArray(rows) || rows.length !== texts.length) throw new Error(`ollama embed ${model}: expected ${texts.length} vectors`);
    return rows.map((row) => {
      if (!Array.isArray(row) || row.some((x) => typeof x !== 'number')) throw new Error(`ollama embed ${model}: malformed vector`);
      return Float32Array.from(row as number[]);
    });
  } finally {
    clearTimeout(timer);
  }
}

/** The fingerprint of an Ollama embedder: engine, model, weights' digest, width. */
export function ollamaEmbedFingerprint(resident: ResidentEmbedModel, dims: number): string {
  return `ollama:${resident.model}${resident.digest ? `@${resident.digest.slice(0, 12)}` : ''}:${dims}`;
}

/**
 * The embedder over a RESIDENT model — its width learned by one probe embed. Undefined
 * when the probe fails (the model unloaded since it was read as resident).
 */
export async function ollamaEmbedder(
  fetchImpl: FetchLike,
  endpoint: LocalEndpoint,
  resident: ResidentEmbedModel,
): Promise<LocalTextEmbedder | undefined> {
  const probe = await ollamaEmbed(fetchImpl, endpoint, resident.model, [DIMS_PROBE]).catch(() => undefined);
  const dims = probe?.[0]?.length ?? 0;
  if (dims <= 0) return undefined;
  return {
    fingerprint: ollamaEmbedFingerprint(resident, dims),
    dims,
    async embed(texts) {
      const out = await ollamaEmbed(fetchImpl, endpoint, resident.model, texts);
      for (const v of out) if (v.length !== dims) throw new Error(`ollama embed ${resident.model}: ${v.length} dims, expected ${dims}`);
      return out;
    },
  };
}

/**
 * A knowledge index's warm-embedder source over one Ollama endpoint (by shape the
 * `WarmEmbedderSource` of `@builderforce/agent-tools/knowledge-index`): warm while an
 * EMBEDDING model is resident there (`/api/ps`, read in the background), its port the
 * {@link ollamaEmbedder} over that model — one width probe per resident model. The ONE
 * Ollama source every Node host (the editor, on-prem) puts in the shared chain.
 */
export function ollamaEmbedderSource(fetchImpl: FetchLike, endpoint: LocalEndpoint): {
  id: 'ollama';
  warm(): boolean;
  port(): Promise<LocalTextEmbedder | undefined> | undefined;
} {
  const resident = residentModelTracker(() => ollamaResidentEmbedModel(fetchImpl, endpoint));
  const keyOf = (r: ResidentEmbedModel): string => `${r.model}@${r.digest ?? ''}`;
  const ports = new Map<string, Promise<LocalTextEmbedder | undefined>>();
  return {
    id: 'ollama',
    warm: () => resident() !== undefined,
    port() {
      const now = resident();
      if (!now) return undefined;
      const key = keyOf(now);
      let port = ports.get(key);
      if (!port) {
        port = ollamaEmbedder(fetchImpl, endpoint, now);
        ports.clear();
        ports.set(key, port);
        // A failed probe (it unloaded) is asked again once it is resident again.
        const asked = port;
        void asked.then((p) => { if (!p && ports.get(key) === asked) ports.delete(key); });
      }
      return port;
    },
  };
}
