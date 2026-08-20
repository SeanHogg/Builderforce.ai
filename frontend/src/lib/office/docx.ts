/**
 * `.docx` → the markdown every canvas document surface already renders.
 *
 * ── WHAT A DROPPED WORD FILE IS MADE OF ─────────────────────────────────────
 * `word/document.xml` is only the body. A real report also carries its figures
 * (`w:drawing` → a relationship → `word/media/*`), its footnotes and endnotes
 * (`word/footnotes.xml`, `word/endnotes.xml`) and its page furniture
 * (`word/headerN.xml`, `word/footerN.xml`). Reading the body alone dropped every
 * one of them, so an imported report arrived without its own charts and without
 * the notes its clauses referred to.
 *
 * The conversion stays PURE — strings in, markdown out — and everything that
 * needs the archive, the network or an upload happens at the edge in
 * {@link readDocx}. Media is uploaded and referenced BY URL rather than inlined
 * as base64: node data is re-serialised into the local-session snapshot on every
 * viewport change, and a couple of embedded charts would put megabytes through
 * that loop on every pan.
 */

import { PAGE_BREAK_MARKER, attribute, decodeXmlText, inlineSafe, openZip, type ZipArchive } from './container';

export { PAGE_BREAK_MARKER };

/**
 * Marker before the block a converted document appends for the parts that have
 * no place in the body — footnote and endnote definitions, and the page headers
 * and footers.
 *
 * Load-bearing in two directions. Forwards it DELIMITS: a reader can see where
 * the document ends and the material lifted out of its other parts begins,
 * instead of finding a stray "Page 3 of 12" welded onto the last paragraph.
 * Backwards it EXCLUDES: a round-trip export writes the edited body back into
 * the source package, which still holds its own `footnotes.xml` and
 * `headerN.xml`, so everything from this marker on must NOT be written into
 * `word/document.xml` a second time. The write-back spells the same string —
 * see `api/src/application/office/docxSourceWriter.ts`, which cannot import
 * this module because it runs in the Worker.
 */
export const DOCX_EXTRAS_MARKER = '<!--docx-extras-->';

/**
 * Query parameter pinning an imported image back to the relationship id it came
 * from in the source package.
 *
 * A round-trip export re-embeds the ORIGINAL `w:drawing` — the sizing, the
 * cropping, the anchor — rather than a re-fetch of the URL, and matching the two
 * by position breaks the moment somebody deletes a figure. The id travels in the
 * URL because the URL is the one part of an image that survives every edit the
 * markdown goes through and renders nowhere. Same parity note as the marker
 * above: `docxSourceWriter.ts` spells it too.
 */
export const DOCX_RELATIONSHIP_PARAM = 'docx-rel';

/** Attach {@link DOCX_RELATIONSHIP_PARAM} to an uploaded image's URL. */
export function withDocxRelationship(url: string, relationshipId: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${DOCX_RELATIONSHIP_PARAM}=${encodeURIComponent(relationshipId)}`;
}

/* ----------------------------------------------------------------- DOCX --- */

const HEADING_STYLE = /^(?:heading|berschrift|titre|t[íi]tulo|ttulo)(\d)$/i;

/** Labels for the appended section that carries the source's page furniture.
 * Passed in by the importer so they arrive translated — this module never
 * decides what language a person reads. */
export interface DocxExtrasLabels {
  /** Heading over the whole page-furniture section. */
  pageFurniture: string;
  header: string;
  footer: string;
}

const DEFAULT_LABELS: DocxExtrasLabels = {
  pageFurniture: 'Page headers and footers',
  header: 'Header',
  footer: 'Footer',
};

/**
 * What the converter needs from OUTSIDE `word/document.xml`.
 *
 * Resolved by the caller so the conversion has no archive in it: `images` maps a
 * relationship id to the URL the caller already uploaded that part to, and the
 * note/furniture parts arrive as the verbatim XML they are stored as.
 */
export interface DocxConversionParts {
  images?: Readonly<Record<string, string>>;
  footnotesXml?: string;
  endnotesXml?: string;
  headerXml?: readonly string[];
  footerXml?: readonly string[];
  labels?: Partial<DocxExtrasLabels>;
}

/** Resolved conversion context, threaded through the run readers. */
interface DocxContext {
  images: Readonly<Record<string, string>>;
  /** Note references become markdown footnote marks only in the BODY; inside a
   * note's own text a reference is the note's own back-link, not a new mark. */
  notes: boolean;
}

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

/**
 * Every token a run can carry that becomes text.
 *
 * `w:drawing`, `w:footnoteReference` and `w:endnoteReference` are matched as
 * whole alternatives — none of them captures a group, so the two existing group
 * indices (the `w:t` body and the `w:br` attributes) are unchanged.
 */
const RUN_TOKEN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:drawing\b[\s\S]*?<\/w:drawing>|<w:footnoteReference\b[^>]*\/?>|<w:endnoteReference\b[^>]*\/?>|<w:tab\b[^>]*\/?>|<w:br\b([^>]*)\/?>|<w:lastRenderedPageBreak\b[^>]*\/?>/g;

/**
 * A figure, as the markdown image every document surface already renders.
 *
 * An image whose part the caller could not upload produces NOTHING rather than a
 * broken link or a base64 blob: the alt text alone is not the figure, and a data
 * URL is the cost this whole path exists to avoid.
 */
function drawingMarkdown(drawing: string, context: DocxContext): string {
  const blip = /<a:blip\b[^>]*>/.exec(drawing)?.[0] ?? '';
  const id = attribute(blip, 'r:embed') ?? attribute(blip, 'r:link');
  const url = id ? context.images[id] : undefined;
  if (!url) return '';
  const docPr = /<wp:docPr\b[^>]*\/?>/.exec(drawing)?.[0] ?? '';
  const alt = inlineSafe(attribute(docPr, 'descr') || attribute(docPr, 'name') || '');
  return `![${alt.replace(/[[\]]/g, '')}](${url})`;
}

/** The markdown footnote mark for a `w:footnoteReference` / `w:endnoteReference`.
 * Word's own id is kept rather than renumbered, so the mark and the definition
 * agree without the converter having to track document order. */
function noteMark(token: string, prefix: 'fn' | 'en'): string {
  const id = attribute(token, 'w:id');
  return id ? `[^${prefix}${id}]` : '';
}

/**
 * A page break belongs on the side of the text it was written on: Word puts a
 * break in its own run, and one written before a paragraph's first word starts
 * that paragraph on a new page while one written after it ends the page there.
 * Collapsing both into "this paragraph had a break" moves the heading of every
 * new section onto the end of the previous page.
 */
type DocxText = { text: string; breakBefore: boolean; breakAfter: boolean };

function docxRunText(scope: string, hadText: boolean, context: DocxContext): DocxText {
  let text = '';
  let breakBefore = false;
  let breakAfter = false;
  const noteBreak = () => { if (hadText || text.trim()) breakAfter = true; else breakBefore = true; };
  for (const match of scope.matchAll(RUN_TOKEN)) {
    if (match[1] != null) { text += decodeXmlText(match[1]); continue; }
    const token = match[0];
    if (token.startsWith('<w:drawing')) { text += drawingMarkdown(token, context); continue; }
    if (token.startsWith('<w:footnoteReference')) { if (context.notes) text += noteMark(token, 'fn'); continue; }
    if (token.startsWith('<w:endnoteReference')) { if (context.notes) text += noteMark(token, 'en'); continue; }
    if (token.startsWith('<w:tab')) { text += '\t'; continue; }
    if (token.startsWith('<w:lastRenderedPageBreak')) { noteBreak(); continue; }
    if (/w:type="page"/.test(match[2] ?? '')) { noteBreak(); continue; }
    text += '\n';
  }
  return { text, breakBefore, breakAfter };
}

/** Emphasis is read per run so a bolded phrase inside a sentence survives the
 * conversion — losing it turns a specification's normative words into prose. */
function docxParagraphText(paragraph: string, context: DocxContext): DocxText {
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
    const run_ = docxRunText(body, !!text.trim(), context);
    breakBefore = breakBefore || run_.breakBefore;
    breakAfter = breakAfter || run_.breakAfter;
    if (!run_.text) continue;
    const trimmed = run_.text.trim();
    const marks = `${bold ? '**' : ''}${italic ? '*' : ''}`;
    text += marks && trimmed
      ? run_.text.replace(trimmed, `${marks}${trimmed}${[...marks].reverse().join('')}`)
      : run_.text;
  }
  return sawRun ? { text, breakBefore, breakAfter } : docxRunText(paragraph, false, context);
}

function docxTableMarkdown(table: string, context: DocxContext): string {
  const rows = [...table.matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g)].map((row) =>
    [...row[1]!.matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g)].map((cell) =>
      inlineSafe([...cell[1]!.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((paragraph) => docxParagraphText(paragraph[0], context).text).join(' '))));
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

/** The paragraphs of a part that is not the body — a note, a header, a footer —
 * flattened to one line each. These are captions and running heads, not
 * structure, so they carry no headings or lists of their own. */
function partLines(xml: string, context: DocxContext): string[] {
  return [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)]
    .map((paragraph) => inlineSafe(docxParagraphText(paragraph[0], context).text))
    .filter(Boolean);
}

const NOTE_ELEMENT = /<w:(footnote|endnote)(?:\s[^>]*)?>([\s\S]*?)<\/w:\1>/g;

/**
 * Real notes, as markdown footnote definitions.
 *
 * Word stores its separator and continuation-separator rules as notes with ids
 * 0 and -1 and a `w:type`; only a note with no type (or `normal`) is something
 * an author wrote. EVERY such note is emitted, not only the ones the body was
 * seen to reference — a definition with no mark is visible, a note silently
 * dropped is not.
 */
function noteDefinitions(xml: string, prefix: 'fn' | 'en', context: DocxContext): string[] {
  const definitions: string[] = [];
  for (const match of xml.matchAll(NOTE_ELEMENT)) {
    const open = /<w:(?:footnote|endnote)(?:\s[^>]*)?>/.exec(match[0])?.[0] ?? '';
    const type = attribute(open, 'w:type');
    if (type && type !== 'normal') continue;
    const id = attribute(open, 'w:id');
    if (!id) continue;
    const text = partLines(match[2]!, context).join(' ');
    if (!text) continue;
    definitions.push(`[^${prefix}${id}]: ${text}`);
  }
  return definitions;
}

export interface OfficeDocument {
  markdown: string;
  /** Hard page breaks the source declared, so the reader can honour the
   * author's pagination instead of guessing at one. */
  authoredPages: number;
}

/**
 * Everything that is in the package but not in the body, as one delimited block.
 *
 * Appended rather than interleaved because none of it has a place in the reading
 * order: a running head repeats on every page and a footnote lives at the foot
 * of the page its mark is on, neither of which a single markdown stream has.
 */
function extrasMarkdown(parts: DocxConversionParts, context: DocxContext): string {
  const labels = { ...DEFAULT_LABELS, ...parts.labels };
  const notes = [
    ...noteDefinitions(parts.footnotesXml ?? '', 'fn', { ...context, notes: false }),
    ...noteDefinitions(parts.endnotesXml ?? '', 'en', { ...context, notes: false }),
  ];
  const furniture = [
    ...(parts.headerXml ?? []).flatMap((xml) => partLines(xml, context).map((line) => `**${labels.header}** — ${line}`)),
    ...(parts.footerXml ?? []).flatMap((xml) => partLines(xml, context).map((line) => `**${labels.footer}** — ${line}`)),
  ];
  if (!notes.length && !furniture.length) return '';
  return [
    DOCX_EXTRAS_MARKER,
    '',
    ...(notes.length ? [notes.join('\n\n'), ''] : []),
    ...(furniture.length ? [`## ${labels.pageFurniture}`, '', furniture.join('\n\n')] : []),
  ].join('\n').trimEnd();
}

/** Convert `word/document.xml` into the markdown every canvas document surface
 * already renders, edits, and exports. */
export function docxXmlToMarkdown(documentXml: string, parts: DocxConversionParts = {}): OfficeDocument {
  const context: DocxContext = { images: parts.images ?? {}, notes: true };
  const body = /<w:body(?:\s[^>]*)?>([\s\S]*)<\/w:body>/.exec(documentXml)?.[1] ?? documentXml;
  const lines: string[] = [];
  let pending = false;
  let authoredPages = 1;
  for (const match of body.matchAll(DOCX_BLOCK)) {
    const block = match[0];
    if (block.startsWith('<w:tbl')) {
      const table = docxTableMarkdown(block, context);
      if (table) lines.push(table, '');
      continue;
    }
    const { level, list, quote } = docxParagraphStyle(block);
    const { text, breakBefore, breakAfter } = docxParagraphText(block, context);
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
  const written = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const extras = extrasMarkdown(parts, context);
  const markdown = extras ? `${written}\n\n${extras}`.trim() : written;
  return { markdown, authoredPages: written.includes(PAGE_BREAK_MARKER) ? authoredPages : 1 };
}

/* -------------------------------------------------------- the container --- */

/**
 * Where an extracted image part goes. Returning a URL puts a real figure in the
 * markdown; returning `null` drops it, which is the honest outcome for a format
 * nothing can render and far better than the alternative this seam exists to
 * prevent — a base64 data URL of a chart living in canvas node data.
 */
export type DocxMediaUploader = (file: File) => Promise<string | null>;

export interface ReadDocxOptions {
  uploadMedia?: DocxMediaUploader;
  labels?: Partial<DocxExtrasLabels>;
}

/** Raster formats a canvas can actually show. EMF and WMF — Word's vector
 * fallbacks — are deliberately absent: no browser renders either, so uploading
 * one would spend a round-trip to produce a broken image. */
const MEDIA_MIME: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
};

/** Ceilings on the media walk. A document with a thousand icons must not turn a
 * drop into a thousand uploads, and one 30MB scan is not a figure. */
const MAX_MEDIA_PARTS = 40;
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

async function documentRelationships(archive: ZipArchive): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const xml = await archive.readText('word/_rels/document.xml.rels');
  if (!xml) return map;
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = attribute(match[0], 'Id');
    const target = attribute(match[0], 'Target');
    if (id && target) map[id] = target;
  }
  return map;
}

/** The archive member a relationship target names. Targets are written relative
 * to `word/`, occasionally with `../` or a leading slash. */
export function docxPartPath(target: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  const cleaned = target.replace(/^\/+/, '');
  if (cleaned.startsWith('word/')) return cleaned;
  const segments = ['word'];
  for (const segment of cleaned.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { segments.pop(); continue; }
    segments.push(segment);
  }
  return segments.length > 1 ? segments.join('/') : null;
}

/** Upload every figure the body references and hand back the relationship→URL
 * map the pure converter reads. The ONLY place in this module that touches the
 * network. */
async function uploadDocumentMedia(
  archive: ZipArchive,
  documentXml: string,
  relationships: Record<string, string>,
  upload: DocxMediaUploader,
): Promise<Record<string, string>> {
  const ids = [...new Set([...documentXml.matchAll(/<a:blip\b[^>]*>/g)]
    .map((match) => attribute(match[0], 'r:embed') ?? attribute(match[0], 'r:link'))
    .filter((id): id is string => !!id))].slice(0, MAX_MEDIA_PARTS);
  const urls: Record<string, string> = {};
  for (const id of ids) {
    const target = relationships[id];
    const path = target ? docxPartPath(target) : null;
    if (!path) continue;
    const mimeType = MEDIA_MIME[(path.split('.').pop() ?? '').toLowerCase()];
    if (!mimeType) continue;
    const raw = await archive.read(path);
    if (!raw?.length || raw.length > MAX_MEDIA_BYTES) continue;
    const name = path.split('/').pop() || 'image';
    const url = await upload(new File([raw as unknown as BlobPart], name, { type: mimeType })).catch(() => null);
    if (url) urls[id] = withDocxRelationship(url, id);
  }
  return urls;
}

const HEADER_PART = /^word\/header\d*\.xml$/;
const FOOTER_PART = /^word\/footer\d*\.xml$/;

async function readParts(archive: ZipArchive, matcher: RegExp): Promise<string[]> {
  const names = archive.names.filter((name) => matcher.test(name)).sort();
  const parts = await Promise.all(names.map((name) => archive.readText(name)));
  return parts.filter((part): part is string => !!part);
}

/**
 * Read a `.docx` container into markdown — the body, its figures, its notes, and
 * its page furniture — plus the document title recorded in its core properties.
 */
export async function readDocx(bytes: Uint8Array, options: ReadDocxOptions = {}): Promise<(OfficeDocument & { title?: string }) | null> {
  const archive = openZip(bytes);
  const documentXml = await archive?.readText('word/document.xml');
  if (!archive || !documentXml) return null;
  const images = options.uploadMedia && /<a:blip\b/.test(documentXml)
    ? await uploadDocumentMedia(archive, documentXml, await documentRelationships(archive), options.uploadMedia)
    : {};
  const converted = docxXmlToMarkdown(documentXml, {
    images,
    footnotesXml: await archive.readText('word/footnotes.xml') ?? '',
    endnotesXml: await archive.readText('word/endnotes.xml') ?? '',
    headerXml: await readParts(archive, HEADER_PART),
    footerXml: await readParts(archive, FOOTER_PART),
    ...(options.labels ? { labels: options.labels } : {}),
  });
  if (!converted.markdown) return null;
  const core = await archive.readText('docProps/core.xml');
  const title = core ? decodeXmlText(/<dc:title>([\s\S]*?)<\/dc:title>/.exec(core)?.[1]?.trim() ?? '') : '';
  return { ...converted, ...(title ? { title } : {}) };
}
