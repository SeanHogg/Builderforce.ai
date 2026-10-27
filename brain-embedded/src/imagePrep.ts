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
 * the signed-URL fallback (see `attachFile.ts`).
 *
 * What is NOT re-encoded: a GIF (re-encoding through a canvas keeps one frame — the
 * animation is lost), and a PNG / WebP / JPEG already inside both caps (a re-encode only
 * costs quality). A picture with transparency is never flattened onto white JPEG: it is
 * re-encoded as WebP, which keeps alpha (the browser returns PNG when it cannot encode WebP).
 *
 * The caps are options (`ImagePrepOptions`) so a host can expose them as settings — the
 * editor's `builderforce.images.*` — while this module stays host-agnostic; the web keeps
 * the defaults.
 *
 * Browser-only (uses canvas). Returns null when run without a DOM (SSR) or for
 * a non-raster type (e.g. SVG/PDF) — callers fall back to the text-link path.
 */

/** Long-edge ceiling — matches the effective resolution frontier vision models use. */
export const DEFAULT_IMAGE_MAX_EDGE = 1568;
/** First rung of the JPEG/WebP quality ladder. */
export const DEFAULT_IMAGE_QUALITY = 0.85;
/** Encoded-size ceiling for an inline data URL (~3.5MB of base64). Past this we
 *  signal `tooLarge` so the caller uploads + signs a URL instead. */
const MAX_DATA_URL_BYTES = 3_500_000;
/** The lower rungs of the quality ladder, walked until the encode fits MAX_DATA_URL_BYTES. */
const LOWER_QUALITY_STEPS = [0.7, 0.55, 0.4] as const;

/** The host's caps. Omitted fields take the defaults above. */
export interface ImagePrepOptions {
  /** Long-edge ceiling in px. */
  maxEdge?: number;
  /** First JPEG/WebP quality tried, 0.3–1. */
  jpegQuality?: number;
}

/** Raster image types we can decode + re-encode through a canvas. SVG is vector
 *  (no meaningful raster downscale) and is left to the text-link path. */
function isRasterImage(type: string): boolean {
  return /^image\/(png|jpeg|jpg|gif|webp|bmp)$/i.test(type);
}

/** Types a model can take as they are, when they are inside the caps. */
function isKeepableType(type: string): boolean {
  return /^image\/(png|jpeg|jpg|webp|gif)$/i.test(type);
}

/** Types that can carry an alpha channel worth keeping. */
function mayHaveAlpha(type: string): boolean {
  return /^image\/(png|webp)$/i.test(type);
}

function isGif(type: string): boolean {
  return /^image\/gif$/i.test(type);
}

/** Base64 bytes of `raw` bytes of payload. */
function base64Bytes(raw: number): number {
  return Math.ceil(raw / 3) * 4;
}

/** The quality ladder starting at `first` (clamped 0.3–1), then the lower default rungs. */
export function qualityLadder(first: number | undefined): number[] {
  const q = typeof first === 'number' && Number.isFinite(first) ? Math.min(1, Math.max(0.3, first)) : DEFAULT_IMAGE_QUALITY;
  return [q, ...LOWER_QUALITY_STEPS.filter((s) => s < q - 0.01)];
}

/** The long-edge cap in force (a positive integer), defaulting to {@link DEFAULT_IMAGE_MAX_EDGE}. */
export function maxEdgeOf(opts: ImagePrepOptions = {}): number {
  const edge = opts.maxEdge;
  return typeof edge === 'number' && Number.isFinite(edge) && edge >= 64 ? Math.round(edge) : DEFAULT_IMAGE_MAX_EDGE;
}

/** What to do with one picture. */
export type ImageEncodeDecision =
  /** Send the original bytes — a GIF, or an image already inside both caps. */
  | { kind: 'keep' }
  /** Draw it (scaled to fit) and encode as `mime`, walking `qualities`. `matte`: paint
   *  white under it first (JPEG has no alpha). */
  | { kind: 'encode'; mime: 'image/jpeg' | 'image/webp'; qualities: number[]; matte: boolean };

/**
 * The encode decision for one picture — pure, so the rules are tested without a canvas:
 *
 *   • GIF → keep (a canvas keeps one frame);
 *   • PNG / WebP / JPEG within the edge cap whose base64 fits the inline budget → keep;
 *   • transparency → WebP (keeps alpha), no matte;
 *   • otherwise → JPEG on a white matte.
 */
export function decideImageEncoding(
  input: { type: string; size: number; width: number; height: number; hasAlpha: boolean },
  opts: ImagePrepOptions = {},
): ImageEncodeDecision {
  if (isGif(input.type)) return { kind: 'keep' };
  const withinEdge = Math.max(input.width, input.height) <= maxEdgeOf(opts);
  if (withinEdge && isKeepableType(input.type) && base64Bytes(input.size) <= MAX_DATA_URL_BYTES) return { kind: 'keep' };
  const qualities = qualityLadder(opts.jpegQuality);
  return input.hasAlpha
    ? { kind: 'encode', mime: 'image/webp', qualities, matte: false }
    : { kind: 'encode', mime: 'image/jpeg', qualities, matte: true };
}

export interface PreparedImage {
  /** Inline `data:` URL when the image fits the budget. */
  dataUrl?: string;
  /** True when even the most-compressed encode exceeded the inline budget —
   *  the caller should upload and mint a signed URL instead. */
  tooLarge?: boolean;
  /** The re-encoded picture, when one was produced — what the caller uploads in place of
   *  the original (absent when the original was kept as it is). */
  file?: File;
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

/** Read a File as a `data:` URL (the original bytes). */
function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}

/** Approximate decoded byte length of a base64 data URL without allocating it. */
function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

const EXT_BY_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' };

/** The encoded picture as a File named after the original, with the encode's extension. */
function dataUrlFile(dataUrl: string, original: string): File {
  const comma = dataUrl.indexOf(',');
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/jpeg';
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const base = original.replace(/\.[^./\\]+$/, '') || 'image';
  return new File([bytes], `${base}.${EXT_BY_MIME[mime] ?? 'img'}`, { type: mime });
}

/** True when any pixel of the drawn canvas is not fully opaque. */
function canvasHasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true;
  } catch {
    return false; // a tainted / unreadable canvas: assume opaque
  }
  return false;
}

/** The original bytes as the inline source, or `tooLarge` past the budget. */
async function keepOriginal(file: File): Promise<PreparedImage> {
  if (base64Bytes(file.size) > MAX_DATA_URL_BYTES) return { tooLarge: true };
  return { dataUrl: await fileDataUrl(file) };
}

/**
 * Prepare an image for an inline vision content part. Resolves with a `dataUrl`
 * when it fits the inline budget, `{ tooLarge: true }` when it doesn't even
 * after max compression, or `null` for non-raster / non-DOM inputs. `file` carries the
 * re-encoded picture when one was produced.
 */
export async function prepareImageDataUrl(file: File, opts: ImagePrepOptions = {}): Promise<PreparedImage | null> {
  if (typeof document === 'undefined' || !isRasterImage(file.type)) return null;
  // Never through a canvas: it would keep one frame of an animation.
  if (isGif(file.type)) return keepOriginal(file);

  const img = await loadImage(file);
  const scale = Math.min(1, maxEdgeOf(opts) / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const hasAlpha = mayHaveAlpha(file.type) && canvasHasAlpha(ctx, w, h);

  const decision = decideImageEncoding({ type: file.type, size: file.size, width: img.width, height: img.height, hasAlpha }, opts);
  if (decision.kind === 'keep') return keepOriginal(file);
  if (decision.matte) {
    // White matte so a flattened picture does not turn black where it was transparent.
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  let last = '';
  for (const q of decision.qualities) {
    last = canvas.toDataURL(decision.mime, q);
    if (dataUrlBytes(last) <= MAX_DATA_URL_BYTES) return { dataUrl: last, file: dataUrlFile(last, file.name) };
  }
  return last ? { tooLarge: true, file: dataUrlFile(last, file.name) } : { tooLarge: true };
}
