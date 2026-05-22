/**
 * Image-generation vendor types.
 *
 * Capability shape is parallel to the chat `VendorModule` (in `../vendors/types.ts`)
 * but lives in its own registry because the request/response shapes differ
 * enough that a single interface would be all-optional. What IS shared is
 * deliberately re-exported from the chat side to avoid duplication:
 *
 *   - `VendorRetryableError` / `VendorFatalError` — same cascade classification
 *   - `fetchWithVendorTimeout` — same per-call timeout + abort semantics
 *   - `CASCADE_STATUSES` / `AUTH_STATUSES` — same HTTP-status → cascade-vs-fatal map
 *
 * Adding a new image vendor:
 *   1. Add the literal id to `ImageVendorId`.
 *   2. Add a `<NAME>_API_KEY` field to `ImageVendorEnv` (and `api/src/env.ts`).
 *   3. Implement an `ImageVendorModule` and register it in `./registry.ts`.
 */

import {
  AUTH_STATUSES,
  CASCADE_STATUSES,
  VendorFatalError,
  VendorRetryableError,
  fetchWithVendorTimeout,
} from '../vendors/types';

// Re-export the shared primitives so image vendor modules import them from
// this barrel instead of reaching across into `../vendors/types`. Keeps the
// image surface's dependency on the chat module explicit and narrow.
export {
  AUTH_STATUSES,
  CASCADE_STATUSES,
  VendorFatalError,
  VendorRetryableError,
  fetchWithVendorTimeout,
};

export type ImageVendorId = 'together' | 'fluxapi';

/** Tier classification per image model. Mirrors AiModelTier so the same
 *  FREE/PREMIUM cap pattern applies. */
export type ImageModelTier = 'FREE' | 'STANDARD' | 'PREMIUM' | 'ULTRA';

export interface ImageVendorEnv {
  TOGETHER_API_KEY?: string | null;
  FLUX_API_KEY?: string | null;
}

export interface ImageGenParams {
  apiKey: string;
  /** Model id in the vendor's own namespace. */
  model: string;
  /** Text prompt. Required. */
  prompt: string;
  /** OpenAI-compatible size string, e.g. "1024x1024" or "1792x1024".
   *  Each vendor maps to its own (aspectRatio / width+height). */
  size?: string;
  /** "url" (default) returns a hosted URL; "b64_json" returns base64-encoded image bytes. */
  responseFormat?: 'url' | 'b64_json';
  /** Number of images (default 1). Vendors that don't support batching
   *  silently clamp to 1 — caller can detect via `data.length`. */
  n?: number;
  /** Vendor-specific passthrough (`steps`, `guidance`, `safetyTolerance`, etc.). */
  extraBody?: Record<string, unknown>;
  /** Per-vendor-call deadline. Overrides `DEFAULT_IMAGE_VENDOR_CALL_TIMEOUT_MS`. */
  timeoutMs?: number;
}

export interface ImageGenResultEntry {
  url?: string;
  b64_json?: string;
  /** Vendor-side prompt revision (some vendors auto-rewrite for safety / quality). */
  revised_prompt?: string;
}

export interface ImageGenResult {
  /** ISO seconds timestamp — OpenAI-compatible. */
  created: number;
  data: ImageGenResultEntry[];
  /** Echoed back so callers can confirm which model resolved. */
  model: string;
}

export interface ImageVendorModelEntry {
  id: string;
  label: string;
  brand: string;
  tier: ImageModelTier;
}

export interface ImageVendorModule {
  id: ImageVendorId;
  apiKeyFrom(env: ImageVendorEnv): string | null;
  catalog: ReadonlyArray<ImageVendorModelEntry>;
  tierFor(modelId: string): ImageModelTier;
  generate(params: ImageGenParams): Promise<ImageGenResult>;
}

/**
 * Per-vendor-call timeout default for image generation. Image gen is
 * naturally slow (5–30s synchronous, longer for async-poll vendors) so the
 * chat-side 25s default is too short. 45s gives the cascade room for a
 * primary + a fallback within a 90s outer budget.
 *
 * Per-call override via `ImageGenParams.timeoutMs` flows through to
 * `fetchWithVendorTimeout` so a single long-running prompt can stretch
 * beyond this default when needed.
 */
export const DEFAULT_IMAGE_VENDOR_CALL_TIMEOUT_MS = 45_000;

/**
 * Resolve the per-call timeout for an image vendor call. Caller-supplied
 * `timeoutMs` wins; otherwise the image-specific default applies. Single
 * place that knows about the image-vs-chat default split, so vendor modules
 * stay timeout-agnostic.
 */
export function imageVendorTimeoutMs(callerSupplied?: number): number {
  return callerSupplied && callerSupplied > 0 ? callerSupplied : DEFAULT_IMAGE_VENDOR_CALL_TIMEOUT_MS;
}

/**
 * Shared HTTP transport for OpenAI-shaped image-gen vendors. Lifts the
 * fetch-with-timeout + cascade-vs-auth-vs-fatal classification that every
 * image vendor needs into one place, so adding a vendor is just "implement
 * `buildBody` and `parseResponse`". Mirrors `executeChatCompletion` for
 * chat vendors.
 *
 * Throws:
 *   - `VendorRetryableError` for CASCADE_STATUSES (404/408/429/5xx) and
 *     AUTH_STATUSES (401/403 — surfaced separately via console.error so
 *     config bugs are visible).
 *   - `VendorFatalError` for everything else (400 etc.) — caller surfaces.
 */
export async function executeImageGeneration(args: {
  vendorId: ImageVendorId;
  endpoint: string;
  apiKey: string;
  model: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  parseResponse: (raw: unknown) => ImageGenResult;
}): Promise<ImageGenResult> {
  const { vendorId, endpoint, apiKey, model, body, headers, timeoutMs, parseResponse } = args;
  const resp = await fetchWithVendorTimeout(vendorId, model, endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  }, imageVendorTimeoutMs(timeoutMs));

  if (resp.ok) {
    const raw = await resp.json();
    return parseResponse(raw);
  }

  const errText = (await resp.text()).slice(0, 400);

  if (CASCADE_STATUSES.has(resp.status)) {
    throw new VendorRetryableError(vendorId, model, resp.status, errText.slice(0, 240));
  }

  if (AUTH_STATUSES.has(resp.status)) {
    console.error(
      `[imageVendors] ${vendorId}/${model} auth ${resp.status} — check ${vendorId.toUpperCase()}_API_KEY. Failing over to next model.`,
      errText.slice(0, 200),
    );
    throw new VendorRetryableError(vendorId, model, resp.status, `auth ${resp.status}: ${errText.slice(0, 200)}`);
  }

  throw new VendorFatalError(vendorId, resp.status, errText);
}
