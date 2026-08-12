/**
 * markdownToDocx — write a real .docx (Office Open XML) from a Brain Document
 * reply, using fflate (already a dependency, and the same zip library the deck
 * in-place filler uses). No new package, runs in the Worker.
 *
 * A .docx is a zip of three parts: `[Content_Types].xml`, `_rels/.rels`, and
 * `word/document.xml`. Formatting is written as DIRECT run/paragraph properties
 * rather than named styles, so the file needs no `styles.xml` and renders the
 * same in Word, Pages, LibreOffice and Google Docs.
 */

import { zipSync, strToU8 } from 'fflate';
import { parseMarkdownBlocks, parseInlineRuns, type MdBlock, type MdRun } from './markdownBlocks';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

/** Half-point font sizes (Word's `w:sz` unit) per block role. */
const SIZE = { h1: 40, h2: 30, h3: 24, body: 22, code: 20, cell: 20 };

export interface DocxTheme {
  accent?: string;
  font?: 'sans' | 'serif' | 'mono';
  density?: 'compact' | 'comfortable' | 'spacious';
  columns?: 1 | 2;
}

interface ResolvedDocxTheme { accent: string; font: string; scale: number; columns: 1 | 2 }

function resolveTheme(value: DocxTheme = {}): ResolvedDocxTheme {
  const accent = /^#?[0-9a-f]{6}$/i.test(value.accent ?? '') ? (value.accent ?? '').replace('#', '').toUpperCase() : '111827';
  return {
    accent,
    font: value.font === 'serif' ? 'Georgia' : value.font === 'mono' ? 'Consolas' : 'Arial',
    scale: value.density === 'compact' ? .88 : value.density === 'spacious' ? 1.08 : 1,
    columns: value.columns === 2 ? 2 : 1,
  };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function run(r: MdRun, opts: { size: number; color?: string; bold?: boolean }, theme: ResolvedDocxTheme): string {
  const props = [
    r.bold || opts.bold ? '<w:b/>' : '',
    r.italic ? '<w:i/>' : '',
    `<w:rFonts w:ascii="${r.code ? 'Consolas' : theme.font}" w:hAnsi="${r.code ? 'Consolas' : theme.font}"/>`,
    opts.color ? `<w:color w:val="${opts.color}"/>` : '',
    `<w:sz w:val="${opts.size}"/>`,
  ].join('');
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
}

function para(text: string, opts: { size?: number; bold?: boolean; color?: string; indent?: number; before?: number; after?: number }, theme: ResolvedDocxTheme): string {
  const size = Math.round((opts.size ?? SIZE.body) * theme.scale);
  const pPr = [
    `<w:spacing w:before="${opts.before ?? 0}" w:after="${opts.after ?? 120}"/>`,
    opts.indent ? `<w:ind w:left="${opts.indent}"/>` : '',
  ].join('');
  const runs = parseInlineRuns(text).map((r) => run(r, { size, bold: opts.bold, color: opts.color }, theme)).join('');
  return `<w:p><w:pPr>${pPr}</w:pPr>${runs || run({ text: '' }, { size }, theme)}</w:p>`;
}

function cell(text: string, header: boolean, theme: ResolvedDocxTheme): string {
  const shade = header ? `<w:shd w:val="clear" w:fill="${theme.accent}"/>` : '';
  const color = header ? 'FFFFFF' : undefined;
  return `<w:tc><w:tcPr>${shade}</w:tcPr>${para(text, { size: SIZE.cell, bold: header, color, after: 0 }, theme)}</w:tc>`;
}

function table(head: string[], rows: string[][], theme: ResolvedDocxTheme): string {
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((s) => `<w:${s} w:val="single" w:sz="4" w:color="D1D5DB"/>`)
    .join('');
  const trs = [
    `<w:tr>${head.map((h) => cell(h, true, theme)).join('')}</w:tr>`,
    ...rows.map((r) => `<w:tr>${head.map((_, i) => cell(r[i] ?? '', false, theme)).join('')}</w:tr>`),
  ].join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${trs}</w:tbl>`;
}

function blockXml(b: MdBlock, theme: ResolvedDocxTheme): string {
  switch (b.kind) {
    case 'heading': {
      const size = b.level === 1 ? SIZE.h1 : b.level === 2 ? SIZE.h2 : SIZE.h3;
      return para(b.text, { size, bold: true, color: b.level <= 2 ? theme.accent : '111827', before: 240, after: 120 }, theme);
    }
    case 'list':
      return b.items
        .map((item, i) => para(`${b.ordered ? `${i + 1}. ` : '• '}${item}`, { indent: 480, after: 60 }, theme))
        .join('');
    case 'table':
      // Word needs a paragraph after a table or the next block merges into it.
      return `${table(b.head, b.rows, theme)}${para('', { after: 120 }, theme)}`;
    case 'code':
      return b.text
        .split('\n')
        .map((line) => para(line || ' ', { size: SIZE.code, indent: 240, after: 0 }, theme))
        .join('');
    default:
      return para(b.text, {}, theme);
  }
}

/** Render a markdown document as .docx bytes. */
export function markdownToDocx(markdown: string, title?: string, options: DocxTheme = {}): Uint8Array {
  const theme = resolveTheme(options);
  const blocks = parseMarkdownBlocks(markdown);
  // Only add a title heading when the content doesn't already open with one.
  const needsTitle = !!title && blocks[0]?.kind !== 'heading';
  const body = [
    needsTitle ? para(title as string, { size: SIZE.h1, bold: true, color: theme.accent, after: 240 }, theme) : '',
    ...blocks.map((block) => blockXml(block, theme)),
  ].join('');

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>${theme.columns === 2 ? '<w:cols w:num="2" w:space="720"/>' : ''}</w:sectPr></w:body></w:document>`;

  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(document),
  });
}
