/**
 * Embeddings vendor types.
 *
 * Capability shape parallels the chat `VendorModule` (`../vendors/types.ts`)
 * and the image `ImageVendorModule` (`../imageVendors/types.ts`) but lives in
 * its own registry because the request/response shapes (single `/embeddings`
 * call returning `{ data: [{ embedding }] }`) differ enough that a single
 * interface would be all-optional. What IS shared is deliberately re-exported
 * from the chat side to avoid duplication:
 *
 *   - `VendorRetryableError` / `VendorFatalError` — same cascade classification
 *   - `fetchWithVendorTimeout` — same per-call timeout + abort semantics
 *   - `CASCADE_STATUSES` / `AUTH_STATUSES` — same HTTP-status → cascade-vs-fatal map
 *
 * Adding a new embeddings vendor:
 *   1. Add the literal id to `EmbeddingVendorId`.
 *   2. Add a `<NAME>_API_KEY` field to `EmbeddingVendorEnv` (and `api/src/env.ts`).
 *   3. Implement an `EmbeddingVendorModule` and register it in `./registry.ts`.
 */

import {
  AUTH_STATUSES,
  CASCADE_STATUSES,
  VendorFatalError,
  VendorRetryableError,
  fetchWithVendorTimeout,
} from '../vendors/types';

// Re-export the shared primitives so embedding vendor modules import them from
// this barrel instead of reaching across into `../vendors/types`. Keeps the
// embeddings surface's dependency on the chat module explicit and narrow.
export {
  AUTH_STATUSES,
  CASCADE_STATUSES,
  VendorFatalError,
  VendorRetryableError,
  fetchWithVendorTimeout,
};

export type EmbeddingVendorId = 'openrouter' | 'voyage';

export interface EmbeddingVendorEnv {
  /** Resolved per-plan OpenRouter key — the proxy picks Free vs Pro before
   *  building this env (mirrors how the route already selects the key). */
  OPENROUTER_API_KEY?: string | null;
  /** Voyage AI key — embeddings failover. Optional; vendor is skipped when unset. */
  VOYAGE_API_KEY?: string | null;
}

export interface EmbeddingGenParams {
  apiKey: string;
  /** Model id in the vendor's own namespace. */
  model: string;
  /** Text to embed — single string or batch. Required. */
  input: string | string[];
  /** Vendor-specific passthrough (`dimensions`, `input_type`, etc.). */
  extraBody?: Record<string, unknown>;
  /** Per-vendor-call deadline. Overrides `DEFAULT_EMBEDDING_VENDOR_CALL_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/**
 * Normalized embeddings result — OpenAI-compatible `{ data: [{ embedding }] }`
 * envelope. `model` echoes which model actually resolved; `usage` carries the
 * vendor's token accounting when present. `raw` keeps the untouched upstream
 * body so the route can forward provider-specific fields unchanged.
 */
export interface EmbeddingGenResult {
  object: 'list';
  data: Array<{ object: 'embedding'; embedding: number[]; index: number }>;
  model: string;
  usage?: { prompt_tokens?: number; total_tokens?: number };
  /** Untouched upstream JSON body — forwarded verbatim by the route. */
  raw: unknown;
}

export interface EmbeddingVendorModelEntry {
  id: string;
  label: string;
  brand: string;
}

export interface EmbeddingVendorModule {
  id: EmbeddingVendorId;
  apiKeyFrom(env: EmbeddingVendorEnv): string | null;
  catalog: ReadonlyArray<EmbeddingVendorModelEntry>;
  /** The vendor's default model — used when the candidate chain reaches this
   *  vendor without a caller-pinned model that belongs to it. */
  defaultModel: string;
  embed(params: EmbeddingGenParams): Promise<EmbeddingGenResult>;
}

/**
 * Per-vendor-call timeout default for embeddings. Embeddings are fast (sub-2s
 * typical, batch up to ~10s) so the chat-side 25s default is generous — we keep
 * it tighter at 20s so a hung primary fails over to the alternate well within a
 * caller's request budget. Per-call override via `EmbeddingGenParams.timeoutMs`.
 */
export const DEFAULT_EMBEDDING_VENDOR_CALL_TIMEOUT_MS = 20_000;

export function embeddingVendorTimeoutMs(callerSupplied?: number): number {
  return callerSupplied && callerSupplied > 0
    ? callerSupplied
    : DEFAULT_EMBEDDING_VENDOR_CALL_TIMEOUT_MS;
}

/**
 * Shared HTTP transport for OpenAI-shaped `/embeddings` vendors. Lifts the
 * fetch-with-timeout + cascade-vs-auth-vs-fatal classification that every
 * embeddings vendor needs into one place, so adding a vendor is just "implement
 * `buildBody` + `parseResponse`". Mirrors `executeImageGeneration`.
 *
 * Throws:
 *   - `VendorRetryableError` for CASCADE_STATUSES (404/408/429/5xx) and
 *     AUTH_STATUSES (401/403 — surfaced via console.error so config bugs are
 *     visible) so the dispatcher fails over to the next vendor.
 *   - `VendorFatalError` for everything else (400 etc.) — caller surfaces.
 */
export async function executeEmbeddings(args: {
  vendorId: EmbeddingVendorId;
  endpoint: string;
  apiKey: string;
  model: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  parseResponse: (raw: unknown) => EmbeddingGenResult;
}): Promise<EmbeddingGenResult> {
  const { vendorId, endpoint, apiKey, model, body, headers, timeoutMs, parseResponse } = args;
  const resp = await fetchWithVendorTimeout(vendorId, model, endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  }, embeddingVendorTimeoutMs(timeoutMs));

  if (resp.ok) {
    const raw = await resp.json();
    // Some providers (notably OpenRouter) return 200 with { error: ... } embedded.
    if (raw && typeof raw === 'object' && 'error' in raw && (raw as Record<string, unknown>)['error'] != null) {
      const errObj = (raw as Record<string, unknown>)['error'];
      const msg = (errObj && typeof errObj === 'object' && 'message' in errObj
        ? String((errObj as Record<string, unknown>)['message'])
        : JSON.stringify(errObj)).slice(0, 240);
      throw new VendorRetryableError(vendorId, model, 0, `embedded: ${msg}`);
    }
    return parseResponse(raw);
  }

  const errText = (await resp.text()).slice(0, 400);

  if (CASCADE_STATUSES.has(resp.status)) {
    throw new VendorRetryableError(vendorId, model, resp.status, errText.slice(0, 240));
  }

  if (AUTH_STATUSES.has(resp.status)) {
    console.error(
      `[embeddingVendors] ${vendorId}/${model} auth ${resp.status} — check ${vendorId.toUpperCase()}_API_KEY. Failing over to next vendor.`,
      errText.slice(0, 200),
    );
    throw new VendorRetryableError(vendorId, model, resp.status, `auth ${resp.status}: ${errText.slice(0, 200)}`);
  }

  throw new VendorFatalError(vendorId, resp.status, errText);
}

/**
 * Normalize an OpenAI-shaped `/embeddings` response into `EmbeddingGenResult`.
 * Both OpenRouter and Voyage return this exact envelope, so the parser is
 * shared. Throws `VendorRetryableError` for a 200-with-no-data (some upstreams
 * accept the request then return an empty `data: []`) so the cascade advances.
 */
export function parseOpenAIEmbeddings(vendorId: EmbeddingVendorId, model: string, raw: unknown): EmbeddingGenResult {
  const r = raw as {
    data?: Array<{ embedding?: number[]; index?: number }>;
    model?: string;
    usage?: { prompt_tokens?: number; total_tokens?: number };
  };
  const data = Array.isArray(r.data) ? r.data : [];
  if (data.length === 0 || !data.some((d) => Array.isArray(d.embedding) && d.embedding.length > 0)) {
    throw new VendorRetryableError(vendorId, model, 502, `embedded:empty: ${vendorId} returned 200 with no embedding data`);
  }
  return {
    object: 'list',
    data: data.map((d, i) => ({
      object: 'embedding' as const,
      embedding: Array.isArray(d.embedding) ? d.embedding : [],
      index: typeof d.index === 'number' ? d.index : i,
    })),
    model: typeof r.model === 'string' ? r.model : model,
    ...(r.usage ? { usage: r.usage } : {}),
    raw,
  };
}
