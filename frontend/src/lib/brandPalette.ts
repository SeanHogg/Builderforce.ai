/**
 * Read a brand palette off a logo, in the browser.
 *
 * The other half of brand capture. `api/src/application/rfp/brandExtraction.ts`
 * reads a website's DECLARED colours (meta theme-color, CSS custom properties,
 * usage frequency) because only a server can fetch a third-party stylesheet.
 * This reads an IMAGE's colours, because only a browser has a decoder for PNG,
 * JPEG, WebP, GIF and SVG — re-implementing one in a Worker to do the same job
 * worse is not a trade worth making.
 *
 * The method is a saturation-weighted popularity histogram, not a naive "most
 * common pixel": a logo on a white card is mostly white, and its brand colour is
 * the saturated hue that appears a few thousand times. Buckets are coarse (16
 * levels per channel) so anti-aliasing and JPEG ringing land in the same bucket
 * as the colour they are smearing.
 *
 * Deterministic: the same file yields the same palette every time, because a
 * proposal that changes colour between two generations looks broken.
 */

/**
 * What a native `<input type="color">` shows for a value it cannot parse.
 *
 * The control accepts `#rrggbb` and nothing else, so a half-typed draft has to
 * be coerced to something before it reaches the DOM. It is NOT a theme colour —
 * it is the initial position of a picker whose output is then persisted as the
 * author's own choice and rendered into a document outside this app's CSS,
 * which is the same reason the drawing tray keeps its own fallback hex.
 */
export const FALLBACK_SWATCH_HEX = '#000000';

export interface ImagePalette {
  primary: string;
  secondary: string;
  accent: string;
  /** Every candidate the image offered, best first, so a person can pick another. */
  candidates: string[];
}

/** Pixels are sampled down to this many on the long edge — plenty for colour,
 *  and it keeps a 4000px logo from costing a frame. */
const SAMPLE_EDGE = 160;
/** Channel quantisation: 16 levels, so near-identical shades share a bucket. */
const LEVELS = 16;
const STEP = 256 / LEVELS;

interface Hsl { h: number; s: number; l: number }

function toHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function hex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** How brand-like a colour is: saturated, and neither near-white nor near-black.
 *  The card it sits on and the text on it both score ~0, which is the point. */
function chromaScore({ s, l }: Hsl): number {
  if (l > 0.95 || l < 0.06) return 0;
  const midness = 1 - Math.abs(l - 0.5) * 1.6;
  return s * Math.max(midness, 0.05);
}

/** Perceptual distance, so the palette is three DIFFERENT colours rather than
 *  one colour and two of its anti-aliased neighbours. */
function distance(a: Hsl, b: Hsl): number {
  const dh = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h)) / 180;
  return Math.sqrt(dh * dh + (a.s - b.s) ** 2 + (a.l - b.l) ** 2);
}

/** Decode to pixels through whichever surface this browser gives us. */
async function readPixels(source: Blob | string): Promise<ImageData | null> {
  const bitmap = await loadBitmap(source);
  if (!bitmap) return null;
  const scale = Math.min(1, SAMPLE_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = (canvas as HTMLCanvasElement).getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } catch {
    // A cross-origin image with no CORS headers taints the canvas and
    // `getImageData` throws. That is a real refusal, not a bug: say so by
    // returning null rather than inventing a palette.
    return null;
  } finally {
    if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

async function loadBitmap(source: Blob | string): Promise<ImageBitmap | HTMLImageElement | null> {
  try {
    if (typeof source !== 'string' && typeof createImageBitmap === 'function') return await createImageBitmap(source);
  } catch { /* fall through to the <img> path (SVG in some engines) */ }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = typeof source === 'string' ? source : URL.createObjectURL(source);
  });
}

/**
 * The palette an image offers. Returns null when the image cannot be read —
 * an unsupported file, or a cross-origin URL that taints the canvas — so the
 * caller can leave the hand-entered colours alone instead of overwriting them
 * with a fabricated default.
 */
export async function extractPaletteFromImage(source: Blob | string): Promise<ImagePalette | null> {
  const data = await readPixels(source);
  if (!data) return null;

  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const alpha = px[i + 3] as number;
    if (alpha < 128) continue;                       // transparent logo ground
    const r = px[i] as number, g = px[i + 1] as number, b = px[i + 2] as number;
    const key = (Math.floor(r / STEP) << 8) | (Math.floor(g / STEP) << 4) | Math.floor(b / STEP);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1; bucket.r += r; bucket.g += g; bucket.b += b;
    buckets.set(key, bucket);
  }
  if (buckets.size === 0) return null;

  const ranked = [...buckets.values()]
    .map((bucket) => {
      const r = bucket.r / bucket.count, g = bucket.g / bucket.count, b = bucket.b / bucket.count;
      const hsl = toHsl(r, g, b);
      return { hex: hex(r, g, b), hsl, score: Math.log2(bucket.count + 1) * chromaScore(hsl) };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return null;

  const chosen: typeof ranked = [];
  for (const candidate of ranked) {
    if (chosen.every((c) => distance(c.hsl, candidate.hsl) > 0.18)) chosen.push(candidate);
    if (chosen.length === 3) break;
  }

  const first = chosen[0] ?? ranked[0]!;
  return {
    primary: first.hex,
    secondary: (chosen[1] ?? first).hex,
    accent: (chosen[2] ?? chosen[1] ?? first).hex,
    candidates: ranked.slice(0, 12).map((c) => c.hex),
  };
}
