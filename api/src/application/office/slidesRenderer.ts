/**
 * markdownToPptx — render a Brain Slides reply as a real .pptx.
 *
 * Reuses pptxgenjs (already used by the board-deck GenerativeRenderer) and the
 * same brand palette, but takes ARBITRARY slide content parsed from markdown
 * instead of the fixed board/CFO data shape — that renderer binds tenant metrics,
 * this one binds whatever the chat wrote.
 */

import pptxgen from 'pptxgenjs';
import { parseSlides, type MdSlide } from './markdownBlocks';

const BRAND = {
  primary: '4F46E5',
  ink: '111827',
  muted: '6B7280',
  white: 'FFFFFF',
  font: 'Arial',
};

type Slide = ReturnType<pptxgen['addSlide']>;

function titleSlide(pptx: pptxgen, title: string, subtitle: string): void {
  const s = pptx.addSlide();
  s.background = { color: BRAND.primary };
  s.addText(title, { x: 0.6, y: 1.9, w: 8.8, h: 1.4, fontSize: 34, bold: true, color: BRAND.white, fontFace: BRAND.font });
  if (subtitle) {
    s.addText(subtitle, { x: 0.6, y: 3.3, w: 8.8, h: 0.5, fontSize: 14, color: 'E0E7FF', fontFace: BRAND.font });
  }
}

function contentSlide(pptx: pptxgen, slide: MdSlide): void {
  const s: Slide = pptx.addSlide();
  s.background = { color: BRAND.white };
  s.addText(slide.title || ' ', { x: 0.5, y: 0.4, w: 9, h: 0.7, fontSize: 24, bold: true, color: BRAND.ink, fontFace: BRAND.font });
  s.addShape('line' as never, { x: 0.5, y: 1.15, w: 9, h: 0, line: { color: BRAND.primary, width: 2 } });

  let y = 1.45;
  if (slide.bullets.length) {
    s.addText(
      slide.bullets.slice(0, 8).map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
      { x: 0.7, y, w: 8.6, h: Math.min(3.4, 0.38 * Math.min(slide.bullets.length, 8) + 0.2), fontSize: 15, color: BRAND.ink, fontFace: BRAND.font, valign: 'top' },
    );
    y += Math.min(3.4, 0.38 * Math.min(slide.bullets.length, 8) + 0.35);
  }

  if (slide.table && y < 4.6) {
    const head = slide.table.head.map((h) => ({ text: h, options: { bold: true, color: BRAND.white, fill: { color: BRAND.primary }, fontSize: 10 } }));
    const rows = slide.table.rows.slice(0, 8).map((r) =>
      slide.table!.head.map((_, i) => ({ text: r[i] ?? '', options: { color: BRAND.ink, fontSize: 10 } })),
    );
    s.addTable([head, ...rows] as never, { x: 0.7, y, w: 8.6, border: { type: 'solid', color: 'E5E7EB', pt: 1 }, fontFace: BRAND.font, autoPage: false });
  }

  if (slide.note) s.addNotes(slide.note);
}

/** Render markdown slides (one `##` per slide) as .pptx bytes. */
export async function markdownToPptx(markdown: string, title?: string): Promise<Uint8Array> {
  const slides = parseSlides(markdown);
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_4x3';

  // The reply's own first heading is the deck title when it has no body of its
  // own; otherwise the caller's title opens the deck and every section follows.
  const lead = slides[0];
  const leadIsTitleOnly = !!lead && lead.bullets.length === 0 && !lead.table;
  titleSlide(pptx, (leadIsTitleOnly ? lead.title : title) || title || 'Deck', leadIsTitleOnly ? (title ?? '') : '');
  for (const s of slides.slice(leadIsTitleOnly ? 1 : 0)) contentSlide(pptx, s);
  if (slides.length === 0) contentSlide(pptx, { title: title ?? 'Deck', bullets: [] });

  // pptxgenjs writes a base64 string in a Worker (no Node streams).
  const b64 = (await pptx.write({ outputType: 'base64' })) as string;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
