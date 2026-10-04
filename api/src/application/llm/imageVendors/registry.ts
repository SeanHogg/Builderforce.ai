import { reportCaughtError } from '../../observability/caughtErrorReporter';
/**
 * Image-vendor registry — single source of truth for which vendor owns which
 * image model, tier classification, and dispatch. Mirrors the chat
 * `vendors/registry.ts` shape so future shared tooling (admin UI, health
 * probes) can iterate both surfaces uniformly.
 *
 * Adding a new image vendor: add to `MODULES` below and the registry derives
 * the rest.
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
  type ImageVendorModelEntry,
  type ImageVendorModule,
} from './types';

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

const MODULES_BY_ID = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<ImageVendorId, ImageVendorModule>;

/** Used when a model id isn't in any vendor's catalog (treats as Together). */
const DEFAULT_VENDOR: ImageVendorId = 'together';

const INDEX: Map<string, { vendor: ImageVendorId; entry: ImageVendorModelEntry }> = new Map();
for (const mod of MODULES) {
  for (const entry of mod.catalog) {
    INDEX.set(entry.id, { vendor: mod.id, entry });
  }
}

/** `<vendor>/` for every registered vendor — derived, so a new module needs no edit here. */
const VENDOR_PREFIXES: ReadonlyArray<{ prefix: string; vendor: ImageVendorId }> =
  MODULES.map((m) => ({ prefix: `${m.id}/`, vendor: m.id }));

/** Every registered image vendor id, in priority order (health probe, admin views). */
export function getAllImageVendorIds(): ImageVendorId[] {
  return MODULES.map((m) => m.id);
}

/** True when at least one image vendor has its credentials bound — the gateway's
 *  "is image generation configured at all" check, derived from the registry so
 *  it never lags a newly added vendor. */
export function anyImageVendorBound(env: ImageVendorEnv): boolean {
  return MODULES.some((m) => !!m.apiKeyFrom(env));
}

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

export function getImageModule(id: ImageVendorId): ImageVendorModule {
  return MODULES_BY_ID[id];
}

/**
 * Catalog ids of the given tiers, VENDOR-PREFIXED (`<vendor>/<modelId>`) and
 * INTERLEAVED across vendors: round 1 takes each vendor's first model in
 * registry order, round 2 each vendor's second, and so on.
 *
 * Prefixed so the dispatcher always resolves a model to its OWNING vendor by
 * prefix — never by an ambiguous bare-id catalog lookup (the same `flux-schnell`
 * can live on several vendors). Interleaved because the cascade composer caps
 * the FREE slice at a small budget: in registry order the whole budget would go
 * to one vendor's models, so a single outage or rate limit would burn every
 * free attempt and drop the request onto a paid fallback while other free
 * vendors sat idle.
 */
export function imageModelsByTierPrefixed(...tiers: ImageModelTier[]): string[] {
  const set = new Set(tiers);
  const perVendor = MODULES.map((mod) =>
    mod.catalog.filter((m) => set.has(m.tier)).map((m) => `${mod.id}/${m.id}`),
  );
  const rounds = Math.max(0, ...perVendor.map((ids) => ids.length));
  const out: string[] = [];
  for (let round = 0; round < rounds; round++) {
    for (const ids of perVendor) {
      const id = ids[round];
      if (id) out.push(id);
    }
  }
  return out;
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
        reportCaughtError(err, { source: "application/llm/imageVendors/registry.ts", operation: "dispatchImageVendor", level: 'warning', context: { logMessage: `[imageVendors] ${vendorId}/${model} returned ${err.status}; trying next in chain (${attempts.length}/${modelChain.length} failed)` } });
        continue;
      }
      throw err; // VendorFatalError bubbles
    }
  }

  throw new ImageCascadeExhaustedError(attempts, skippedNoKey);
}
