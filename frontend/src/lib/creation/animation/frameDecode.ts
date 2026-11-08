/**
 * Decoded frame pixels, keyed by the frame's URL.
 *
 * A frame is an uploaded PNG (a public `/api/assets/<key>` URL, which answers CORS for the
 * app's origins; a tenant-authenticated upload URL is fetched with the bearer token) or — for a guest with nowhere to upload — a small data URL.
 * An https frame is FETCHED to a blob and decoded from that: a blob is same-origin, so
 * the canvas it is drawn on is never tainted and can still be read back for export.
 *
 * The paint stage and the exporter both come through here, and a small LRU of decoded
 * images (an `ImageBitmap` where the browser has one) makes a redraw a `drawImage`
 * instead of a fetch and a decode. A bitmap is closed when it leaves the cache.
 */
import { fetchCanvasMediaBlob } from '@/lib/canvasMediaStore';

type Decoded = CanvasImageSource;

const CAPACITY = 24;
const cache = new Map<string, Promise<Decoded>>();

async function imageFrom(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}

async function decode(url: string): Promise<Decoded> {
  if (url.startsWith('data:')) {
    const image = await imageFrom(url);
    return typeof createImageBitmap === 'function' ? createImageBitmap(image) : image;
  }
  const blob = await fetchCanvasMediaBlob(url);
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const objectUrl = URL.createObjectURL(blob);
  try { return await imageFrom(objectUrl); } finally { URL.revokeObjectURL(objectUrl); }
}

export function decodeFrame(url: string): Promise<Decoded> {
  const hit = cache.get(url);
  if (hit) { cache.delete(url); cache.set(url, hit); return hit; }
  const pending = decode(url);
  cache.set(url, pending);
  // A failed decode must not stay cached: the next ask retries.
  pending.catch(() => { if (cache.get(url) === pending) cache.delete(url); });
  while (cache.size > CAPACITY) {
    const [oldest] = cache.keys();
    const evicted = cache.get(oldest!);
    cache.delete(oldest!);
    void evicted?.then((source) => { if ('close' in source && typeof source.close === 'function') source.close(); }, () => undefined);
  }
  return pending;
}

/** Test seam: forget every decoded frame. */
export function clearFrameDecodeCache(): void { cache.clear(); }
