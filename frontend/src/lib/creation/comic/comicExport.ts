/**
 * Comic export: a {@link ComicState} to a CBZ archive, one tall PNG, or a PDF.
 *
 * Every format starts from the same rasterised pages ({@link paintComicPage}), so the
 * three can never disagree about what a page looks like. An image that cannot be loaded
 * (offline, or an https host that refuses cross-origin use) leaves its panel grey rather
 * than failing the export.
 */
import { resolveExportPalette } from '../exportColors';
import { zipFiles } from '@/lib/zipFiles';
import { loadAuthedImage } from '@/lib/loadAuthedImage';
import { buildPdf, rgbaToRgb } from './comicPdf';
import { paintComicPage, type ComicColors, type ComicImageSource } from './comicPaint';
import type { ComicState } from './comicState';

export type ComicExportFormat = 'cbz' | 'png-strip' | 'pdf';

export interface ComicExportFormatSpec {
  format: ComicExportFormat;
  mimeType: string;
  extension: string;
}

export const COMIC_EXPORT_FORMATS: readonly ComicExportFormatSpec[] = [
  { format: 'cbz', mimeType: 'application/vnd.comicbook+zip', extension: 'cbz' },
  { format: 'png-strip', mimeType: 'image/png', extension: 'png' },
  { format: 'pdf', mimeType: 'application/pdf', extension: 'pdf' },
];

/** Why a comic could not be rendered in the chosen format; the UI words it. */
export class ComicExportError extends Error {
  constructor(readonly code: 'tooTall') {
    super(`comic export: ${code}`);
    this.name = 'ComicExportError';
  }
}

/** Longest canvas side and largest canvas area browsers reliably allocate (iOS Safari is the tightest on area). */
export const MAX_CANVAS_SIDE = 32_767;
export const MAX_CANVAS_AREA = 16_777_216;
/** A strip scaled below this is no longer legible; the export is refused instead. */
export const MIN_STRIP_SCALE = 0.25;

/**
 * The size of the one-tall-image export. Within the browser's canvas limits it is the
 * pages at full size; past them it is scaled down to fit, and past `MIN_STRIP_SCALE` it
 * is refused (`ComicExportError`) so the person is told to use CBZ or PDF rather than
 * handed a blank file from a canvas the browser silently failed to allocate.
 */
export function stripSize(pageWidth: number, pageHeight: number, pageCount: number): { width: number; height: number; scale: number } {
  const fullHeight = pageHeight * pageCount;
  const scale = Math.min(1, MAX_CANVAS_SIDE / fullHeight, Math.sqrt(MAX_CANVAS_AREA / (pageWidth * fullHeight)));
  if (scale < MIN_STRIP_SCALE) throw new ComicExportError('tooTall');
  return { width: Math.max(1, Math.floor(pageWidth * scale)), height: Math.max(1, Math.floor(fullHeight * scale)), scale };
}

export interface ComicRenderResult {
  blob: Blob;
  pageCount: number;
}

function loadImage(url: string): Promise<ComicImageSource | null> {
  // A private upload is fetched with the bearer token and drawn from a same-origin blob.
  return loadAuthedImage(url).catch(() => null);
}

async function loadPanelImages(state: ComicState): Promise<Map<string, ComicImageSource>> {
  const urls = new Set(state.pages.flatMap((page) => page.panels.flatMap((panel) => panel.imageUrl ? [panel.imageUrl] : [])));
  const images = new Map<string, ComicImageSource>();
  await Promise.all([...urls].map(async (url) => {
    const image = await loadImage(url);
    if (image) images.set(url, image);
  }));
  return images;
}

function newCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('comic export: no 2D context');
  return { canvas, ctx };
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('comic export: PNG encoding failed')), 'image/png');
  });
}

/** One canvas per page, painted. Sized to the state, so a page is `width x height` px. */
async function paintPages(state: ComicState, colors: ComicColors): Promise<HTMLCanvasElement[]> {
  const images = await loadPanelImages(state);
  return state.pages.map((page) => {
    const { canvas, ctx } = newCanvas(state.width, state.height);
    paintComicPage(ctx, page, state, images, state.width, state.height, colors);
    return canvas;
  });
}

/** `colors` are the export palette's roles, resolved by the caller. */
export async function renderComic(state: ComicState, format: ComicExportFormat, colors: ComicColors = resolveExportPalette()): Promise<ComicRenderResult> {
  const spec = COMIC_EXPORT_FORMATS.find((entry) => entry.format === format);
  if (!spec) throw new Error(`renderComic: unknown format ${format}`);
  // Refuse an impossible strip before spending time painting every page.
  const stripDims = format === 'png-strip' ? stripSize(state.width, state.height, state.pages.length) : null;
  const canvases = await paintPages(state, colors);
  const pageCount = canvases.length;

  if (format === 'cbz') {
    // Zero-padded names so readers sort pages correctly; PNG is already compressed.
    const padding = Math.max(2, String(pageCount).length);
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < pageCount; i++) {
      files[`page-${String(i + 1).padStart(padding, '0')}.png`] = new Uint8Array(await (await canvasToPng(canvases[i]!)).arrayBuffer());
    }
    return { blob: new Blob([zipFiles(files, { level: 0 })], { type: spec.mimeType }), pageCount };
  }

  if (format === 'png-strip') {
    const size = stripDims!;
    const { canvas, ctx } = newCanvas(size.width, size.height);
    const pageHeight = size.height / pageCount;
    canvases.forEach((page, i) => ctx.drawImage(page, 0, i * pageHeight, size.width, pageHeight));
    return { blob: await canvasToPng(canvas), pageCount };
  }

  const pdf = buildPdf(canvases.map((canvas) => ({
    width: canvas.width,
    height: canvas.height,
    rgb: rgbaToRgb(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data),
  })));
  return { blob: new Blob([pdf as BlobPart], { type: spec.mimeType }), pageCount };
}
