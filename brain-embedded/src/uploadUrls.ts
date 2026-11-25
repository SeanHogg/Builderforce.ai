/**
 * The platform's two URLs for an uploaded Brain file — ONE spelling for every client
 * that names one (the web's REST adapter, the editor host's upload):
 *
 *   • `brainUploadUrl` — the tenant-authenticated read (`GET /api/brain/uploads/:key`),
 *     which is also the link a turn names an attachment by (the key is what
 *     `builtin_attachments_read` takes);
 *   • `signedBrainFileUrl` — the short-lived public read an upstream LLM fetches
 *     (`/api/brain-files/:key?exp&sig`, signed at `POST /api/brain/uploads/sign`).
 */

/** The authenticated read URL of an uploaded file. */
export function brainUploadUrl(baseUrl: string, key: string): string {
  return `${baseUrl}/api/brain/uploads/${key}`;
}

/** The signed public read URL of an uploaded file, from the signing endpoint's answer. */
export function signedBrainFileUrl(baseUrl: string, key: string, signed: { exp: number; sig: string }): string {
  return `${baseUrl}/api/brain-files/${key}?exp=${signed.exp}&sig=${encodeURIComponent(signed.sig)}`;
}

/** The signing endpoint (POST `{ key }` → `{ exp, sig }`). */
export const BRAIN_UPLOAD_SIGN_PATH = '/api/brain/uploads/sign';

/** The upload endpoint (multipart, field `file` → `{ key, name, type }`). */
export const BRAIN_UPLOAD_PATH = '/api/brain/upload';

/**
 * How large an upload may be: the one rule the workspace's asset store enforces
 * (`api/src/application/assets/tenantAssetStore.ts` mirrors these two numbers) and the
 * device blob store admits against, so a client never accepts a file the server refuses.
 */
export const ASSET_MAX_BYTES = 10 * 1024 * 1024;
export const ASSET_MAX_VIDEO_BYTES = 100 * 1024 * 1024;
