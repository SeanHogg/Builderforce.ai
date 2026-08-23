import { isKeyOwnedByTenant } from '../../domain/shared/r2Keys';

/**
 * THE ASSET PIPELINE — one upload, one read, one policy, for every surface.
 *
 * ── WHY IT LEFT `brainRoutes` ────────────────────────────────────────────────
 * A tenant-scoped R2 upload already existed; it was three handlers inside the
 * Brain router, named `/api/brain/upload` and `/api/brain/uploads/*`. That was
 * accurate while chat attachments were the only files anyone uploaded, and it is
 * the reason a canvas `image` object is still URL-ONLY: the canvas would have had
 * to post a picture to the Brain to get a link back, so it never did, and every
 * media block on every surface stayed "paste a URL you host somewhere else".
 *
 * The size ceiling, the MIME allow-list, the key layout and the tenant-ownership
 * check are the policy — not the Brain's policy, the platform's. They live here,
 * and the Brain's URLs are kept as thin delegations because published clients
 * (the VS Code extension, brain-embedded) already call them.
 *
 * ── WHAT IT DOES NOT DECIDE ──────────────────────────────────────────────────
 * It does not know about Hono. Callers pass the bucket, the file and the actor,
 * and shape their own responses — which is what lets one policy serve a route, a
 * built-in MCP tool and a future importer without any of them reaching for a
 * request object.
 */

/** An object as the caller should record it. `key` is the only durable handle. */
export interface StoredAsset {
  key: string;
  name: string;
  type: string;
  size: number;
}

export type AssetRejection =
  | { error: 'unconfigured' }
  | { error: 'no-file' }
  | { error: 'too-large'; maxBytes: number }
  | { error: 'type-not-allowed'; type: string };

/**
 * How large an upload may be.
 *
 * Video is deliberately larger: a rendered clip is not an attachment, and the
 * alternative to a 100MB ceiling is that the video surfaces cannot store their
 * own output at all.
 */
export const ASSET_MAX_BYTES = 10 * 1024 * 1024;
export const ASSET_MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export function assetMaxBytes(type: string): number {
  return type.startsWith('video/') ? ASSET_MAX_VIDEO_BYTES : ASSET_MAX_BYTES;
}

/**
 * What may be stored.
 *
 * An allow-list rather than a deny-list, because the objects are served back from
 * an origin the app itself renders — an uploaded `text/html` is a stored XSS, and
 * "block the dangerous ones" is a list nobody keeps current.
 */
export const ALLOWED_ASSET_TYPES: readonly string[] = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'text/plain', 'text/markdown', 'text/csv',
  'application/json',
  'video/webm', 'video/mp4',
  'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg',
  // Office OpenXML — deck templates (.pptx) to fill, plus .docx/.xlsx.
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

/** Browsers frequently send `application/octet-stream` for these, so the extension
 *  is a second admissible witness — for these three only. */
const ALLOWED_EXTENSIONS: readonly string[] = ['pptx', 'docx', 'xlsx'];

export function extensionOf(fileName: string): string {
  return (fileName.split('.').pop() ?? '').toLowerCase();
}

export function isAllowedAsset(type: string, fileName: string): boolean {
  return ALLOWED_ASSET_TYPES.includes(type) || ALLOWED_EXTENSIONS.includes(extensionOf(fileName));
}

/**
 * Where an object lives.
 *
 * `<tenantId>/<userId>/<time>-<random>.<ext>` — the tenant prefix is what
 * {@link isKeyOwnedByTenant} checks on every read, so the layout is a security
 * property rather than a filing convention. The random suffix means two people
 * uploading `logo.png` in the same millisecond do not collide.
 */
export function assetKey(tenantId: number, userId: string, fileName: string): string {
  return `${tenantId}/${userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extensionOf(fileName) || 'bin'}`;
}

/** Validate and store one uploaded file. */
export async function storeTenantAsset(
  bucket: R2Bucket | undefined,
  file: File | null,
  actor: { tenantId: number; userId: string },
): Promise<StoredAsset | AssetRejection> {
  if (!bucket) return { error: 'unconfigured' };
  if (!file) return { error: 'no-file' };

  const maxBytes = assetMaxBytes(file.type);
  if (file.size > maxBytes) return { error: 'too-large', maxBytes };
  if (!isAllowedAsset(file.type, file.name)) return { error: 'type-not-allowed', type: file.type };

  const key = assetKey(actor.tenantId, actor.userId, file.name);
  await bucket.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name, tenantId: String(actor.tenantId) },
  });

  return { key, name: file.name, type: file.type, size: file.size };
}

/**
 * Read one object back, refusing anything outside the caller's tenant.
 *
 * Returns the `Response` rather than the object so the cache headers are decided
 * once. They are aggressive on purpose: a key contains a timestamp and a random
 * suffix, so an object at a given key is immutable by construction.
 */
export async function readTenantAsset(
  bucket: R2Bucket | undefined,
  key: string | null | undefined,
  tenantId: number,
): Promise<Response | 'unconfigured' | 'not-found'> {
  if (!bucket) return 'unconfigured';
  if (!isKeyOwnedByTenant(key, tenantId)) return 'not-found';

  const object = await bucket.get(key);
  if (!object) return 'not-found';

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}
