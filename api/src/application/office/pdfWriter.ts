/**
 * renderPdf / markdownToPdf — write a real PDF from the same block model the
 * .docx and .pptx writers already read.
 *
 * The platform emitted "PDF" by opening the browser's print dialog on a styled
 * HTML page. That is not an export: it needs a human at a keyboard, it cannot be
 * attached to an email an agent sends, it cannot be stored as the artifact of a
 * run, and it prints whatever the visitor's browser thinks the page looks like.
 * This writes the bytes server-side, deterministically, so `Download PDF` is the
 * same file for everyone.
 *
 * No dependency is added. A PDF is a text container with an offset table, and
 * the base-14 fonts mean no font program has to be embedded — the widths live in
 * `pdfFonts.ts` so this file can measure what the viewer will draw. Text is
 * encoded WinAnsi (Latin-1 plus the typographic punctuation people paste in);
 * anything outside it degrades to `?` rather than corrupting the stream.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────
 * Headings, paragraphs with inline emphasis, bullet/ordered lists, GFM tables
 * and code fences — exactly the block set `parseMarkdownBlocks` produces, so a
 * document exports to .docx and .pdf with the same structure. Plus a branded
 * cover band (title, subtitle, a headline badge) because the proposal and pitch
 * documents that most need a PDF are co-branded documents, not plain text.
 */

import { parseMarkdownBlocks, parseInlineRuns, type MdBlock, type MdRun } from './markdownBlocks';
import {
  PDF_FONT_SLOTS, fontNamesFor, slotFor, measureBytes,
  type PdfFontFamily, type PdfFontSlot,
} from './pdfFonts';

// ── page geometry (A4, points) ───────────────────────────────────────────────
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 56;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 62;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const BANNER_H = 96;

/** Point sizes per block role. */
const SIZE = { title: 21, subtitle: 10.5, h1: 17, h2: 13.5, h3: 11.5, body: 10, code: 8.8, cell: 9, foot: 8 };
const LEADING = 1.42;

export interface PdfTheme {
  /** Leading brand colour — the cover band, rules and h1/h2. */
  accent?: string;
  /** Supporting colour — h3 and the table header band. */
  secondary?: string;
  font?: PdfFontFamily;
  density?: 'compact' | 'comfortable' | 'spacious';
}

export interface PdfDocumentSpec {
  blocks: MdBlock[];
  /** Drawn in the cover band. Omitted → the document starts at the first block. */
  title?: string;
  subtitle?: string;
  /** A headline figure shown on the right of the cover band (e.g. a quoted price). */
  badge?: { label: string; value: string };
  /** Repeated bottom-left on every page, next to `page / total`. */
  footer?: string;
  theme?: PdfTheme;
}

interface RGB { r: number; g: number; b: number }

interface ResolvedTheme {
  accent: RGB; secondary: RGB; text: RGB; muted: RGB; rule: RGB; band: RGB;
  family: PdfFontFamily; scale: number;
}

// ── colour ───────────────────────────────────────────────────────────────────

const HEX6 = /^#?([0-9a-f]{6})$/i;

function toRgb(value: string | undefined, fallback: RGB): RGB {
  const m = HEX6.exec((value ?? '').trim());
  if (!m) return fallback;
  const n = parseInt(m[1] as string, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

const fillOp = (c: RGB): string => `${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)} rg`;
const strokeOp = (c: RGB): string => `${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)} RG`;

const WHITE: RGB = { r: 1, g: 1, b: 1 };

function resolveTheme(theme: PdfTheme = {}): ResolvedTheme {
  return {
    accent: toRgb(theme.accent, { r: 0.07, g: 0.09, b: 0.15 }),
    secondary: toRgb(theme.secondary, { r: 0.31, g: 0.35, b: 0.44 }),
    text: { r: 0.07, g: 0.09, b: 0.15 },
    muted: { r: 0.42, g: 0.45, b: 0.5 },
    rule: { r: 0.85, g: 0.87, b: 0.9 },
    band: { r: 0.96, g: 0.97, b: 0.98 },
    family: theme.font ?? 'sans',
    scale: theme.density === 'compact' ? 0.9 : theme.density === 'spacious' ? 1.1 : 1,
  };
}

// ── WinAnsi encoding ─────────────────────────────────────────────────────────

/** WinAnsi codes for the punctuation people actually paste into documents —
 *  everything in the 0x80-0x9F band that Latin-1 does not carry. */
const WIN_ANSI_SPECIALS: Readonly<Record<string, number>> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c,
  'ž': 0x9e, 'Ÿ': 0x9f,
  // Arrows and the non-breaking space appear constantly in generated copy and
  // have no WinAnsi glyph; a readable stand-in beats a question mark.
  '→': 0x3e, '←': 0x3c, ' ': 0x20, '−': 0x2d,
};

const BULLET = 0x95;

/** Encode a JS string to WinAnsi byte codes; unrepresentable glyphs become `?`. */
function winAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    if (code === 0x0a || code === 0x0d || code === 0x09) { out.push(0x20); continue; }
    if (code < 0x20) continue;
    if (code <= 0xff) { out.push(code); continue; }
    out.push(WIN_ANSI_SPECIALS[ch] ?? 63);
  }
  return out;
}

/** A PDF literal string: the WinAnsi bytes with `\`, `(` and `)` escaped. */
function literal(bytes: readonly number[]): string {
  let s = '(';
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += `\\${String.fromCharCode(b)}`;
    else s += String.fromCharCode(b);
  }
  return `${s})`;
}

// ── run tokenisation + wrapping ──────────────────────────────────────────────

interface Piece { bytes: number[]; slot: PdfFontSlot; width: number }
interface Line { pieces: Piece[]; width: number }
interface RunStyle { bold?: boolean; italic?: boolean; code?: boolean }

function piecesFor(text: string, style: RunStyle, family: PdfFontFamily, size: number): Piece[] {
  const slot = slotFor(!!style.bold, !!style.italic, !!style.code);
  return text
    .split(/(\s+)/)
    .filter((tok) => tok !== '')
    .map((tok) => {
      const bytes = winAnsi(tok);
      return { bytes, slot, width: measureBytes(bytes, family, slot, size) };
    });
}

function runsToPieces(runs: MdRun[], family: PdfFontFamily, size: number, force?: RunStyle): Piece[] {
  return runs.flatMap((r) => piecesFor(r.text, {
    bold: force?.bold ?? r.bold,
    italic: force?.italic ?? r.italic,
    code: force?.code ?? r.code,
  }, family, size));
}

/**
 * Greedy line-break over styled tokens. A single token wider than the column is
 * broken at the character that overflows, so a long URL wraps instead of
 * bleeding past the margin.
 */
function wrap(tokens: Piece[], family: PdfFontFamily, size: number, maxWidth: number): Line[] {
  const width = Math.max(24, maxWidth);
  const lines: Line[] = [];
  let cur: Line = { pieces: [], width: 0 };
  const push = (): void => { if (cur.pieces.length) lines.push(cur); cur = { pieces: [], width: 0 }; };

  for (const tok of tokens) {
    const isSpace = tok.bytes.every((b) => b === 0x20);
    if (isSpace && cur.pieces.length === 0) continue;
    if (cur.width + tok.width <= width) { cur.pieces.push(tok); cur.width += tok.width; continue; }

    if (tok.width > width) {
      // Break the oversized token itself, one glyph at a time.
      let bytes: number[] = [];
      let run = 0;
      for (const b of tok.bytes) {
        const w = measureBytes([b], family, tok.slot, size);
        if (cur.width + run + w > width && (bytes.length > 0 || cur.pieces.length > 0)) {
          if (bytes.length) { cur.pieces.push({ bytes, slot: tok.slot, width: run }); cur.width += run; }
          push();
          bytes = []; run = 0;
        }
        bytes.push(b); run += w;
      }
      if (bytes.length) { cur.pieces.push({ bytes, slot: tok.slot, width: run }); cur.width += run; }
      continue;
    }

    push();
    if (!isSpace) { cur.pieces.push(tok); cur.width = tok.width; }
  }
  push();
  return lines.length ? lines : [{ pieces: [], width: 0 }];
}

// ── the layout engine ────────────────────────────────────────────────────────

class PdfLayout {
  private readonly banked: string[][] = [];
  private ops: string[] = [];
  private y = PAGE_H - MARGIN_TOP;

  constructor(private readonly theme: ResolvedTheme) {}

  /** Bank the current page and start a fresh one. */
  private breakPage(): void {
    this.banked.push(this.ops);
    this.ops = [];
    this.y = PAGE_H - MARGIN_TOP;
  }

  finish(): string[][] {
    this.banked.push(this.ops);
    this.ops = [];
    return this.banked;
  }

  private ensure(height: number): void {
    if (this.y - height < MARGIN_BOTTOM) this.breakPage();
  }

  private text(x: number, y: number, size: number, slot: PdfFontSlot, color: RGB, bytes: readonly number[]): void {
    if (!bytes.length) return;
    this.ops.push(`BT ${fillOp(color)} /${slot} ${size.toFixed(2)} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm ${literal(bytes)} Tj ET`);
  }

  private rect(x: number, y: number, w: number, h: number, color: RGB): void {
    this.ops.push(`${fillOp(color)} ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  private rule(x1: number, y1: number, x2: number, y2: number, color: RGB, weight = 0.6): void {
    this.ops.push(`${strokeOp(color)} ${weight} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  /** Draw one already-wrapped line at an absolute baseline, no cursor movement. */
  private drawLineAt(line: Line, x: number, baseline: number, size: number, color: RGB): void {
    let cursor = x;
    for (const p of line.pieces) {
      this.text(cursor, baseline, size, p.slot, color, p.bytes);
      cursor += p.width;
    }
  }

  /** Draw wrapped lines from the cursor down, paginating as needed. */
  private drawLines(lines: Line[], x: number, size: number, color: RGB): void {
    const lead = size * LEADING;
    for (const ln of lines) {
      this.ensure(lead);
      this.drawLineAt(ln, x, this.y - size, size, color);
      this.y -= lead;
    }
  }

  /** The branded cover band on page 1. */
  banner(title: string, subtitle: string | undefined, badge: PdfDocumentSpec['badge']): void {
    const t = this.theme;
    this.rect(0, PAGE_H - BANNER_H, PAGE_W, BANNER_H, t.accent);

    let badgeWidth = 0;
    if (badge) {
      const valueBytes = winAnsi(badge.value);
      const labelBytes = winAnsi(badge.label);
      const vw = measureBytes(valueBytes, t.family, 'F2', 16);
      const lw = measureBytes(labelBytes, t.family, 'F1', 7.5);
      badgeWidth = Math.max(vw, lw) + 26;
      const bx = PAGE_W - MARGIN_X - badgeWidth;
      const by = PAGE_H - BANNER_H + 20;
      this.rect(bx, by, badgeWidth, 52, WHITE);
      this.text(bx + 13, by + 34, 7.5, 'F1', t.secondary, labelBytes);
      this.text(bx + 13, by + 12, 16, 'F2', t.accent, valueBytes);
    }

    const titleWidth = CONTENT_W - (badgeWidth ? badgeWidth + 24 : 0);
    let ty = PAGE_H - 44;
    for (const ln of wrap(piecesFor(title, { bold: true }, t.family, SIZE.title), t.family, SIZE.title, titleWidth).slice(0, 2)) {
      this.drawLineAt(ln, MARGIN_X, ty, SIZE.title, WHITE);
      ty -= SIZE.title * 1.2;
    }
    if (subtitle) {
      for (const ln of wrap(piecesFor(subtitle, {}, t.family, SIZE.subtitle), t.family, SIZE.subtitle, titleWidth).slice(0, 2)) {
        this.drawLineAt(ln, MARGIN_X, ty, SIZE.subtitle, WHITE);
        ty -= SIZE.subtitle * 1.3;
      }
    }
    this.y = PAGE_H - BANNER_H - 26;
  }

  heading(level: 1 | 2 | 3, text: string): void {
    const t = this.theme;
    const size = (level === 1 ? SIZE.h1 : level === 2 ? SIZE.h2 : SIZE.h3) * t.scale;
    const color = level === 3 ? t.secondary : t.accent;
    this.ensure(size * 3);
    this.y -= size * 0.7;
    this.drawLines(wrap(piecesFor(text, { bold: true }, t.family, size), t.family, size, CONTENT_W), MARGIN_X, size, color);
    if (level === 1) {
      this.y -= 3;
      this.rule(MARGIN_X, this.y, MARGIN_X + CONTENT_W, this.y, t.rule, 1.2);
    }
    this.y -= size * 0.35;
  }

  paragraph(text: string): void {
    const t = this.theme;
    const size = SIZE.body * t.scale;
    this.drawLines(wrap(runsToPieces(parseInlineRuns(text), t.family, size), t.family, size, CONTENT_W), MARGIN_X, size, t.text);
    this.y -= size * 0.45;
  }

  list(items: string[], ordered: boolean): void {
    const t = this.theme;
    const size = SIZE.body * t.scale;
    const indent = 18;
    items.forEach((item, i) => {
      const marker = ordered ? winAnsi(`${i + 1}.`) : [BULLET];
      const lines = wrap(runsToPieces(parseInlineRuns(item), t.family, size), t.family, size, CONTENT_W - indent);
      this.ensure(size * LEADING);
      this.text(MARGIN_X + 3, this.y - size, size, 'F1', t.secondary, marker);
      this.drawLines(lines, MARGIN_X + indent, size, t.text);
    });
    this.y -= size * 0.5;
  }

  code(text: string): void {
    const t = this.theme;
    const size = SIZE.code;
    const lead = size * 1.35;
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
      .flatMap((raw) => wrap(piecesFor(raw || ' ', { code: true }, t.family, size), t.family, size, CONTENT_W - 20));

    // Draw the panel per page-slice, so a fence spanning a page break keeps its
    // ground on both pages instead of losing it on the second.
    let i = 0;
    let guard = 0;
    while (i < lines.length && guard++ < 400) {
      const available = Math.floor((this.y - MARGIN_BOTTOM - 12) / lead);
      if (available < 1) { this.breakPage(); continue; }
      const slice = lines.slice(i, i + available);
      const height = slice.length * lead + 12;
      this.rect(MARGIN_X, this.y - height, CONTENT_W, height, t.band);
      this.y -= 6;
      for (const ln of slice) {
        this.drawLineAt(ln, MARGIN_X + 10, this.y - size, size, t.text);
        this.y -= lead;
      }
      this.y -= 6;
      i += slice.length;
      if (i < lines.length) this.breakPage();
    }
    this.y -= size * 0.6;
  }

  table(head: string[], rows: string[][]): void {
    const t = this.theme;
    const size = SIZE.cell * t.scale;
    const cols = head.length || rows[0]?.length || 0;
    if (cols === 0) return;

    // Column widths track natural content width, floored so no column collapses.
    const natural = Array.from({ length: cols }, (_, i) => {
      const samples = [head[i] ?? '', ...rows.slice(0, 40).map((r) => r[i] ?? '')];
      return Math.max(...samples.map((s) => measureBytes(winAnsi(s), t.family, 'F1', size))) + 16;
    });
    const min = CONTENT_W / (cols * 3);
    const floored = natural.map((n) => Math.max(min, n));
    const scale = CONTENT_W / floored.reduce((a, b) => a + b, 0);
    const widths = floored.map((w) => w * scale);

    const drawRow = (cells: string[], header: boolean): void => {
      const wrapped = cells.map((cell, i) =>
        wrap(runsToPieces(parseInlineRuns(cell), t.family, size, header ? { bold: true } : undefined), t.family, size, (widths[i] as number) - 12));
      const height = Math.max(...wrapped.map((w) => w.length)) * size * 1.35 + 8;
      this.ensure(height);
      const top = this.y;
      if (header) this.rect(MARGIN_X, top - height, CONTENT_W, height, t.secondary);
      let x = MARGIN_X;
      wrapped.forEach((lines, i) => {
        let ly = top - 4;
        for (const ln of lines) {
          this.drawLineAt(ln, x + 6, ly - size, size, header ? WHITE : t.text);
          ly -= size * 1.35;
        }
        x += widths[i] as number;
      });
      if (!header) this.rule(MARGIN_X, top - height, MARGIN_X + CONTENT_W, top - height, t.rule);
      this.y = top - height;
    };

    if (head.length) drawRow(head, true);
    for (const r of rows) drawRow(Array.from({ length: cols }, (_, i) => r[i] ?? ''), false);
    this.y -= size * 0.8;
  }
}

// ── assembly ─────────────────────────────────────────────────────────────────

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function footerOps(theme: ResolvedTheme, footer: string | undefined, page: number, total: number): string {
  const y = 34;
  const parts: string[] = [`${strokeOp(theme.rule)} 0.6 w ${MARGIN_X} ${y + 14} m ${MARGIN_X + CONTENT_W} ${y + 14} l S`];
  if (footer) {
    parts.push(`BT ${fillOp(theme.muted)} /F1 ${SIZE.foot} Tf 1 0 0 1 ${MARGIN_X} ${y} Tm ${literal(winAnsi(footer))} Tj ET`);
  }
  const bytes = winAnsi(`${page} / ${total}`);
  const w = measureBytes(bytes, theme.family, 'F1', SIZE.foot);
  parts.push(`BT ${fillOp(theme.muted)} /F1 ${SIZE.foot} Tf 1 0 0 1 ${(MARGIN_X + CONTENT_W - w).toFixed(2)} ${y} Tm ${literal(bytes)} Tj ET`);
  return parts.join('\n');
}

/** Render a block document to PDF bytes. */
export function renderPdf(spec: PdfDocumentSpec): Uint8Array {
  const theme = resolveTheme(spec.theme);
  const layout = new PdfLayout(theme);

  if (spec.title) layout.banner(spec.title, spec.subtitle, spec.badge);

  for (const block of spec.blocks) {
    switch (block.kind) {
      case 'heading': layout.heading(block.level, block.text); break;
      case 'paragraph': layout.paragraph(block.text); break;
      case 'list': layout.list(block.items, block.ordered); break;
      case 'table': layout.table(block.head, block.rows); break;
      case 'code': layout.code(block.text); break;
      default: break;
    }
  }

  const laid = layout.finish();
  const pages = laid.filter((ops) => ops.length > 0);
  if (pages.length === 0) pages.push([]);
  const total = pages.length;

  // Fixed object numbering: 1 catalog, 2 pages, 3..8 fonts, then page/content pairs.
  const FONT_BASE = 3;
  const PAGE_BASE = FONT_BASE + PDF_FONT_SLOTS.length;
  const names = fontNamesFor(theme.family);
  const resources = `<< /Font << ${PDF_FONT_SLOTS.map((slot, i) => `/${slot} ${FONT_BASE + i} 0 R`).join(' ')} >> >>`;

  const objects: string[] = [];
  const kids = pages.map((_, i) => `${PAGE_BASE + i * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [ ${kids} ] /Count ${total} >>`);
  for (const slot of PDF_FONT_SLOTS) {
    objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${names[slot]} /Encoding /WinAnsiEncoding >>`);
  }
  pages.forEach((ops, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W.toFixed(2)} ${PAGE_H.toFixed(2)}] /Resources ${resources} /Contents ${PAGE_BASE + i * 2 + 1} 0 R >>`);
    const stream = [...ops, footerOps(theme, spec.footer, i + 1, total)].join('\n');
    objects.push(`<< /Length ${latin1Bytes(stream).length} >>\nstream\n${stream}\nendstream`);
  });

  let body = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return latin1Bytes(body + xref + trailer);
}

/**
 * Parse markdown and render it to PDF bytes. A leading `# Heading` that repeats
 * the cover title is dropped so the title is not printed twice.
 */
export function markdownToPdf(
  markdown: string,
  title?: string,
  theme: PdfTheme = {},
  extra: Omit<PdfDocumentSpec, 'blocks' | 'title' | 'theme'> = {},
): Uint8Array {
  const blocks = parseMarkdownBlocks(markdown);
  const first = blocks[0];
  const trimmed = title && first?.kind === 'heading' && first.text.trim() === title.trim() ? blocks.slice(1) : blocks;
  return renderPdf({ blocks: trimmed, ...(title ? { title } : {}), theme, ...extra });
}
