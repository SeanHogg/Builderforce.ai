import { fetchCanvasMediaBlob } from '@/lib/canvasMediaStore';

/** Whether a URL needs the app's bearer token to read (a tenant-authenticated upload). */
export function isAuthedMediaUrl(url: string): boolean {
  return url.includes('/api/brain/uploads/');
}

/**
 * Load an image into an `HTMLImageElement` for canvas drawing. A tenant-authenticated upload URL
 * is fetched through the authenticated request helper first and loaded from a same-origin blob
 * (an `<img>` cannot send the bearer token, and a blob keeps the canvas untainted for export);
 * any other URL (data:, blob:, public) is loaded as-is, with CORS requested for remote ones.
 */
export async function loadAuthedImage(url: string): Promise<HTMLImageElement> {
  let src = url;
  let objectUrl: string | null = null;
  if (isAuthedMediaUrl(url)) {
    objectUrl = URL.createObjectURL(await fetchCanvasMediaBlob(url));
    src = objectUrl;
  }
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      if (!objectUrl && /^https?:/i.test(src)) image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('image failed to load'));
      image.src = src;
    });
  } finally {
    // The decoded bitmap stays valid on the element once loaded.
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
