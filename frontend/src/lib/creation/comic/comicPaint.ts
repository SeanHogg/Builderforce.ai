/**
 * Draws one comic page onto a canvas. The exporter calls this for every page; it is
 * deliberately the ONLY place a page is rasterised so an export cannot differ from
 * what the page is.
 *
 * The page is printed artwork, so its colours are fixed paper-and-ink values and
 * do not follow the UI theme.
 */
import { resolveExportPalette } from '../exportColors';
import type { ComicBubble, ComicPage, ComicState } from './comicState';

export type ComicImageSource = CanvasImageSource & { width: number; height: number };

/**
 * The colours of a printed page, as concrete values the CALLER resolves (export palette
 * roles `paper`, `ink`, `caption`, `panelEmpty`) — this module takes them, it owns none.
 */
export interface ComicColors { paper: string; ink: string; caption: string; panelEmpty: string }

/** Greedy word wrap. A single word wider than `maxWidth` is placed on its own line. */
export function wrapLines(textValue: string, maxWidth: number, measure: (candidate: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of textValue.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate) > maxWidth) { lines.push(line); line = word; } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

/** Draw `image` to fill the rect, cropping the overflow ("cover"), not stretching it. */
function drawCover(ctx: CanvasRenderingContext2D, image: ComicImageSource, x: number, y: number, w: number, h: number): void {
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawBubble(ctx: CanvasRenderingContext2D, colors: ComicColors, bubble: ComicBubble, px: number, py: number, pw: number, ph: number, fontPx: number): void {
  if (!bubble.text.trim()) return;
  ctx.save();
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  const maxTextWidth = pw * 0.6;
  const lines = wrapLines(bubble.text, maxTextWidth, (candidate) => ctx.measureText(candidate).width);
  const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const pad = fontPx * 0.7;
  const lineHeight = fontPx * 1.25;
  const w = Math.min(pw - 4, textWidth + pad * 2);
  const h = Math.min(ph - 4, lines.length * lineHeight + pad * 2);
  const x = Math.max(px + 2, Math.min(px + pw - w - 2, px + bubble.x * pw - w / 2));
  const y = Math.max(py + 2, Math.min(py + ph - h - 2, py + bubble.y * ph - h / 2));

  ctx.lineWidth = Math.max(2, fontPx * 0.12);
  ctx.strokeStyle = colors.ink;
  ctx.fillStyle = bubble.kind === 'caption' ? colors.caption : colors.paper;
  ctx.beginPath();
  if (bubble.kind === 'caption') {
    ctx.rect(x, y, w, h);
  } else if (bubble.kind === 'thought') {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.roundRect(x, y, w, h, Math.min(h / 2, fontPx * 1.2));
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = colors.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, index) => ctx.fillText(line, x + w / 2, y + pad + lineHeight * (index + 0.5), w - pad));
  ctx.restore();
}

/** Paint a whole page at the canvas's current size, which should match the state's aspect. */
export function paintComicPage(
  ctx: CanvasRenderingContext2D,
  page: ComicPage,
  state: Pick<ComicState, 'width' | 'height'>,
  images: ReadonlyMap<string, ComicImageSource>,
  canvasWidth: number,
  canvasHeight: number,
  colors: ComicColors = resolveExportPalette(),
): void {
  const scale = canvasWidth / state.width;
  ctx.save();
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  for (const panel of page.panels) {
    const x = panel.x * canvasWidth;
    const y = panel.y * canvasHeight;
    const w = panel.w * canvasWidth;
    const h = panel.h * canvasHeight;
    const image = panel.imageUrl ? images.get(panel.imageUrl) : undefined;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = colors.panelEmpty;
    ctx.fillRect(x, y, w, h);
    if (image) drawCover(ctx, image, x, y, w, h);
    ctx.restore();
    ctx.lineWidth = Math.max(2, 5 * scale);
    ctx.strokeStyle = colors.ink;
    ctx.strokeRect(x, y, w, h);
    for (const bubble of panel.bubbles) drawBubble(ctx, colors, bubble, x, y, w, h, Math.max(10, 26 * scale));
  }
  ctx.restore();
}
