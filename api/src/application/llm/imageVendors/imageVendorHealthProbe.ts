/**
 * Image-vendor health probe — the image-gen twin of `../vendorHealthProbe.ts`.
 *
 * The daily vendor-health cron probes only CHAT vendors (`getAllVendorIds()`),
 * so a quiet outage on an IMAGE upstream (Together, FluxAPI) surfaced only when
 * a customer triggered an image gen and it 502'd. This probes each image vendor
 * with one minimal generation per catalog model and classifies the outcome the
 * same way the chat probe does:
 *   - ok            — every probed model returned a usable image
 *   - degraded      — some succeeded, some failed
 *   - down          — every probed model failed
 *   - unconfigured  — the vendor API key is not bound in env
 *
 * Vendor ids are namespaced `image:<vendor>` so an image probe row never
 * collides with the chat vendor of the same name in `llm_health_probes` (the
 * same namespacing `ImageProxyService` uses for cooldown keys).
 *
 * Cost note: a real generation is heavier than a chat 1-token ping, so this is
 * intended for the SCHEDULED daily run (naturally rate-limited), not a
 * customer-facing hot path. The prompt is a 1-word throwaway and the result is
 * discarded — we only care that the upstream accepted the call.
 */

import { getImageModule } from './registry';
import {
  VendorFatalError,
  VendorRetryableError,
  type ImageVendorEnv,
  type ImageVendorId,
  type ImageVendorModule,
} from './types';
import type {
  ModelProbeResult,
  VendorHealthStatus,
} from '../vendorHealthProbe';

/** The image vendors probed by the daily health cron, in registry order. */
export const IMAGE_PROBE_VENDOR_IDS: readonly ImageVendorId[] = ['together', 'fluxapi'];

/** `image:<vendor>` — keeps image health rows distinct from same-named chat
 *  vendors in `llm_health_probes` (mirrors `ImageProxyService`'s cooldown keys). */
export function imageProbeVendorLabel(vendor: ImageVendorId): string {
  return `image:${vendor}`;
}

/** Probe-result shape — structurally identical to the chat `VendorProbeResult`
 *  so `persistProbe(db, result, 'cron')` accepts it unchanged. `vendor` is the
 *  `image:<vendor>` label (a plain string column value at the DB layer). */
export interface ImageVendorProbeResult {
  vendor: string;
  status: VendorHealthStatus;
  probedCount: number;
  okCount: number;
  failedCount: number;
  latencyMs: number;
  models: ModelProbeResult[];
}

const PROBE_PROMPT = 'ping';

/** One probe generation against a single image vendor + model. */
async function probeImageModel(
  env: ImageVendorEnv,
  mod: ImageVendorModule,
  modelId: string,
): Promise<ModelProbeResult> {
  const apiKey = mod.apiKeyFrom(env);
  if (!apiKey) {
    return { model: modelId, ok: false, status: 0, latencyMs: 0, error: 'no api key' };
  }
  const t0 = Date.now();
  try {
    const result = await mod.generate({
      apiKey,
      model: modelId,
      prompt: PROBE_PROMPT,
      size: '1024x1024',
      n: 1,
    });
    const latencyMs = Date.now() - t0;
    // ok = a usable image came back (at least one entry with a url or b64).
    const usable = result.data.some((d) => (d.url && d.url.length > 0) || (d.b64_json && d.b64_json.length > 0));
    return usable
      ? { model: modelId, ok: true, status: 200, latencyMs }
      : { model: modelId, ok: false, status: 502, latencyMs, error: 'no image in response' };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    if (err instanceof VendorRetryableError || err instanceof VendorFatalError) {
      return { model: modelId, ok: false, status: err.status, latencyMs, error: err.message.slice(0, 240) };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { model: modelId, ok: false, status: 0, latencyMs, error: msg.slice(0, 240) };
  }
}

/** Probe every model in one image vendor's catalog in parallel. */
export async function probeImageVendor(
  env: ImageVendorEnv,
  vendor: ImageVendorId,
): Promise<ImageVendorProbeResult> {
  const mod = getImageModule(vendor);
  const label = imageProbeVendorLabel(vendor);

  if (!mod.apiKeyFrom(env)) {
    return { vendor: label, status: 'unconfigured', probedCount: 0, okCount: 0, failedCount: 0, latencyMs: 0, models: [] };
  }

  const models = await Promise.all(mod.catalog.map((entry) => probeImageModel(env, mod, entry.id)));
  const okCount = models.filter((m) => m.ok).length;
  const failedCount = models.length - okCount;
  const latencyMs = models.reduce((acc, m) => Math.max(acc, m.latencyMs), 0);

  let status: VendorHealthStatus;
  if (models.length === 0) status = 'unconfigured';
  else if (okCount === 0) status = 'down';
  else if (failedCount === 0) status = 'ok';
  else status = 'degraded';

  return { vendor: label, status, probedCount: models.length, okCount, failedCount, latencyMs, models };
}

/** Probe every registered image vendor in parallel — used by the daily cron. */
export async function probeAllImageVendors(
  env: ImageVendorEnv,
  vendors: readonly ImageVendorId[] = IMAGE_PROBE_VENDOR_IDS,
): Promise<ImageVendorProbeResult[]> {
  return Promise.all(vendors.map((v) => probeImageVendor(env, v)));
}
