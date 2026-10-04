import { reportCaughtError } from '../../observability/caughtErrorReporter';
/**
 * Image-vendor registry — single source of truth for which vendor owns which
 * image model, tier classification, and dispatch. Mirrors the chat
 * `vendors/registry.ts` shape so future shared tooling (admin UI, health
 * probes) can iterate both surfaces uniformly.
 *
 * Adding a new image vendor: add to `MODULES` below; the shared media
 * registry (`../mediaVendorRegistry.ts`) derives the rest.
 */

import { cloudflareImageModule } from './cloudflare';
import { fluxApiModule } from './fluxapi';
import { googleImageModule } from './googleai';
import { huggingFaceImageModule } from './huggingface';
import { pollinationsImageModule } from './pollinations';
import { togetherImageModule } from './together';
import {
  VendorRetryableError,
  type ImageGenParams,
  type ImageGenResult,
  type ImageModelTier,
  type ImageVendorEnv,
  type ImageVendorId,
  type ImageVendorModule,
} from './types';
import { createMediaVendorRegistry } from '../mediaVendorRegistry';

/**
 * Vendor priority — the ONE list everything else derives from. Free vendors
 * first (Cloudflare's daily neuron allowance, Together, Hugging Face's monthly
 * credit, Pollinations), then the billed ones (Gemini, FluxAPI). Within a pool
 * the composer interleaves vendors (see {@link imageModelsByTierPrefixed}), so
 * this order decides who LEADS each round, not who monopolises it.
 */
const MODULES: ReadonlyArray<ImageVendorModule> = [
  cloudflareImageModule,
  togetherImageModule,
  huggingFaceImageModule,
  pollinationsImageModule,
  googleImageModule,
  fluxApiModule,
];

/** Everything derived from {@link MODULES} — see `mediaVendorRegistry.ts`. */
const REGISTRY = createMediaVendorRegistry<ImageVendorId, ImageVendorEnv, ImageVendorModule>(MODULES, 'together');

/** Every registered image vendor id, in priority order (health probe, admin views). */
export function getAllImageVendorIds(): ImageVendorId[] {
  return REGISTRY.ids();
}

/** True when at least one image vendor has its credentials bound — the gateway's
 *  "is image generation configured at all" check. */
export function anyImageVendorBound(env: ImageVendorEnv): boolean {
  return REGISTRY.anyBound(env);
}

/** Parse `fluxapi/flux-kontext-pro`-style ids; null for a bare id. */
export function parseImageVendorPrefix(modelId: string): { vendor: ImageVendorId; modelId: string } | null {
  return REGISTRY.parsePrefix(modelId);
}

export function vendorForImageModel(modelId: string): ImageVendorId {
  return REGISTRY.vendorFor(modelId);
}

export function imageVendorKeyBound(env: ImageVendorEnv, vendor: ImageVendorId): boolean {
  return REGISTRY.keyBound(env, vendor);
}

/** Tier of a (prefixed or bare) model id — the prefix is stripped before the
 *  catalog lookup, so a prefixed paid model is never misread as the default tier. */
export function tierForImageModel(modelId: string): ImageModelTier {
  return REGISTRY.tierFor(modelId);
}

export function getImageModule(id: ImageVendorId): ImageVendorModule {
  return REGISTRY.module(id);
}

/** Vendor-prefixed, vendor-interleaved model ids of the given tiers. */
export function imageModelsByTierPrefixed(...tiers: ImageModelTier[]): string[] {
  return REGISTRY.modelsByTierPrefixed(...tiers);
}

// ---------------------------------------------------------------------------
// Dispatch — walk an image-model chain across vendors
// ---------------------------------------------------------------------------

type ImageDispatchBody = Omit<ImageGenParams, 'apiKey' | 'model'>;

export interface ImageDispatchAttempt {
  model: string;
  vendor: ImageVendorId;
  status: number;
  error: string;
}

/**
 * Thrown when every candidate in the image cascade fails. Carries the
 * structured `attempts[]` so the orchestrator can surface per-vendor failure
 * details in the response envelope.
 */
export class ImageCascadeExhaustedError extends Error {
  public readonly attempts: ReadonlyArray<ImageDispatchAttempt>;
  public readonly skippedNoKey: ReadonlyArray<string>;
  constructor(
    attempts: ReadonlyArray<ImageDispatchAttempt>,
    skippedNoKey: ReadonlyArray<string>,
  ) {
    const summary = attempts.map((a) => `${a.vendor}/${a.model}=${a.status}`).join(', ');
    const noKey = skippedNoKey.length > 0 ? ` (skipped no-key: ${skippedNoKey.join(', ')})` : '';
    super(`AI image vendor cascade exhausted (${attempts.length} attempts: ${summary})${noKey}`);
    this.name = 'ImageCascadeExhaustedError';
    this.attempts = attempts;
    this.skippedNoKey = skippedNoKey;
  }
}

export interface ImageDispatchParams extends ImageDispatchBody {
  env: ImageVendorEnv;
  modelChain: string[];
}

export interface ImageDispatchResult extends ImageGenResult {
  modelUsed: string;
  vendorUsed: ImageVendorId;
  attempts: ImageDispatchAttempt[];
}

/** Walk a model chain. Throws ImageCascadeExhaustedError if every model fails. */
export async function dispatchImageVendor(params: ImageDispatchParams): Promise<ImageDispatchResult> {
  const { env, modelChain, ...rest } = params;
  if (modelChain.length === 0) {
    throw new Error('dispatchImageVendor: modelChain is empty');
  }

  const attempts: ImageDispatchAttempt[] = [];
  const skippedNoKey: string[] = [];

  for (const model of modelChain) {
    const { vendorId, vendorModel } = REGISTRY.resolve(model);
    const mod = REGISTRY.module(vendorId);
    const apiKey = mod.apiKeyFrom(env);
    if (!apiKey) {
      skippedNoKey.push(`${vendorId}:${model}`);
      continue;
    }

    try {
      const result = await mod.generate({ ...rest, apiKey, model: vendorModel });
      return { ...result, modelUsed: model, vendorUsed: vendorId, attempts };
    } catch (err) {
      if (err instanceof VendorRetryableError) {
        attempts.push({ model, vendor: vendorId, status: err.status, error: err.message });
        reportCaughtError(err, { source: "application/llm/imageVendors/registry.ts", operation: "dispatchImageVendor", level: 'warning', context: { logMessage: `[imageVendors] ${vendorId}/${model} returned ${err.status}; trying next in chain (${attempts.length}/${modelChain.length} failed)` } });
        continue;
      }
      throw err; // VendorFatalError bubbles
    }
  }

  throw new ImageCascadeExhaustedError(attempts, skippedNoKey);
}
