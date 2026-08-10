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

/** The only browser-side persistence adapter used by Canvas media authoring. */
export async function storeCanvasMedia(file: File, captureKind: CanvasVideoCaptureKind): Promise<CanvasVideoSource> {
  const kind = sourceKind(file);
  let url: string;
  let storageKey: string | undefined;
  try {
    const uploaded = await brain.upload(file);
    storageKey = uploaded.key;
    url = brain.uploadUrl(uploaded.key);
  } catch {
    // Guest canvases have no tenant R2 boundary. A data URL keeps their draft
    // reloadable and the normal account-upgrade flow moves it server-side later.
    url = await dataUrl(file);
  }
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

