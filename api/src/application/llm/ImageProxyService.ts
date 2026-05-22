/**
 * builderforceImage — image-generation proxy.
 *
 * Routes `POST /v1/images/generations` calls through the image vendor registry
 * with the same 2-free-then-premium cascade pattern as `LlmProxyService`:
 *   - Try at most `FREE_ATTEMPT_BUDGET` FREE-tier image models from the seed
 *   - Always append `PREMIUM_IMAGE_FALLBACK_MODELS` (Flux Kontext Pro) so a
 *     fully-saturated free pool still resolves to a successful response.
 *
 * Single entry point:
 *   - `generate(body)` — image generation. Caller-supplied `model` is treated
 *     as a *hint* (gateway-owned routing); strict-pin is not exposed for
 *     image gen yet (chat-side `modelStrict` is the precedent).
 */

import {
  ImageCascadeExhaustedError,
  dispatchImageVendor,
  imageModelsByTier,
  imageVendorKeyBound,
  tierForImageModel,
  vendorForImageModel,
  type ImageDispatchAttempt,
  type ImageGenResult,
  type ImageVendorEnv,
  type ImageVendorId,
} from './imageVendors';
import { composeFreeCappedCascade } from './cascadeComposer';

// ---------------------------------------------------------------------------
// Pool composition — derived from the image vendor catalog
// ---------------------------------------------------------------------------

/** Free-tier image model ids (Together). */
export const FREE_IMAGE_MODEL_POOL: readonly string[] = imageModelsByTier('FREE');

/** Paid-tier image model ids (FluxAPI). */
export const PAID_IMAGE_MODEL_POOL: readonly string[] = imageModelsByTier('STANDARD', 'PREMIUM', 'ULTRA');

/** Pro tries free first (cost-optimised), falls over to paid. */
export const PRO_IMAGE_MODEL_POOL: readonly string[] = [...FREE_IMAGE_MODEL_POOL, ...PAID_IMAGE_MODEL_POOL];

/**
 * Always-on premium image-gen fallback. Appended to *every* image cascade
 * so a fully-saturated free pool falls through to FluxAPI premium instead
 * of returning a 429 to the caller. Mirrors `PREMIUM_FALLBACK_MODELS` in
 * LlmProxyService.
 */
export const PREMIUM_IMAGE_FALLBACK_MODELS: readonly string[] = [
  'fluxapi/flux-kontext-pro',
];

/**
 * Maximum number of FREE-tier image attempts before falling through to the
 * premium fallback. Mirrors `FREE_ATTEMPT_BUDGET` in LlmProxyService — same
 * "successful response or premium fallback, never cascade-exhausted" guarantee.
 */
export const FREE_IMAGE_ATTEMPT_BUDGET = 2;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ImageGenerationRequest {
  /** Treated as a hint (gateway routes); echoed back via `_builderforce.resolvedModel`. */
  model?: string;
  prompt: string;
  /** OpenAI-compatible: "1024x1024" etc. */
  size?: string;
  n?: number;
  response_format?: 'url' | 'b64_json';
  /** Any extra vendor-specific passthrough. */
  [key: string]: unknown;
}

export interface ImageFailoverEvent {
  model: string;
  vendor: ImageVendorId;
  code: number;
}

export interface ImageProxyResult {
  /** Final upstream payload, normalised to the OpenAI image-gen shape. */
  body: ImageGenResult;
  /** Which model actually served the request. */
  resolvedModel: string;
  /** Vendor that owns the resolved model. */
  resolvedVendor: ImageVendorId;
  /** How many failovers happened before success (length of failovers[]). */
  retries: number;
  failovers: ImageFailoverEvent[];
}

export type ImageProductName = 'builderforceImage' | 'builderforceImagePro';

export interface ImageProxyEnv extends ImageVendorEnv {
  AUTH_CACHE_KV?: KVNamespace;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Round-robin cursor for the FREE image slice — boxed for sharing with
 *  `composeFreeCappedCascade`, mirrors `chatRequestCursor` in LlmProxyService. */
const imageRequestCursor: { value: number } = { value: 0 };

export interface ImageProxyOptions {
  modelPool?: readonly string[];
  productName?: ImageProductName;
}

export class ImageProxyService {
  private readonly env: ImageProxyEnv;
  private readonly modelPool: readonly string[];
  private readonly productName: ImageProductName;

  constructor(env: ImageProxyEnv, options?: ImageProxyOptions) {
    this.env = env;
    this.modelPool = options?.modelPool ?? FREE_IMAGE_MODEL_POOL;
    this.productName = options?.productName ?? 'builderforceImage';
  }

  /** Forward an image generation request through the configured pool. */
  async generate(body: ImageGenerationRequest): Promise<ImageProxyResult> {
    const callerModel = typeof body.model === 'string' && body.model.length > 0 ? body.model : null;
    const seed: readonly string[] = callerModel
      ? [callerModel, ...this.modelPool.filter((m) => m !== callerModel)]
      : this.modelPool;

    const candidates = this.buildCandidateChain(seed);
    if (candidates.length === 0) {
      return this.exhaustedResult(seed, new Error('No image vendor keys are bound. Configure TOGETHER_API_KEY and/or FLUX_API_KEY.'), []);
    }

    try {
      const result = await dispatchImageVendor({
        env: this.imageVendorEnv(),
        modelChain: candidates,
        prompt: body.prompt,
        ...(body.size ? { size: body.size } : {}),
        ...(body.n != null ? { n: body.n } : {}),
        ...(body.response_format ? { responseFormat: body.response_format } : {}),
        // Strip standard fields so the rest becomes vendor-specific passthrough.
        extraBody: stripStandardFields(body),
      });
      return {
        body: { created: result.created, model: result.model, data: result.data },
        resolvedModel: result.modelUsed,
        resolvedVendor: result.vendorUsed,
        retries: result.attempts.length,
        failovers: attemptsToFailovers(result.attempts),
      };
    } catch (err) {
      const errAttempts = err instanceof ImageCascadeExhaustedError ? err.attempts : [];
      return this.exhaustedResult(candidates, err, errAttempts);
    }
  }

  /**
   * Apply the 2-free-then-premium cap via the shared cascade composer.
   * Image surface has no cooldown store yet (see Gap Register), so the only
   * "unavailable" condition today is "vendor key not bound" — a missing
   * `TOGETHER_API_KEY` skips Together's models without burning an attempt.
   */
  private buildCandidateChain(seed: readonly string[]): string[] {
    const env = this.imageVendorEnv();
    const keyBound = (m: string) => imageVendorKeyBound(env, vendorForImageModel(m));
    return composeFreeCappedCascade({
      seed,
      premiumFallback: PREMIUM_IMAGE_FALLBACK_MODELS,
      freeBudget: FREE_IMAGE_ATTEMPT_BUDGET,
      tierOf: tierForImageModel,
      isUnavailable: (m) => !keyBound(m),
      cursor: imageRequestCursor,
    });
  }

  private imageVendorEnv(): ImageVendorEnv {
    return {
      TOGETHER_API_KEY: this.env.TOGETHER_API_KEY ?? null,
      FLUX_API_KEY:     this.env.FLUX_API_KEY     ?? null,
    };
  }

  private exhaustedResult(
    candidates: readonly string[],
    err: unknown,
    attempts: ReadonlyArray<ImageDispatchAttempt>,
  ): ImageProxyResult {
    const message = err instanceof Error ? err.message : String(err ?? 'image cascade exhausted');
    const failovers: ImageFailoverEvent[] = attempts.length > 0
      ? attempts.map((a) => ({ model: a.model, vendor: a.vendor, code: a.status }))
      : candidates.map((m) => ({ model: m, vendor: vendorForImageModel(m), code: 0 }));
    return {
      body: {
        created: Math.floor(Date.now() / 1000),
        model: candidates[candidates.length - 1] ?? this.modelPool[0] ?? '',
        data: [],
        // Embed the error envelope inside the OpenAI-compatible shape so
        // the route handler can serialize a 429 with details. The route
        // wraps this into a structured error response.
        ...({ _builderforceError: { message, failovers } } as Record<string, unknown>),
      },
      resolvedModel: candidates[candidates.length - 1] ?? this.modelPool[0] ?? '',
      resolvedVendor: vendorForImageModel(candidates[candidates.length - 1] ?? ''),
      retries: attempts.length,
      failovers,
    };
  }
}

function attemptsToFailovers(attempts: ImageDispatchAttempt[]): ImageFailoverEvent[] {
  return attempts.map((a) => ({ model: a.model, vendor: a.vendor, code: a.status }));
}

// ---------------------------------------------------------------------------
// Plan → image-proxy factory
// ---------------------------------------------------------------------------

export type EffectivePlan = 'free' | 'pro' | 'teams';

export function imageProductNameForPlan(effectivePlan: EffectivePlan, premiumOverride = false): ImageProductName {
  return premiumOverride || effectivePlan !== 'free' ? 'builderforceImagePro' : 'builderforceImage';
}

export function imageModelPoolForPlan(effectivePlan: EffectivePlan, premiumOverride = false): readonly string[] {
  return premiumOverride || effectivePlan !== 'free' ? PRO_IMAGE_MODEL_POOL : FREE_IMAGE_MODEL_POOL;
}

export function imageProxyForPlan(
  env: ImageProxyEnv,
  effectivePlan: EffectivePlan,
  premiumOverride = false,
): ImageProxyService {
  return new ImageProxyService(env, {
    modelPool: imageModelPoolForPlan(effectivePlan, premiumOverride),
    productName: imageProductNameForPlan(effectivePlan, premiumOverride),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STANDARD_IMAGE_BODY_FIELDS: ReadonlySet<string> = new Set([
  'model', 'prompt', 'size', 'n', 'response_format',
  // Gateway-side only — stripped before vendor dispatch:
  'useCase',
  'metadata',
]);

function stripStandardFields(body: ImageGenerationRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (STANDARD_IMAGE_BODY_FIELDS.has(key)) continue;
    out[key] = (body as Record<string, unknown>)[key];
  }
  return out;
}
