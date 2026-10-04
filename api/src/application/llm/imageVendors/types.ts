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
 *
 * Vendors that answer with raw image BYTES (Cloudflare's SD models, Hugging
 * Face, Pollinations) or inline base64 (Google, Cloudflare Flux) normalise
 * through {@link imageResultFromBase64} so every caller sees the same
 * OpenAI-shaped `{ data: [{ url | b64_json }] }` regardless of who served it.
 */

import { bytesToBase64 } from '../../../domain/shared/bytes';
import {
  AUTH_STATUSES,
  CASCADE_STATUSES,
  VendorFatalError,
  VendorRetryableError,
  executeVendorPost,
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

export type ImageVendorId = 'cloudflare' | 'together' | 'huggingface' | 'pollinations' | 'googleai' | 'fluxapi';

/** Tier classification per image model. Mirrors AiModelTier so the same
 *  FREE/PREMIUM cap pattern applies. */
export type ImageModelTier = 'FREE' | 'STANDARD' | 'PREMIUM' | 'ULTRA';

export interface ImageVendorEnv {
  TOGETHER_API_KEY?: string | null;
  FLUX_API_KEY?: string | null;
  /** Cloudflare Workers AI — both must be bound (token + account id in the URL). */
  CLOUDFLARE_AI_API_TOKEN?: string | null;
  CLOUDFLARE_ACCOUNT_ID?: string | null;
  /** Google AI (Gemini) — the same key the chat surface uses. */
  GOOGLE_API_KEY?: string | null;
  /** Hugging Face Inference Providers token (`hf_*`). */
  HF_API_TOKEN?: string | null;
  /** Pollinations SECRET key (`sk_…`, enter.pollinations.ai). Unbound → skipped. */
  POLLINATIONS_API_KEY?: string | null;
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
  /** `GET` for prompt-in-URL vendors (Pollinations). Default `POST`. */
  method?: 'POST' | 'GET';
  /** Override the `Authorization` header (`null` omits it) — see `executeVendorPost`. */
  authorization?: string | null;
  /** Read the 2xx body as bytes-or-JSON ({@link readImageBody}) instead of JSON only. */
  binary?: boolean;
  parseResponse: (raw: unknown) => ImageGenResult;
}): Promise<ImageGenResult> {
  const { vendorId, endpoint, apiKey, model, body, headers, timeoutMs, parseResponse } = args;
  return executeVendorPost<ImageGenResult>({
    vendorId,
    endpoint,
    apiKey,
    model,
    body,
    ...(headers ? { headers } : {}),
    ...(args.method ? { method: args.method } : {}),
    ...(args.authorization !== undefined ? { authorization: args.authorization } : {}),
    ...(args.binary ? { readOk: readImageBody } : {}),
    timeoutMs: imageVendorTimeoutMs(timeoutMs),
    logPrefix: 'imageVendors',
    authFailoverNoun: 'model',
    parseResponse,
    // No `onEmbeddedError` — the image surface has never had a 200-embedded-error
    // guard (image bodies aren't OpenAI `{ error }`-shaped); behavior preserved.
    onFatal: (vId, m, status, errText): never => {
      // 402 = this vendor's credit/quota is spent (Hugging Face's monthly free
      // credit, a lapsed Pollinations tier). Another vendor can still serve the
      // same prompt, so it cascades rather than failing the whole request.
      if (status === 402) throw new VendorRetryableError(vId, m, status, `payment required: ${errText.slice(0, 200)}`);
      throw new VendorFatalError(vId, status, errText);
    },
  });
}

// ---------------------------------------------------------------------------
// Shared request/response shaping — one copy for every vendor
// ---------------------------------------------------------------------------

/** "1024x1024" → { width: 1024, height: 1024 }. Returns undefined on bad input. */
export function parseImageSize(size?: string): { width: number; height: number } | undefined {
  if (!size) return undefined;
  const m = /^(\d+)x(\d+)$/.exec(size.trim());
  if (!m) return undefined;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width === 0 || height === 0) return undefined;
  return { width, height };
}

/**
 * Convert an OpenAI-style "WxH" size into an aspect-ratio string. The ladder
 * covers "21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "9:21"; unknown or
 * malformed sizes fall back to "1:1" so the request still succeeds. Vendors
 * whose accepted set is narrower clamp the result themselves.
 */
export function sizeToAspectRatio(size?: string): string {
  const dim = parseImageSize(size);
  if (!dim) return '1:1';
  const r = dim.width / dim.height;
  if (r >= 2.2)  return '21:9';
  if (r >= 1.6)  return '16:9';
  if (r >= 1.25) return '4:3';
  if (r >= 0.85) return '1:1';
  if (r >= 0.65) return '3:4';
  if (r >= 0.45) return '9:16';
  return '9:21';
}

/** A 2xx image body as {@link readImageBody} hands it to `parseResponse`. */
export type ImageBody =
  | { kind: 'bytes'; base64: string; mimeType: string }
  | { kind: 'json'; raw: unknown };

/**
 * Read a 2xx body that may be raw image bytes OR a JSON envelope. Cloudflare
 * answers SD models with `image/png` bytes but Flux with `{ result: { image } }`;
 * Hugging Face and Pollinations answer with bytes. Branching on `Content-Type`
 * once here keeps every vendor's `parseResponse` a pure shape mapping.
 */
export async function readImageBody(resp: Response): Promise<ImageBody> {
  const contentType = (resp.headers.get('Content-Type') ?? '').toLowerCase();
  if (contentType.startsWith('image/')) {
    return { kind: 'bytes', base64: bytesToBase64(await resp.arrayBuffer()), mimeType: contentType.split(';')[0]!.trim() };
  }
  return { kind: 'json', raw: await resp.json() };
}

/**
 * Build the normalised result for a vendor that produced base64 image data.
 * `b64_json` callers get the bare base64 (OpenAI parity); `url` callers get a
 * `data:` URL carrying the REAL mime type (a JPEG labelled `image/png` renders
 * but mislabels downloads). The gateway route persists `data:` URLs to the
 * tenant asset store before responding — see `persistGeneratedImages`.
 */
export function imageResultFromBase64(
  model: string,
  base64: string,
  mimeType: string,
  responseFormat: ImageGenParams['responseFormat'],
): ImageGenResult {
  return {
    created: Math.floor(Date.now() / 1000),
    model,
    data: [responseFormat === 'b64_json' ? { b64_json: base64 } : { url: `data:${mimeType};base64,${base64}` }],
  };
}

/** Throw the retryable "200 with no image" error every vendor raises the same way,
 *  so the cascade advances instead of returning an empty result. */
export function noImageError(vendorId: ImageVendorId, model: string, detail = 'returned 200 with no image data'): VendorRetryableError {
  return new VendorRetryableError(vendorId, model, 502, `embedded:empty: ${vendorId} ${detail}`);
}
