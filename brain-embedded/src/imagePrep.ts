/**
 * Client-side image preparation for vision messages.
 *
 * Turns a user-picked / pasted image File into a `data:` URL the gateway can
 * inline straight into an `image_url` content part — downscaled and recompressed
 * so the request payload (and the provider's per-image budget) stays sane.
 *
 * Why downscale at all: frontier vision models cap the long edge around ~1568px
 * (anything larger is downsampled server-side anyway) and reject images past a
 * few MB of base64. Shrinking here keeps virtually every real screenshot/photo
 * inside the inline budget, so the rare oversize case is the ONLY one that needs
 * the signed-URL fallback (see useBrainConversation.attach).
 *
 * Browser-only (uses canvas). Returns null when run without a DOM (SSR) or for
 * a non-raster type (e.g. SVG/PDF) — callers fall back to the text-link path.
 */

/** Long-edge ceiling — matches the effective resolution frontier vision models use. */
const MAX_EDGE = 1568;
/** Encoded-size ceiling for an inline data URL (~3.5MB of base64). Past this we
 *  signal `tooLarge` so the caller uploads + signs a URL instead. */
const MAX_DATA_URL_BYTES = 3_500_000;
/** Quality ladder walked until the encoded image fits MAX_DATA_URL_BYTES. */
const QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4] as const;

/** Raster image types we can decode + re-encode through a canvas. SVG is vector
 *  (no meaningful raster downscale) and is left to the text-link path. */
function isRasterImage(type: string): boolean {
  return /^image\/(png|jpeg|jpg|gif|webp|bmp)$/i.test(type);
}

export interface PreparedImage {
  /** Inline `data:` URL when the recompressed image fits the budget. */
  dataUrl?: string;
  /** True when even the most-compressed encode exceeded the inline budget —
   *  the caller should upload the original and mint a signed URL instead. */
  tooLarge?: boolean;
}

/** Decode a File into an HTMLImageElement via an object URL. */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode image')); };
    img.src = url;
  });
}

/** Approximate decoded byte length of a base64 data URL without allocating it. */
function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

/**
 * Prepare an image for an inline vision content part. Resolves with a `dataUrl`
 * when it fits the inline budget, `{ tooLarge: true }` when it doesn't even
 * after max compression, or `null` for non-raster / non-DOM inputs.
 */
export async function prepareImageDataUrl(file: File): Promise<PreparedImage | null> {
  if (typeof document === 'undefined' || !isRasterImage(file.type)) return null;

  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // White matte so transparent PNGs don't turn black when flattened to JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  for (const q of QUALITY_STEPS) {
    const dataUrl = canvas.toDataURL('image/jpeg', q);
    if (dataUrlBytes(dataUrl) <= MAX_DATA_URL_BYTES) return { dataUrl };
  }
  return { tooLarge: true };
}
