/**
 * Standard-14 font metrics — the widths the PDF writer measures text with.
 *
 * A PDF that uses the 14 base fonts embeds no font program: the viewer already
 * has Helvetica, Times and Courier. That keeps the file small and the writer
 * dependency-free, but it means WE have to know the glyph widths, because the
 * layout (line wrapping, table columns, right-aligned numbers) is decided here
 * and the viewer only replays it.
 *
 * Widths are the AFM values for WinAnsiEncoding, in 1/1000 em, for codes 32-126
 * — the range real proposal/document text is written in. Anything above 126 is
 * still DRAWN (WinAnsi covers Latin-1 plus the typographic punctuation people
 * paste in); it is measured at `DEFAULT_WIDTH`, which is the right trade: a
 * one-glyph measurement error moves a wrap point, an unmeasurable glyph would
 * mean no wrap at all.
 */

/** Widths for codes 32..126, in 1/1000 em. */
type WidthRow = readonly number[];

const HELVETICA: WidthRow = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const HELVETICA_BOLD: WidthRow = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

const TIMES: WidthRow = [
  250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444,
  921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722,
  556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500,
  333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500,
  500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541,
];

const TIMES_BOLD: WidthRow = [
  250, 333, 555, 500, 500, 1000, 833, 278, 333, 333, 500, 570, 250, 333, 250, 278,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 570, 570, 570, 500,
  930, 722, 667, 722, 722, 667, 611, 778, 778, 389, 500, 778, 667, 944, 722, 778,
  611, 778, 722, 556, 667, 722, 722, 1000, 722, 722, 667, 333, 278, 333, 581, 500,
  333, 500, 556, 444, 556, 444, 333, 500, 556, 278, 333, 556, 278, 833, 556, 500,
  556, 556, 444, 389, 333, 556, 500, 722, 500, 500, 444, 394, 220, 394, 520,
];

/** Courier is monospaced — one width for every glyph, no table needed. */
const COURIER_WIDTH = 600;

/** Measured width for any code the tables do not cover (127+). */
const DEFAULT_WIDTH = 500;

/** The base-14 PostScript names this writer emits, keyed by resource slot. */
export const PDF_FONT_SLOTS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'] as const;
export type PdfFontSlot = (typeof PDF_FONT_SLOTS)[number];

export type PdfFontFamily = 'sans' | 'serif' | 'mono';

interface FamilyFaces {
  regular: string; bold: string; italic: string; boldItalic: string;
  regularWidths: WidthRow | null; boldWidths: WidthRow | null;
}

const FAMILIES: Record<PdfFontFamily, FamilyFaces> = {
  sans: {
    regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', boldItalic: 'Helvetica-BoldOblique',
    regularWidths: HELVETICA, boldWidths: HELVETICA_BOLD,
  },
  serif: {
    regular: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic', boldItalic: 'Times-BoldItalic',
    regularWidths: TIMES, boldWidths: TIMES_BOLD,
  },
  mono: {
    regular: 'Courier', bold: 'Courier-Bold', italic: 'Courier-Oblique', boldItalic: 'Courier-BoldOblique',
    regularWidths: null, boldWidths: null,
  },
};

/**
 * The six PostScript font names a document's resource dictionary maps, in slot
 * order: the body family's four faces, then Courier + Courier-Bold for code.
 * Monospaced code always renders in Courier even in a serif document, because a
 * code fence's alignment is the point of the fence.
 */
export function fontNamesFor(family: PdfFontFamily): Record<PdfFontSlot, string> {
  const f = FAMILIES[family];
  return { F1: f.regular, F2: f.bold, F3: f.italic, F4: f.boldItalic, F5: 'Courier', F6: 'Courier-Bold' };
}

/** The resource slot for a body run with these emphasis flags. */
export function slotFor(bold: boolean, italic: boolean, mono: boolean): PdfFontSlot {
  if (mono) return bold ? 'F6' : 'F5';
  if (bold && italic) return 'F4';
  if (bold) return 'F2';
  if (italic) return 'F3';
  return 'F1';
}

/** Width of one WinAnsi code point in 1/1000 em for a slot of this family. */
function glyphWidth(family: PdfFontFamily, slot: PdfFontSlot, code: number): number {
  if (slot === 'F5' || slot === 'F6' || family === 'mono') return COURIER_WIDTH;
  const bold = slot === 'F2' || slot === 'F4';
  const table = bold ? FAMILIES[family].boldWidths : FAMILIES[family].regularWidths;
  if (!table) return COURIER_WIDTH;
  const idx = code - 32;
  return idx >= 0 && idx < table.length ? (table[idx] as number) : DEFAULT_WIDTH;
}

/**
 * Width of a WinAnsi byte string at a given point size. Callers hand in the
 * already-encoded bytes so measurement and drawing agree on exactly which
 * glyphs the viewer will see.
 */
export function measureBytes(bytes: readonly number[], family: PdfFontFamily, slot: PdfFontSlot, size: number): number {
  let total = 0;
  for (const code of bytes) total += glyphWidth(family, slot, code);
  return (total * size) / 1000;
}
