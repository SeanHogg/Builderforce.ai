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
  imageModelsByTierPrefixed,
  imageVendorKeyBound,
  tierForImageModel,
  vendorForImageModel,
  type ImageDispatchAttempt,
  type ImageGenResult,
  type ImageVendorEnv,
  type ImageVendorId,
} from './imageVendors';
import { composeFreeCappedCascade } from './cascadeComposer';
import { loadCooldowns, recordFailure } from '../../infrastructure/auth/cooldownStore';
import type { VendorId } from './vendors';

/** Namespace image cooldown keys as `image:<vendor>` in the shared cooldown
 *  store so they never collide with chat-vendor cooldowns [1438]. The store
 *  treats `vendor` purely as a key string; the cast bridges the chat-typed API. */
const imageCooldownVendor = (v: ImageVendorId): VendorId => `image:${v}` as VendorId;
/** The `${vendor}/${model}` key shape `loadCooldowns` returns, image-namespaced. */
const imageCooldownKey = (m: string): string => `${imageCooldownVendor(vendorForImageModel(m))}/${m}`;

// ---------------------------------------------------------------------------
// Pool composition — derived from the image vendor catalog
// ---------------------------------------------------------------------------

/** Free-tier image model ids (Together) — VENDOR-PREFIXED so the dispatcher
 *  resolves the owning vendor by prefix, never by an ambiguous bare-id lookup
 *  (id-clash safe as the registry grows). */
export const FREE_IMAGE_MODEL_POOL: readonly string[] = imageModelsByTierPrefixed('FREE');

/** Paid-tier image model ids (FluxAPI) — vendor-prefixed (see above). */
export const PAID_IMAGE_MODEL_POOL: readonly string[] = imageModelsByTierPrefixed('STANDARD', 'PREMIUM', 'ULTRA');

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
 * True when a resolved image model is a FUNDED-overflow model — i.e. the
 * always-on premium fallback we append to every cascade and pay for on our own
 * FluxAPI key. Mirrors `isPaidOverflowModel` on the chat side so an image row
 * is flagged `llm_usage_log.paid_overflow` and counts against the tenant's
 * per-tenant `paid_overflow_daily_cap` (migration 0130). A model in the
 * tenant's own plan pool (Pro's paid FluxAPI tiers) is NOT overflow — only the
 * always-appended fallback is.
 */
export function isImagePaidOverflowModel(model: string | undefined | null): boolean {
  return !!model && PREMIUM_IMAGE_FALLBACK_MODELS.includes(model);
}

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
  /** True when the request resolved onto a FUNDED premium-fallback model
   *  ({@link isImagePaidOverflowModel}); the route stamps this on the usage
   *  row so it counts against the tenant's paid-overflow daily cap. */
  paidOverflow: boolean;
}

export type ImageProductName = 'builderforceImage' | 'builderforceImagePro';

/** Flat per-image charge against the legacy `total_tokens` ledger (retained for
 *  cost rollups). Image GENERATION is now capped by image credits, not these
 *  tokens — see `resolveImageCreditsDailyLimit`. Exported so the charge site and
 *  the credit-count query divide by the SAME constant (DRY). */
export const IMAGE_TOKEN_COST = 1000;

/** The `llm_product` labels image rows are logged under. Used to (a) EXCLUDE
 *  image rows from the chat token-cap sum and (b) sum them for the image-credit
 *  cap — one definition so the two never drift. */
export const IMAGE_PRODUCT_NAMES = ['builderforceImage', 'builderforceImagePro'] as const;

export interface ImageProxyEnv extends ImageVendorEnv {
  AUTH_CACHE_KV?: KVNamespace;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Round-robin cursor for the FREE image slice — boxed for sharing with
 *  `composeFreeCappedCascade`, mirrors `chatRequestCursor` in LlmProxyService. */
const imageRequestCursor: { value: number } = { value: 0 };

/** Test-only: reset the round-robin free-slice cursor so each test is
 *  deterministic regardless of how many generate() calls preceded it. */
export function _resetImageCursor(): void { imageRequestCursor.value = 0; }

export interface ImageProxyOptions {
  modelPool?: readonly string[];
  productName?: ImageProductName;
  /** When true, drop the always-on premium fallback so a tenant that has hit
   *  its paid-overflow daily cap stops resolving onto our funded FluxAPI key
   *  (the free pool still serves). Mirrors `disablePaidOverflow` on the chat
   *  proxy. */
  disablePaidOverflow?: boolean;
}

export class ImageProxyService {
  private readonly env: ImageProxyEnv;
  private readonly modelPool: readonly string[];
  private readonly productName: ImageProductName;
  private readonly disablePaidOverflow: boolean;

  constructor(env: ImageProxyEnv, options?: ImageProxyOptions) {
    this.env = env;
    this.modelPool = options?.modelPool ?? FREE_IMAGE_MODEL_POOL;
    this.productName = options?.productName ?? 'builderforceImage';
    this.disablePaidOverflow = options?.disablePaidOverflow ?? false;
  }

  /** Forward an image generation request through the configured pool. */
  async generate(body: ImageGenerationRequest): Promise<ImageProxyResult> {
    const callerModel = typeof body.model === 'string' && body.model.length > 0 ? body.model : null;
    const seed: readonly string[] = callerModel
      ? [callerModel, ...this.modelPool.filter((m) => m !== callerModel)]
      : this.modelPool;

    // Skip models cooled by a recent failure (same per-model/per-vendor cooldown
    // chat uses), so a rate-limited Together model isn't re-fired every request
    // and waste 1–2s before falling through [1438].
    const cooled = await loadCooldowns(
      this.env,
      seed.map((m) => ({ vendor: imageCooldownVendor(vendorForImageModel(m)), model: m })),
    );
    const candidates = this.buildCandidateChain(seed, cooled);
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
      // Record any pre-success failures so the cooled model is skipped next time
      // (fire-and-forget — never delay a successful response).
      void this.recordImageFailures(result.attempts);
      return {
        body: { created: result.created, model: result.model, data: result.data },
        resolvedModel: result.modelUsed,
        resolvedVendor: result.vendorUsed,
        retries: result.attempts.length,
        failovers: attemptsToFailovers(result.attempts),
        paidOverflow: isImagePaidOverflowModel(result.modelUsed),
      };
    } catch (err) {
      const errAttempts = err instanceof ImageCascadeExhaustedError ? err.attempts : [];
      // Await on the exhausted path so the next request immediately sees the
      // cooldowns (mirrors chat's applyCooldowns-before-surfacing-429).
      await this.recordImageFailures(errAttempts);
      return this.exhaustedResult(candidates, err, errAttempts);
    }
  }

  /** Persist per-model/per-vendor cooldowns for failed image attempts. */
  private async recordImageFailures(attempts: ReadonlyArray<ImageDispatchAttempt>): Promise<void> {
    await Promise.all(
      attempts.map((a) => recordFailure(this.env, imageCooldownVendor(a.vendor), a.model, a.status)),
    );
  }

  /**
   * Apply the 2-free-then-premium cap via the shared cascade composer.
   * A model is "unavailable" when its vendor key is unbound OR it's currently
   * cooled by a recent failure [1438] (`cooled` holds image-namespaced
   * `${vendor}/${model}` keys from `loadCooldowns`).
   */
  private buildCandidateChain(seed: readonly string[], cooled: ReadonlySet<string> = new Set()): string[] {
    const env = this.imageVendorEnv();
    const keyBound = (m: string) => imageVendorKeyBound(env, vendorForImageModel(m));
    return composeFreeCappedCascade({
      seed,
      premiumFallback: this.disablePaidOverflow ? [] : PREMIUM_IMAGE_FALLBACK_MODELS,
      freeBudget: FREE_IMAGE_ATTEMPT_BUDGET,
      tierOf: tierForImageModel,
      isUnavailable: (m) => !keyBound(m) || cooled.has(imageCooldownKey(m)),
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
      // A cascade-exhausted run produced no billable image, so it is never
      // counted as funded-overflow spend.
      paidOverflow: false,
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
  opts?: { disablePaidOverflow?: boolean },
): ImageProxyService {
  return new ImageProxyService(env, {
    modelPool: imageModelPoolForPlan(effectivePlan, premiumOverride),
    productName: imageProductNameForPlan(effectivePlan, premiumOverride),
    ...(opts?.disablePaidOverflow ? { disablePaidOverflow: true } : {}),
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
