import { request } from '@/lib/builderforceApi';
import { apiRequestStream } from '@/lib/apiClient';
import { AUTH_API_URL } from '@/lib/auth';
import { fetchWithTransportReport } from '@/lib/errors/transportFailure';
import { BRAIN_UPLOAD_PATH } from '@seanhogg/builderforce-brain-embedded';
import type { CanvasVideoCaptureKind, CanvasVideoSource, CanvasVideoSourceKind } from '@builderforce/creation-canvas-contract';

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Media could not be read'));
    reader.onerror = () => reject(reader.error ?? new Error('Media could not be read'));
    reader.readAsDataURL(file);
  });
}

function sourceKind(file: File): CanvasVideoSourceKind {
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  return 'video';
}

function probe(url: string, kind: CanvasVideoSourceKind): Promise<{ durationSeconds: number; width?: number; height?: number }> {
  if (kind === 'image') return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ durationSeconds: 5, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ durationSeconds: 5 });
    image.src = url;
  });
  return new Promise((resolve) => {
    const media = document.createElement(kind === 'audio' ? 'audio' : 'video');
    const done = () => resolve({
      durationSeconds: Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 1,
      ...(media instanceof HTMLVideoElement && media.videoWidth ? { width: media.videoWidth, height: media.videoHeight } : {}),
    });
    media.onloadedmetadata = done;
    media.onerror = done;
    media.preload = 'metadata';
    media.src = url;
  });
}

/** The tenant-authenticated read URL of a private upload; never the public `/api/assets/<key>`. */
function privateUploadUrl(key: string): string {
  return `${AUTH_API_URL}/api/brain/uploads/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export interface UploadedCanvasFile { url: string; storageKey: string }

/**
 * Put a file in the tenant's own R2 and hand back the URL to REFERENCE it by.
 *
 * The one upload every canvas surface that produces media goes through — a
 * recorded clip, a picked image, a figure lifted out of a dropped `.docx`. It
 * returns `null` rather than throwing, and rather than falling back to a data
 * URL, because the two callers want opposite things from a failure: media
 * authoring keeps a guest's draft reloadable by inlining the bytes, while an
 * imported document must NOT inline them — node data is re-serialised into the
 * local-session snapshot on every viewport change, and a report's charts as
 * base64 would push megabytes through that loop on every pan. Each caller
 * decides; this function only ever means "uploaded, here is where it lives".
 */
export async function uploadCanvasFile(file: File): Promise<UploadedCanvasFile | null> {
  try {
    // `brain.upload` carries only the file; canvas media is PRIVATE to the tenant
    // (stored under `<tenant>/private/media/`), so the form also names the visibility.
    const form = new FormData();
    form.append('file', file);
    form.append('visibility', 'private');
    const uploaded = await request<{ key: string }>(BRAIN_UPLOAD_PATH, { method: 'POST', body: form });
    return { url: privateUploadUrl(uploaded.key), storageKey: uploaded.key };
  } catch {
    return null;
  }
}

/** The only browser-side persistence adapter used by Canvas media authoring. */
export async function storeCanvasMedia(file: File, captureKind: CanvasVideoCaptureKind): Promise<CanvasVideoSource> {
  const kind = sourceKind(file);
  const uploaded = await uploadCanvasFile(file);
  const storageKey = uploaded?.storageKey;
  // Guest canvases have no tenant R2 boundary. A data URL keeps their draft
  // reloadable and the normal account-upgrade flow moves it server-side later.
  const url = uploaded?.url ?? await dataUrl(file);
  const metadata = await probe(url, kind);
  return {
    id: crypto.randomUUID(),
    kind,
    captureKind,
    url,
    fileName: file.name,
    mimeType: file.type,
    durationSeconds: metadata.durationSeconds,
    ...(metadata.width ? { width: metadata.width, height: metadata.height } : {}),
    ...(storageKey ? { storageKey } : {}),
  };
}

const UPLOADS_PREFIX = '/api/brain/uploads/';

function apiBase(): string {
  return AUTH_API_URL || (typeof location !== 'undefined' ? location.origin : 'http://localhost');
}

/**
 * The request path for a tenant-authenticated upload URL, rebuilt from its parsed key; `null` when
 * the URL is not one. A URL that names the uploads path but is not on the API origin, or that tries
 * to escape it (`..`, `%2e`, backslash), THROWS rather than falling through — the bearer token must
 * never ride a request the string only looks like an upload for.
 */
function authenticatedUploadPath(url: string): string | null {
  if (!url.includes(UPLOADS_PREFIX)) return null;
  if (/\.\.|%2e|\\/i.test(url)) throw new Error('media url rejected');
  const parsed = new URL(url, apiBase());
  if (parsed.origin !== new URL(apiBase()).origin || !parsed.pathname.startsWith(UPLOADS_PREFIX)) {
    throw new Error('media url rejected');
  }
  const key = parsed.pathname.slice(UPLOADS_PREFIX.length);
  if (!key) throw new Error('media url rejected');
  return UPLOADS_PREFIX + key.split('/').map((segment) => encodeURIComponent(decodeURIComponent(segment))).join('/');
}

/**
 * Fetch an uploaded file's bytes as a blob, the way the app is allowed to read it.
 *
 * `uploadCanvasFile` URLs (`/api/brain/uploads/<key>`) are tenant-authenticated: they need
 * the bearer token, which an `<img>` or a bare `fetch` cannot send, so they go through the
 * app's authenticated request helper. Any other URL (a public `/api/assets/<key>`, a signed
 * `/api/brain-files/...`, someone else's https) is a plain credential-less CORS fetch.
 * A blob is same-origin, so a canvas it is drawn on stays readable for export.
 */
export async function fetchCanvasMediaBlob(url: string): Promise<Blob> {
  const uploadPath = authenticatedUploadPath(url);
  const response = uploadPath
    ? await apiRequestStream(uploadPath)
    : await fetchWithTransportReport(url, { mode: 'cors', credentials: 'omit' }, { silent: true });
  if (!response.ok) throw new Error(`media fetch failed: ${response.status}`);
  return response.blob();
}
