import { apiRequest } from './apiClient';
import { AUTH_API_URL } from './auth';

/**
 * THE ASSET PIPELINE — /api/assets. One upload, one URL, for any surface that
 * needs to turn a file into a link.
 *
 * The server-side policy (ceiling, allow-list, tenant-scoped key) lives in
 * `api/src/application/assets/tenantAssetStore.ts` and used to be reachable only
 * through `/api/brain/upload` — which is why a canvas `image`/`video`/`file`
 * block could hold nothing but a URL somebody pasted from elsewhere. This is the
 * same pipeline under a name any surface can call; `brainApi.upload` keeps
 * calling the legacy path because published clients (VS Code, brain-embedded)
 * already do.
 */

export interface UploadedAsset {
  key: string;
  name: string;
  type: string;
  size: number;
}

/** Upload one file. Throws on a rejection (too large, wrong type, storage unset). */
export async function uploadAsset(file: File): Promise<UploadedAsset> {
  const form = new FormData();
  form.append('file', file);
  // apiRequest leaves Content-Type unset for FormData so the multipart boundary
  // survives — no hand-built header block needed.
  return apiRequest<UploadedAsset>('/api/assets', { method: 'POST', body: form });
}

/** The URL an uploaded object is served from — absolute, so it round-trips
 *  through markdown (a canvas card, an exported .docx) unchanged. */
export function assetUrl(key: string): string {
  return `${AUTH_API_URL}/api/assets/${key}`;
}
