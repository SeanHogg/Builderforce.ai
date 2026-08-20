/**
 * findingScreenshots — the pixels behind a QA finding.
 *
 * `qa_findings.screenshot_key` has existed since 0206 and was always null:
 * nothing captured an image, nothing stored one, and nothing rendered one. A
 * finding therefore read "TypeError: x is undefined at /pricing" with no way to
 * see what the page actually looked like when it happened — which is the single
 * most useful thing a browser-driven tester can hand a human.
 *
 * This module owns the whole contract in one place so neither the upload route
 * nor the read route can invent its own key shape:
 *
 *   • Key: `qa/screenshots/{tenantId}/{explorationId}/{uuid}.{ext}` — the TENANT
 *     IS IN THE KEY, which is what makes a read authorizable without a second
 *     lookup: a caller may only read under its own tenant's prefix, so a guessed
 *     key from another workspace cannot resolve.
 *   • Only real raster image types are accepted, and the body is size-capped, so
 *     the endpoint cannot be used as general-purpose tenant storage.
 *
 * Screenshots live in the shared UPLOADS bucket rather than a new binding: it is
 * already the tenant-scoped blob store, already provisioned in every
 * environment, and one more prefix is cheaper than one more binding to configure.
 */

/** The R2 prefix every QA screenshot lives under. */
const SCREENSHOT_ROOT = 'qa/screenshots/';

/** Content types a screenshot may be. PNG is what Playwright produces. */
const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Hard ceiling on one screenshot. A full-page 1280px PNG is well under this. */
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

export type ScreenshotUpload =
  | { ok: true; key: string; contentType: string }
  | { ok: false; status: 400 | 413 | 415 | 503; reason: string };

/** The prefix a tenant's screenshots live under — the read authorization test. */
export function screenshotPrefix(tenantId: number): string {
  return `${SCREENSHOT_ROOT}${tenantId}/`;
}

/**
 * Is this key one this tenant may read? Structural only — a key under another
 * tenant's prefix is refused without touching R2, and a key with traversal
 * segments can never match a prefix that ends in `/` after normalization.
 */
export function screenshotKeyBelongsToTenant(key: string, tenantId: number): boolean {
  if (typeof key !== 'string' || key.length === 0 || key.length > 512) return false;
  if (key.includes('..') || key.includes('\\')) return false;
  return key.startsWith(screenshotPrefix(tenantId));
}

/**
 * Store one screenshot for a finding. Returns the key the caller should attach
 * to the finding it belongs to.
 */
export async function putFindingScreenshot(
  bucket: R2Bucket | undefined,
  args: { tenantId: number; explorationId: string; contentType: string; bytes: ArrayBuffer },
): Promise<ScreenshotUpload> {
  if (!bucket) return { ok: false, status: 503, reason: 'Object storage is not configured' };
  const contentType = args.contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) return { ok: false, status: 415, reason: `Unsupported screenshot type '${contentType}'` };
  if (args.bytes.byteLength === 0) return { ok: false, status: 400, reason: 'Screenshot body is empty' };
  if (args.bytes.byteLength > MAX_SCREENSHOT_BYTES) {
    return { ok: false, status: 413, reason: `Screenshot exceeds ${MAX_SCREENSHOT_BYTES} bytes` };
  }
  // The exploration id is part of the key, so deleting a run's evidence is one
  // prefix delete rather than a per-finding walk.
  const key = `${screenshotPrefix(args.tenantId)}${args.explorationId}/${crypto.randomUUID()}.${ext}`;
  await bucket.put(key, args.bytes, {
    httpMetadata: { contentType },
    customMetadata: { tenantId: String(args.tenantId), explorationId: args.explorationId },
  });
  return { ok: true, key, contentType };
}

/** Read one screenshot back, or null when it is missing or not this tenant's. */
export async function getFindingScreenshot(
  bucket: R2Bucket | undefined,
  tenantId: number,
  key: string,
): Promise<{ body: ReadableStream; contentType: string; size: number } | null> {
  if (!bucket) return null;
  if (!screenshotKeyBelongsToTenant(key, tenantId)) return null;
  const obj = await bucket.get(key);
  if (!obj) return null;
  return {
    body: obj.body,
    contentType: obj.httpMetadata?.contentType ?? 'image/png',
    size: obj.size,
  };
}
