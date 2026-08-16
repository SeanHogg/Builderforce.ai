/**
 * `.docx` → the markdown every canvas document surface already renders.
 */

import { PAGE_BREAK_MARKER, attribute, decodeXmlText, inlineSafe, openZip } from './container';

export { PAGE_BREAK_MARKER };

/* ----------------------------------------------------------------- DOCX --- */

const HEADING_STYLE = /^(?:heading|berschrift|titre|t[íi]tulo|ttulo)(\d)$/i;

function docxParagraphStyle(paragraph: string): { level: number; list: 'bullet' | 'number' | null; quote: boolean } {
  const style = attribute(/<w:pStyle\b[^>]*\/?>/.exec(paragraph)?.[0] ?? '', 'w:val') ?? '';
  const normalized = style.replace(/[\s_-]/g, '');
  const heading = HEADING_STYLE.exec(normalized);
  const level = heading ? Math.min(6, Number(heading[1])) : /^title$/i.test(normalized) ? 1 : /^subtitle$/i.test(normalized) ? 2 : 0;
  const numbered = /<w:numPr\b/.test(paragraph);
  const list = numbered
    ? /<w:numFmt\b[^>]*w:val="(?:bullet|none)"/.test(paragraph) || /^listparagraph$/i.test(normalized) && !/<w:numId\b[^>]*w:val="[1-9]/.test(paragraph) ? 'bullet' : 'number'
    : null;
  return { level, list, quote: /^(?:quote|intensequote|blockquote)$/i.test(normalized) };
}

const RUN_TOKEN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b([^>]*)\/?>|<w:lastRenderedPageBreak\b[^>]*\/?>/g;

/**
 * A page break belongs on the side of the text it was written on: Word puts a
 * break in its own run, and one written before a paragraph's first word starts
 * that paragraph on a new page while one written after it ends the page there.
 * Collapsing both into "this paragraph had a break" moves the heading of every
 * new section onto the end of the previous page.
 */
type DocxText = { text: string; breakBefore: boolean; breakAfter: boolean };

function docxRunText(scope: string, hadText: boolean): DocxText {
  let text = '';
  let breakBefore = false;
  let breakAfter = false;
  const noteBreak = () => { if (hadText || text.trim()) breakAfter = true; else breakBefore = true; };
  for (const match of scope.matchAll(RUN_TOKEN)) {
    if (match[1] != null) { text += decodeXmlText(match[1]); continue; }
    if (match[0].startsWith('<w:tab')) { text += '\t'; continue; }
    if (match[0].startsWith('<w:lastRenderedPageBreak')) { noteBreak(); continue; }
    if (/w:type="page"/.test(match[2] ?? '')) { noteBreak(); continue; }
    text += '\n';
  }
  return { text, breakBefore, breakAfter };
}

/** Emphasis is read per run so a bolded phrase inside a sentence survives the
 * conversion — losing it turns a specification's normative words into prose. */
function docxParagraphText(paragraph: string): DocxText {
  let text = '';
  let breakBefore = false;
  let breakAfter = false;
  const runs = paragraph.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g);
  let sawRun = false;
  for (const run of runs) {
    sawRun = true;
    const body = run[1]!;
    const properties = /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/.exec(body)?.[0] ?? '';
    const bold = /<w:b(?:\s[^>]*)?\/?>/.test(properties) && !/<w:b\b[^>]*w:val="(?:0|false)"/.test(properties);
    const italic = /<w:i(?:\s[^>]*)?\/?>/.test(properties) && !/<w:i\b[^>]*w:val="(?:0|false)"/.test(properties);
    const run_ = docxRunText(body, !!text.trim());
    breakBefore = breakBefore || run_.breakBefore;
    breakAfter = breakAfter || run_.breakAfter;
    if (!run_.text) continue;
    const trimmed = run_.text.trim();
    const marks = `${bold ? '**' : ''}${italic ? '*' : ''}`;
    text += marks && trimmed
      ? run_.text.replace(trimmed, `${marks}${trimmed}${[...marks].reverse().join('')}`)
      : run_.text;
  }
  return sawRun ? { text, breakBefore, breakAfter } : docxRunText(paragraph, false);
}

function docxTableMarkdown(table: string): string {
  const rows = [...table.matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g)].map((row) =>
    [...row[1]!.matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g)].map((cell) =>
      inlineSafe([...cell[1]!.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((paragraph) => docxParagraphText(paragraph[0]).text).join(' '))));
  if (!rows.length) return '';
  const width = Math.max(...rows.map((row) => row.length));
  if (!width) return '';
  const pad = (row: string[]) => Array.from({ length: width }, (_, index) => row[index] ?? '');
  const [header, ...body] = rows;
  return [
    `| ${pad(header!).join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...body.map((row) => `| ${pad(row).join(' | ')} |`),
  ].join('\n');
}

const DOCX_BLOCK = /<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;

export interface OfficeDocument {
  markdown: string;
  /** Hard page breaks the source declared, so the reader can honour the
   * author's pagination instead of guessing at one. */
  authoredPages: number;
}

/** Convert `word/document.xml` into the markdown every canvas document surface
 * already renders, edits, and exports. */
export function docxXmlToMarkdown(documentXml: string): OfficeDocument {
  const body = /<w:body(?:\s[^>]*)?>([\s\S]*)<\/w:body>/.exec(documentXml)?.[1] ?? documentXml;
  const lines: string[] = [];
  let pending = false;
  let authoredPages = 1;
  for (const match of body.matchAll(DOCX_BLOCK)) {
    const block = match[0];
    if (block.startsWith('<w:tbl')) {
      const table = docxTableMarkdown(block);
      if (table) lines.push(table, '');
      continue;
    }
    const { level, list, quote } = docxParagraphStyle(block);
    const { text, breakBefore, breakAfter } = docxParagraphText(block);
    const content = text.replace(/\s+$/g, '').trim();
    if ((pending || breakBefore) && content) {
      if (lines[lines.length - 1] !== '') lines.push('');
      lines.push(PAGE_BREAK_MARKER, '');
      authoredPages += 1;
      pending = false;
    }
    if (!content) {
      // An empty paragraph carrying only a break defers it to the next page's
      // first line, so the marker never lands after the text it precedes.
      if (breakBefore || breakAfter) pending = true;
      if (lines[lines.length - 1] !== '') lines.push('');
      continue;
    }
    const prefix = level ? `${'#'.repeat(level)} ` : list === 'bullet' ? '- ' : list === 'number' ? '1. ' : quote ? '> ' : '';
    lines.push(`${prefix}${content}`);
    if (level || !list) lines.push('');
    if (breakAfter) pending = true;
  }
  const markdown = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { markdown, authoredPages: markdown.includes(PAGE_BREAK_MARKER) ? authoredPages : 1 };
}

/** Read a `.docx` container into markdown, including the footnote-free body and
 * the document title recorded in its core properties. */
export async function readDocx(bytes: Uint8Array): Promise<(OfficeDocument & { title?: string }) | null> {
  const archive = openZip(bytes);
  const documentXml = await archive?.readText('word/document.xml');
  if (!archive || !documentXml) return null;
  const converted = docxXmlToMarkdown(documentXml);
  if (!converted.markdown) return null;
  const core = await archive.readText('docProps/core.xml');
  const title = core ? decodeXmlText(/<dc:title>([\s\S]*?)<\/dc:title>/.exec(core)?.[1]?.trim() ?? '') : '';
  return { ...converted, ...(title ? { title } : {}) };
}
