/**
 * Video-vendor registry — the shared media registry (`../mediaVendorRegistry.ts`)
 * instantiated with the video modules, plus the per-plan model chains.
 *
 * Plan policy ("cheap first, quality on paid plans"):
 *   - free  → FREE models only (Wan 2.2 Fast). When those fail the client falls
 *             back to the in-browser engine, which costs nothing.
 *   - paid  → STANDARD (Seedance 1080p), then PREMIUM (Veo 3.1 Fast), with the
 *             FREE model last as the fallback.
 */

import { createMediaVendorRegistry } from '../mediaVendorRegistry';
import { googleVideoModule } from './googleai';
import { pollinationsVideoModule } from './pollinations';
import { clampVideoDuration, type VideoModelEntry, type VideoVendorEnv, type VideoVendorId, type VideoVendorModule } from './types';

const MODULES: ReadonlyArray<VideoVendorModule> = [pollinationsVideoModule, googleVideoModule];

export const VIDEO_REGISTRY = createMediaVendorRegistry<VideoVendorId, VideoVendorEnv, VideoVendorModule>(MODULES, 'pollinations');

/** The prefixed model chain a clip walks for a plan. */
export function videoModelChainForPlan(paid: boolean): string[] {
  return paid
    ? [...VIDEO_REGISTRY.modelsByTierPrefixed('STANDARD'), ...VIDEO_REGISTRY.modelsByTierPrefixed('PREMIUM', 'ULTRA'), ...VIDEO_REGISTRY.modelsByTierPrefixed('FREE')]
    : VIDEO_REGISTRY.modelsByTierPrefixed('FREE');
}

/** The catalog entry behind a prefixed model id, or undefined for an unknown one. */
export function videoModelEntry(prefixedModel: string): VideoModelEntry | undefined {
  const { vendorId, vendorModel } = VIDEO_REGISTRY.resolve(prefixedModel);
  return VIDEO_REGISTRY.module(vendorId).catalog.find((m) => m.id === vendorModel);
}

/** The seconds a model will render (and bill) for a requested length. */
export function videoSecondsFor(prefixedModel: string, requested: number): number {
  const entry = videoModelEntry(prefixedModel);
  return entry ? clampVideoDuration(entry, requested) : Math.max(1, Math.round(requested));
}

/** The longest clip any model in a chain can bill — what the credit gate reserves. */
export function maxVideoSecondsFor(chain: readonly string[], requested: number): number {
  return chain.reduce((max, model) => Math.max(max, videoSecondsFor(model, requested)), 0);
}

/** True when the plan's chain has at least one vendor with credentials. */
export function videoChainConfigured(env: VideoVendorEnv, chain: readonly string[]): boolean {
  return chain.some((model) => VIDEO_REGISTRY.keyBound(env, VIDEO_REGISTRY.vendorFor(model)));
}
