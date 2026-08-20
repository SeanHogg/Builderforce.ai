import { brain } from '@/lib/builderforceApi';
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
    const uploaded = await brain.upload(file);
    return { url: brain.uploadUrl(uploaded.key), storageKey: uploaded.key };
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

