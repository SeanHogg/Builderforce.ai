import { isKeyOwnedByTenant } from '../../domain/shared/r2Keys';
import { signPublishUpload, signUpload } from '../../infrastructure/auth/uploadSign';

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
  /** True for private media: read it through the tenant-authenticated `/api/brain/uploads/<key>`, not `/api/assets/<key>`. */
  private?: boolean;
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
  // A podcast's Podcast 2.0 chapters file (served to podcast apps via a publish signature).
  'application/json+chapters',
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
  // A full random UUID (122 random bits): the key IS the read capability of `GET /api/assets/*`.
  return `${tenantId}/${userId}/${crypto.randomUUID()}.${extensionOf(fileName) || 'bin'}`;
}

/** Canvas / creative media: stored `<tenantId>/private/media/<uuid>.<ext>`, readable only with a tenant session. */
export function privateMediaKey(tenantId: number, fileName: string): string {
  return `${tenantId}/private/media/${crypto.randomUUID()}.${extensionOf(fileName) || 'bin'}`;
}

const PRIVATE_MEDIA_KEY = /^\d+\/private\/media\//;
/** A private key the OWNING TENANT may read (`/api/brain/uploads`), sign and publish, unlike a DSR export. */
export const isPrivateMediaKey = (key: string | null | undefined): boolean => !!key && PRIVATE_MEDIA_KEY.test(key);

// ── PRIVATE OBJECTS ──────────────────────────────────────────────────────────

/**
 * Objects the PLATFORM stores about people (a data subject request's export) live under
 * `<tenantId>/private/...`. They are NOT assets: `GET /api/assets/*` serves any key as its own capability
 * and `/api/brain/uploads/*` serves any key the tenant owns, so a private object must be unreachable
 * through BOTH, and through signing. Every public reader in this module refuses a private key; the only
 * way to read one is {@link readPrivateObject}, from a route that has already authorised the caller.
 */
const PRIVATE_KEY = /^\d+\/private\//;
export const isPrivateAssetKey = (key: string | null | undefined): boolean => !!key && PRIVATE_KEY.test(key);

/** Store a private object under `<tenantId>/private/<kind>/<uuid>.<ext>`; returns its key (never a public handle). */
export async function storePrivateObject(
  bucket: R2Bucket | undefined, tenantId: number, kind: string, fileName: string, body: string, contentType: string,
): Promise<string | null> {
  if (!bucket) return null;
  const key = `${tenantId}/private/${kind.replace(/[^a-z0-9_-]/gi, '')}/${crypto.randomUUID()}.${extensionOf(fileName) || 'bin'}`;
  await bucket.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: { tenantId: String(tenantId), private: '1' },
  });
  return key;
}

/** Read a private object, tenant-checked. For a route that has ALREADY authorised the caller. */
export async function readPrivateObject(
  bucket: R2Bucket | undefined, key: string | null | undefined, tenantId: number,
): Promise<Response | 'unconfigured' | 'not-found'> {
  if (!bucket) return 'unconfigured';
  if (!isKeyOwnedByTenant(key, tenantId) || !isPrivateAssetKey(key)) return 'not-found';
  const object = await bucket.get(key);
  if (!object) return 'not-found';
  return new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream' } });
}

/** Delete a private object (after delivery, or when an undelivered export expires). */
export async function deletePrivateObject(bucket: R2Bucket | undefined, key: string, tenantId: number): Promise<boolean> {
  if (!bucket || !isKeyOwnedByTenant(key, tenantId) || !isPrivateAssetKey(key)) return false;
  await bucket.delete(key);
  return true;
}

/** Validate and store one uploaded file. */
export async function storeTenantAsset(
  bucket: R2Bucket | undefined,
  file: File | null,
  actor: { tenantId: number; userId: string },
  options: { private?: boolean } = {},
): Promise<StoredAsset | AssetRejection> {
  if (!bucket) return { error: 'unconfigured' };
  if (!file) return { error: 'no-file' };

  const maxBytes = assetMaxBytes(file.type);
  if (file.size > maxBytes) return { error: 'too-large', maxBytes };
  if (!isAllowedAsset(file.type, file.name)) return { error: 'type-not-allowed', type: file.type };

  const key = options.private ? privateMediaKey(actor.tenantId, file.name) : assetKey(actor.tenantId, actor.userId, file.name);
  await bucket.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name, tenantId: String(actor.tenantId), ...(options.private ? { private: '1' } : {}) },
  });

  return { key, name: file.name, type: file.type, size: file.size, ...(options.private ? { private: true } : {}) };
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
  // Private objects stay unreadable here too, except the tenant's own private MEDIA.
  if (!isKeyOwnedByTenant(key, tenantId) || (isPrivateAssetKey(key) && !isPrivateMediaKey(key))) return 'not-found';
  return objectResponse(bucket, key);
}

/**
 * Read one object back with NO tenant check — the key itself is the capability.
 *
 * A document's persisted markdown embeds a plain `![alt](url)`, and that URL has
 * to keep working wherever the markdown is rendered: the canvas card, the print
 * sheet, the .docx writer, Brain's context, none of which hold a bearer token to
 * attach. `/api/brain-files/*` solved the same problem for a vision fetch by
 * trading a tenant check for a short-lived HMAC signature; a document asset needs
 * the opposite trade — no expiry, because the link is meant to outlive the
 * session that created it — so it trades the tenant check for the key's own
 * entropy instead: `assetKey` mints a full random UUID per object (128 bits),
 * an ordinary "unlisted link" trust bar. Private objects (`<tenant>/private/...`)
 * are never served here.
 *
 * Upload stays tenant-scoped and size/type-checked ({@link storeTenantAsset}); it
 * is only the READ that drops the check, and only for this route — the
 * tenant-checked {@link readTenantAsset} still backs the legacy authenticated
 * `/api/brain/uploads/*` path.
 */
export async function readAssetByKey(
  bucket: R2Bucket | undefined,
  key: string | null | undefined,
): Promise<Response | 'unconfigured' | 'not-found'> {
  if (!bucket) return 'unconfigured';
  if (!key || isPrivateAssetKey(key)) return 'not-found';
  return objectResponse(bucket, key);
}

/**
 * A short-lived signed URL for one owned object — see {@link signUpload} for why
 * a time-boxed link exists alongside the durable `GET /api/assets/*` one.
 * Returns `null` when the key does not belong to `tenantId` (caller reports 404).
 */
export async function signTenantAsset(
  key: string | undefined,
  tenantId: number,
  secret: string,
): Promise<{ exp: number; sig: string } | null> {
  if (!isKeyOwnedByTenant(key, tenantId) || (isPrivateAssetKey(key) && !isPrivateMediaKey(key))) return null;
  return signUpload(key, secret);
}

async function objectResponse(bucket: R2Bucket, key: string): Promise<Response | 'not-found'> {
  const object = await bucket.get(key);
  if (!object) return 'not-found';
  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  // A private object is only ever served to an authenticated tenant: never a shared cache.
  // A public key is immutable by construction (random UUID), so it is cached aggressively.
  headers.set(
    'Cache-Control',
    isPrivateAssetKey(key) ? 'private, max-age=3600' : 'public, max-age=31536000, immutable',
  );
  return new Response(object.body, { headers });
}

/** What a PUBLISH signature may be minted for: audio, and the Podcast 2.0 chapters file. Nothing else. */
export function isPublishableType(contentType: string | undefined): boolean {
  return !!contentType && (contentType.startsWith('audio/') || contentType === 'application/json+chapters');
}

/**
 * A long-lived signed URL for one owned audio or chapters object, for a podcast feed.
 *
 * A podcast app cannot authenticate, and the ordinary signature lasts ten minutes, so
 * a feed that referenced it would break almost immediately. This mints the same HMAC
 * with a multi-year expiry. SECURITY TRADE-OFF, deliberate: the resulting link is
 * public, unguessable (signature plus a random key suffix) and revocable only by
 * deleting the object. That is why it is purpose-limited: the key must belong to the
 * caller's tenant, and the stored content type must be audio or chapters JSON, so a
 * private document can never be given a permanent link. The caller's OWN private media
 * (`<tenant>/private/media/`) IS signable — publishing it is the point of this URL; other
 * private objects (DSR exports) are not. The signature uses a dedicated HKDF-derived key
 * ({@link signPublishUpload}), verified by `/api/brain-files`.
 *
 * Returns the reason when refused: `not-found` (not owned / missing) or `type-not-allowed`.
 */
export async function signPublishAsset(
  bucket: R2Bucket | undefined,
  key: string | undefined,
  tenantId: number,
  secret: string,
): Promise<{ exp: number; sig: string } | 'not-found' | 'type-not-allowed' | 'unconfigured'> {
  if (!bucket) return 'unconfigured';
  if (!isKeyOwnedByTenant(key, tenantId) || (isPrivateAssetKey(key) && !isPrivateMediaKey(key))) return 'not-found';
  const head = await bucket.head(key);
  if (!head) return 'not-found';
  if (!isPublishableType(head.httpMetadata?.contentType)) return 'type-not-allowed';
  return signPublishUpload(key, secret);
}
