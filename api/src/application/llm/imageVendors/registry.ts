/**
 * Image-vendor registry — single source of truth for which vendor owns which
 * image model, tier classification, and dispatch. Mirrors the chat
 * `vendors/registry.ts` shape so future shared tooling (admin UI, health
 * probes) can iterate both surfaces uniformly.
 *
 * Adding a new image vendor: add to `MODULES` below and the registry derives
 * the rest.
 */

import { fluxApiModule } from './fluxapi';
import { togetherImageModule } from './together';
import {
  VendorRetryableError,
  type ImageGenParams,
  type ImageGenResult,
  type ImageModelTier,
  type ImageVendorEnv,
  type ImageVendorId,
  type ImageVendorModelEntry,
  type ImageVendorModule,
} from './types';

/**
 * Vendor priority — free Together first (cost-optimised), FluxAPI premium last.
 * This is the order `modelsByTier` walks, and the order the proxy uses for
 * the candidate chain when no caller-pinned model is supplied.
 */
const MODULES: ReadonlyArray<ImageVendorModule> = [togetherImageModule, fluxApiModule];

const MODULES_BY_ID: Record<ImageVendorId, ImageVendorModule> = {
  together: togetherImageModule,
  fluxapi:  fluxApiModule,
};

/** Used when a model id isn't in any vendor's catalog (treats as Together). */
const DEFAULT_VENDOR: ImageVendorId = 'together';

const INDEX: Map<string, { vendor: ImageVendorId; entry: ImageVendorModelEntry }> = new Map();
for (const mod of MODULES) {
  for (const entry of mod.catalog) {
    INDEX.set(entry.id, { vendor: mod.id, entry });
  }
}

const VENDOR_PREFIXES: ReadonlyArray<{ prefix: string; vendor: ImageVendorId }> = [
  { prefix: 'together/', vendor: 'together' },
  { prefix: 'fluxapi/',  vendor: 'fluxapi' },
];

/**
 * Parse an explicit vendor-prefixed model id (`fluxapi/flux-kontext-pro`,
 * `together/black-forest-labs/FLUX.1-schnell-Free`). Returns `null` for bare
 * ids — callers fall back to catalog lookup via `vendorForImageModel`.
 */
export function parseImageVendorPrefix(modelId: string): { vendor: ImageVendorId; modelId: string } | null {
  for (const { prefix, vendor } of VENDOR_PREFIXES) {
    if (modelId.startsWith(prefix)) {
      return { vendor, modelId: modelId.slice(prefix.length) };
    }
  }
  return null;
}

export function vendorForImageModel(modelId: string): ImageVendorId {
  const prefix = parseImageVendorPrefix(modelId);
  if (prefix) return prefix.vendor;
  return INDEX.get(modelId)?.vendor ?? DEFAULT_VENDOR;
}

export function imageVendorKeyBound(env: ImageVendorEnv, vendor: ImageVendorId): boolean {
  return !!MODULES_BY_ID[vendor].apiKeyFrom(env);
}

export function tierForImageModel(modelId: string): ImageModelTier {
  return MODULES_BY_ID[vendorForImageModel(modelId)].tierFor(modelId);
}

export function getImageCatalog(): ReadonlyArray<ImageVendorModelEntry & { vendor: ImageVendorId }> {
  return MODULES.flatMap((mod) =>
    mod.catalog.map((entry) => ({ ...entry, vendor: mod.id })),
  );
}

export function getImageModule(id: ImageVendorId): ImageVendorModule {
  return MODULES_BY_ID[id];
}

/** All catalog model ids of a given tier, in registry order. */
export function imageModelsByTier(...tiers: ImageModelTier[]): string[] {
  const set = new Set(tiers);
  return MODULES.flatMap((mod) =>
    mod.catalog.filter((m) => set.has(m.tier)).map((m) => m.id),
  );
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

/** Resolve a model id to its vendor + the un-prefixed id the vendor expects. */
function resolveImageVendorAndModel(model: string): { vendorId: ImageVendorId; vendorModel: string } {
  const prefix = parseImageVendorPrefix(model);
  if (prefix) return { vendorId: prefix.vendor, vendorModel: prefix.modelId };
  return { vendorId: vendorForImageModel(model), vendorModel: model };
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
    const { vendorId, vendorModel } = resolveImageVendorAndModel(model);
    const mod = MODULES_BY_ID[vendorId];
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
        console.warn(
          `[imageVendors] ${vendorId}/${model} returned ${err.status}; trying next in chain (${attempts.length}/${modelChain.length} failed)`,
        );
        continue;
      }
      throw err; // VendorFatalError bubbles
    }
  }

  throw new ImageCascadeExhaustedError(attempts, skippedNoKey);
}
