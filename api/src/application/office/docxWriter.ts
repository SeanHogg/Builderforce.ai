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

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function run(r: MdRun, opts: { size: number; color?: string; bold?: boolean }): string {
  const props = [
    r.bold || opts.bold ? '<w:b/>' : '',
    r.italic ? '<w:i/>' : '',
    r.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : '',
    opts.color ? `<w:color w:val="${opts.color}"/>` : '',
    `<w:sz w:val="${opts.size}"/>`,
  ].join('');
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
}

function para(text: string, opts: { size?: number; bold?: boolean; color?: string; indent?: number; before?: number; after?: number } = {}): string {
  const size = opts.size ?? SIZE.body;
  const pPr = [
    `<w:spacing w:before="${opts.before ?? 0}" w:after="${opts.after ?? 120}"/>`,
    opts.indent ? `<w:ind w:left="${opts.indent}"/>` : '',
  ].join('');
  const runs = parseInlineRuns(text).map((r) => run(r, { size, bold: opts.bold, color: opts.color })).join('');
  return `<w:p><w:pPr>${pPr}</w:pPr>${runs || run({ text: '' }, { size })}</w:p>`;
}

function cell(text: string, header: boolean): string {
  const shade = header ? '<w:shd w:val="clear" w:fill="4F46E5"/>' : '';
  const color = header ? 'FFFFFF' : undefined;
  return `<w:tc><w:tcPr>${shade}</w:tcPr>${para(text, { size: SIZE.cell, bold: header, color, after: 0 })}</w:tc>`;
}

function table(head: string[], rows: string[][]): string {
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((s) => `<w:${s} w:val="single" w:sz="4" w:color="D1D5DB"/>`)
    .join('');
  const trs = [
    `<w:tr>${head.map((h) => cell(h, true)).join('')}</w:tr>`,
    ...rows.map((r) => `<w:tr>${head.map((_, i) => cell(r[i] ?? '', false)).join('')}</w:tr>`),
  ].join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${trs}</w:tbl>`;
}

function blockXml(b: MdBlock): string {
  switch (b.kind) {
    case 'heading': {
      const size = b.level === 1 ? SIZE.h1 : b.level === 2 ? SIZE.h2 : SIZE.h3;
      return para(b.text, { size, bold: true, color: '111827', before: 240, after: 120 });
    }
    case 'list':
      return b.items
        .map((item, i) => para(`${b.ordered ? `${i + 1}. ` : '• '}${item}`, { indent: 480, after: 60 }))
        .join('');
    case 'table':
      // Word needs a paragraph after a table or the next block merges into it.
      return `${table(b.head, b.rows)}${para('', { after: 120 })}`;
    case 'code':
      return b.text
        .split('\n')
        .map((line) => para(line || ' ', { size: SIZE.code, indent: 240, after: 0 }))
        .join('');
    default:
      return para(b.text);
  }
}

/** Render a markdown document as .docx bytes. */
export function markdownToDocx(markdown: string, title?: string): Uint8Array {
  const blocks = parseMarkdownBlocks(markdown);
  // Only add a title heading when the content doesn't already open with one.
  const needsTitle = !!title && blocks[0]?.kind !== 'heading';
  const body = [
    needsTitle ? para(title as string, { size: SIZE.h1, bold: true, color: '111827', after: 240 }) : '',
    ...blocks.map(blockXml),
  ].join('');

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(document),
  });
}
