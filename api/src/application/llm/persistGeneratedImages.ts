/**
 * Turn generated-image `data:` URLs into durable asset URLs.
 *
 * Vendors that answer with bytes (Cloudflare, Hugging Face, Pollinations, Gemini)
 * come back from the image cascade as `data:image/…;base64,…` when the caller
 * asked for `response_format: "url"`. Handing that straight to the caller would
 * make every consumer store megabytes of base64 wherever it keeps the "URL" — a
 * canvas object, a page in a Studio project, a campaign asset row. So the gateway
 * stores those bytes once, through THE asset pipeline (`storeTenantAsset` — same
 * size ceiling, MIME allow-list and tenant-prefixed key as an upload), and hands
 * back the public `/api/assets/<key>` URL instead.
 *
 * Hosted vendor URLs (Together, FluxAPI) and `b64_json` entries pass through
 * untouched. When storage is unbound or the store rejects the object, the entry
 * keeps its `data:` URL — still a working image, just not a compact one.
 */

import { base64ToBytes } from '../../domain/shared/bytes';
import { storeTenantAsset } from '../assets/tenantAssetStore';
import type { ImageGenResultEntry } from './imageVendors';

const DATA_IMAGE_URL = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is;

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function persistGeneratedImages(args: {
  bucket: R2Bucket | undefined;
  entries: ReadonlyArray<ImageGenResultEntry>;
  actor: { tenantId: number; userId: string };
  /** Origin the asset routes are served from, e.g. `https://api.builderforce.ai`. */
  publicOrigin: string;
}): Promise<ImageGenResultEntry[]> {
  const { bucket, entries, actor, publicOrigin } = args;
  if (!bucket) return [...entries];
  return Promise.all(entries.map(async (entry) => {
    const match = entry.url ? DATA_IMAGE_URL.exec(entry.url) : null;
    if (!match) return entry;
    const mimeType = match[1]!.toLowerCase();
    const bytes = base64ToBytes(match[2]!);
    const file = new File([bytes], `generated.${EXTENSION_BY_MIME[mimeType] ?? 'png'}`, { type: mimeType });
    const stored = await storeTenantAsset(bucket, file, actor);
    if ('error' in stored) return entry;
    return { ...entry, url: `${publicOrigin}/api/assets/${stored.key}` };
  }));
}
