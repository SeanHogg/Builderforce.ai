/**
 * markdownIntoDocxSource — write edited content back into the .docx it came FROM.
 *
 * ── THE ROUND-TRIP THAT WASN'T ──────────────────────────────────────────────
 * A Word file dropped on the canvas becomes a `document` object holding
 * markdown, and "Download Word" handed that markdown to {@link markdownToDocx},
 * which builds a brand-new three-part package. The bytes that came back were a
 * Builderforce-styled document: the source's theme, its fonts, its numbering
 * definitions, its headers and footers, its page size and margins — everything
 * that made it THEIR document — were gone. "Update this Word doc with new
 * information" returned a different document that happened to contain the same
 * sentences.
 *
 * This is the other path. The source package is kept whole and only the ONE part
 * that changed is rewritten:
 *
 *   • `word/document.xml` — its body content is replaced, and its `w:sectPr`
 *     (page size, margins, columns, and the header/footer references) is carried
 *     across verbatim, so the section layout is the source's own.
 *   • Every other member is copied byte for byte: `styles.xml`, `theme/*`,
 *     `numbering.xml`, `settings.xml`, `fontTable.xml`, `header*.xml`,
 *     `footer*.xml`, `footnotes.xml`, `endnotes.xml`, `media/*`, and the
 *     relationship parts that bind them.
 *
 * Paragraphs are written against the source's NAMED STYLES (`Heading1`,
 * `ListParagraph`, `Quote`) rather than with direct run formatting, because a
 * named style is what makes the new text inherit the source's typography. Where
 * the source declares no such style the paragraph falls back to plain body text
 * — still in the source's `Normal` style, still its font, just unpromoted.
 *
 * ── WHAT IS *NOT* REWRITTEN ─────────────────────────────────────────────────
 * The converted markdown ends with a delimited block carrying the footnote and
 * endnote definitions and the page headers and footers, because those parts have
 * no place in a single reading order (see `frontend/src/lib/office/docx.ts`).
 * The source package still holds every one of them, so that block is stripped
 * before the body is written — writing it back would duplicate every footnote
 * into the body text.
 *
 * ── PARITY ──────────────────────────────────────────────────────────────────
 * {@link DOCX_EXTRAS_MARKER} and {@link DOCX_RELATIONSHIP_PARAM} are spelled in
 * `frontend/src/lib/office/docx.ts` too. The two runtimes cannot share a module
 * (the reader needs `DecompressionStream` in a browser, this needs the Worker's
 * fflate), which is the same split `workspaceStore.ts` documents for its content
 * guard — so each side states the contract and names the other.
 */

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { parseMarkdownBlocks, parseInlineRuns, type MdBlock, type MdRun } from './markdownBlocks';

/** Delimiter before the footnote/header/footer block a conversion appends. */
export const DOCX_EXTRAS_MARKER = '<!--docx-extras-->';
/** Marker a conversion writes where the source declared a hard page break. */
export const DOCX_PAGE_BREAK_MARKER = '<!--page-break-->';
/** Query parameter pinning an imported image URL to its source relationship id. */
export const DOCX_RELATIONSHIP_PARAM = 'docx-rel';

/** A source package the writer cannot use — no body part, or not a zip at all.
 *  Typed so the route can fall back to a regenerated document rather than
 *  failing a download the person is entitled to either way. */
export class DocxSourceUnusableError extends Error {
  constructor(message = 'The source document could not be opened.') {
    super(message);
    this.name = 'DocxSourceUnusableError';
  }
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ------------------------------------------------------- source scanning --- */

/** Paragraph style ids the source actually declares, so a heading is promoted
 *  only when there is a style to promote it to. */
function declaredStyles(stylesXml: string): Set<string> {
  const ids = new Set<string>();
  for (const match of stylesXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>/g)) ids.add(match[1]!);
  return ids;
}

/**
 * The source's own list definitions, split by what their first level looks like.
 *
 * A `w:numId` is only meaningful inside the package that declares it, so an
 * imported list has to be re-attached to a real definition or Word renders it
 * as unnumbered body text. The bullet/ordered split comes from the abstract
 * definition's level-0 `w:numFmt`, which is the same signal the reader uses.
 */
export function sourceNumbering(numberingXml: string): { bullet: string | null; ordered: string | null } {
  const formats = new Map<string, string>();
  for (const match of numberingXml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="([^"]+)"[\s\S]*?<\/w:abstractNum>/g)) {
    const format = /<w:numFmt\b[^>]*w:val="([^"]+)"/.exec(match[0])?.[1] ?? '';
    if (format) formats.set(match[1]!, format);
  }
  let bullet: string | null = null;
  let ordered: string | null = null;
  for (const match of numberingXml.matchAll(/<w:num\b[^>]*w:numId="([^"]+)"[\s\S]*?<\/w:num>/g)) {
    const abstractId = /<w:abstractNumId\b[^>]*w:val="([^"]+)"/.exec(match[0])?.[1] ?? '';
    const format = formats.get(abstractId);
    if (!format) continue;
    if (format === 'bullet') bullet ??= match[1]!;
    else ordered ??= match[1]!;
  }
  return { bullet, ordered };
}

/** Every `w:drawing` in the source body, keyed by the relationship its picture
 *  embeds — so an image that survived the edit is re-embedded exactly as the
 *  author placed it, at its own size and anchoring. */
export function sourceDrawings(documentXml: string): Map<string, string> {
  const drawings = new Map<string, string>();
  for (const match of documentXml.matchAll(/<w:drawing\b[\s\S]*?<\/w:drawing>/g)) {
    const id = /<a:blip\b[^>]*\br:(?:embed|link)="([^"]+)"/.exec(match[0])?.[1];
    if (id && !drawings.has(id)) drawings.set(id, match[0]);
  }
  return drawings;
}

/** The body-level section properties: page size, margins, columns, and the
 *  references binding this section to its headers and footers. */
function sourceSectPr(bodyXml: string): string {
  const all = [...bodyXml.matchAll(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>|<w:sectPr\b[^>]*\/>/g)];
  return all.length ? all[all.length - 1]![0] : '';
}

/* -------------------------------------------------------- body authoring --- */

interface SourceProfile {
  styles: Set<string>;
  numbering: { bullet: string | null; ordered: string | null };
  drawings: Map<string, string>;
}

const HEADING_STYLE = ['Heading1', 'Heading2', 'Heading3'] as const;

function styleFor(profile: SourceProfile, id: string): string {
  return profile.styles.has(id) ? `<w:pStyle w:val="${id}"/>` : '';
}

/** An inline run, formatted only where the markdown said so. No fonts, no sizes,
 *  no colours: everything else is inherited from the source's own styles, which
 *  is the entire point of writing back into this package. */
function runXml(run: MdRun): string {
  const properties = [
    run.bold ? '<w:b/>' : '',
    run.italic ? '<w:i/>' : '',
    run.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : '',
  ].join('');
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(run.text)}</w:t></w:r>`;
}

const IMAGE = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
const NOTE_MARK = /\[\^(fn|en)(-?\d+)\]/g;

/** The relationship id an imported image URL was pinned to, if it still is one
 *  of the source's own figures. */
function relationshipOf(url: string): string | null {
  const match = new RegExp(`[?&]${DOCX_RELATIONSHIP_PARAM}=([^&]+)`).exec(url);
  return match ? decodeURIComponent(match[1]!) : null;
}

/**
 * One paragraph's inline content: text runs, the figures that are still in it,
 * and the footnote marks that point back into the package's own notes.
 */
function inlineXml(text: string, profile: SourceProfile): string {
  let out = '';
  let cursor = 0;
  // Images first: they are block-ish and must not be split by the emphasis pass.
  for (const match of text.matchAll(IMAGE)) {
    const drawing = profile.drawings.get(relationshipOf(match[1]!) ?? '');
    out += textXml(text.slice(cursor, match.index), profile);
    if (drawing) out += `<w:r>${drawing}</w:r>`;
    cursor = match.index + match[0].length;
  }
  out += textXml(text.slice(cursor), profile);
  return out;
}

/** Text with its emphasis and its footnote marks, in document order. */
function textXml(text: string, profile: SourceProfile): string {
  if (!text) return '';
  let out = '';
  let cursor = 0;
  for (const match of text.matchAll(NOTE_MARK)) {
    out += parseInlineRuns(text.slice(cursor, match.index)).map(runXml).join('');
    // `w:id` is Word's own id, kept by the reader precisely so a mark can find
    // its way home. `FootnoteReference` is the character style Word applies to
    // the superscript digit; absent from the source, the digit is plain.
    const element = match[1] === 'fn' ? 'w:footnoteReference' : 'w:endnoteReference';
    const style = profile.styles.has('FootnoteReference') ? '<w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>' : '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>';
    out += `<w:r>${style}<${element} w:id="${esc(match[2]!)}"/></w:r>`;
    cursor = match.index + match[0].length;
  }
  out += parseInlineRuns(text.slice(cursor)).map(runXml).join('');
  return out;
}

function paragraphXml(text: string, profile: SourceProfile, properties = ''): string {
  const runs = inlineXml(text, profile);
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${runs}</w:p>`;
}

function listParagraph(item: string, ordered: boolean, profile: SourceProfile): string {
  const numId = ordered ? profile.numbering.ordered : profile.numbering.bullet;
  if (!numId) {
    // No definition to attach to — the marker is written literally rather than
    // producing a list that renders as unmarked body text.
    return paragraphXml(`${ordered ? '' : '• '}${item}`, profile, styleFor(profile, 'ListParagraph'));
  }
  return paragraphXml(item, profile, `${styleFor(profile, 'ListParagraph')}<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${esc(numId)}"/></w:numPr>`);
}

function tableXml(head: string[], rows: string[][], profile: SourceProfile): string {
  const style = profile.styles.has('TableGrid')
    ? '<w:tblStyle w:val="TableGrid"/>'
    : `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((side) => `<w:${side} w:val="single" w:sz="4" w:color="D1D5DB"/>`).join('')}</w:tblBorders>`;
  const cell = (text: string, header: boolean) =>
    `<w:tc><w:tcPr/>${paragraphXml(header ? `**${text}**` : text, profile)}</w:tc>`;
  const trs = [
    `<w:tr>${head.map((value) => cell(value, true)).join('')}</w:tr>`,
    ...rows.map((row) => `<w:tr>${head.map((_, index) => cell(row[index] ?? '', false)).join('')}</w:tr>`),
  ].join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${style}</w:tblPr>${trs}`
    // Word merges the block after a table into it without a separating paragraph.
    + `</w:tbl><w:p/>`;
}

function blockXml(block: MdBlock, profile: SourceProfile): string {
  switch (block.kind) {
    case 'heading':
      return paragraphXml(block.text, profile, styleFor(profile, HEADING_STYLE[block.level - 1] ?? 'Heading3'));
    case 'list':
      return block.items.map((item) => listParagraph(item, block.ordered, profile)).join('');
    case 'table':
      return tableXml(block.head, block.rows, profile);
    case 'code':
      return block.text.split('\n')
        .map((line) => paragraphXml(`\`${line || ' '}\``, profile, styleFor(profile, 'HTMLPreformatted')))
        .join('');
    default:
      return paragraphXml(block.text, profile);
  }
}

/**
 * The markdown that belongs in the BODY.
 *
 * Everything from {@link DOCX_EXTRAS_MARKER} on lives in parts the source
 * package still carries untouched, so writing it into the body would print
 * every footnote and every running head twice.
 */
export function bodyMarkdown(markdown: string): string {
  const cut = markdown.indexOf(DOCX_EXTRAS_MARKER);
  return (cut >= 0 ? markdown.slice(0, cut) : markdown).trimEnd();
}

const PAGE_BREAK_PARAGRAPH = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/* ----------------------------------------------------------------- write --- */

/**
 * Write `markdown` into `source`'s `word/document.xml` and return the package.
 *
 * Throws {@link DocxSourceUnusableError} when the bytes are not a readable Word
 * package, so the caller can regenerate instead — an export must always end with
 * a file in the person's hands.
 */
export function markdownIntoDocxSource(source: Uint8Array, markdown: string, title?: string): Uint8Array {
  let members: Record<string, Uint8Array>;
  try {
    members = unzipSync(source);
  } catch (error) {
    throw new DocxSourceUnusableError(error instanceof Error ? error.message : undefined);
  }
  const documentPart = members['word/document.xml'];
  if (!documentPart) throw new DocxSourceUnusableError('The package has no word/document.xml.');
  const documentXml = strFromU8(documentPart);
  const bodyMatch = /<w:body(?:\s[^>]*)?>([\s\S]*)<\/w:body>/.exec(documentXml);
  if (!bodyMatch) throw new DocxSourceUnusableError('The document part has no body.');

  const profile: SourceProfile = {
    styles: declaredStyles(members['word/styles.xml'] ? strFromU8(members['word/styles.xml']) : ''),
    numbering: sourceNumbering(members['word/numbering.xml'] ? strFromU8(members['word/numbering.xml']) : ''),
    drawings: sourceDrawings(documentXml),
  };

  // A page the source declared is a page the export keeps: the marker is canvas
  // structure, so it becomes a real `w:br` rather than being printed as text.
  const pages = bodyMarkdown(markdown).split(DOCX_PAGE_BREAK_MARKER).map((page) => parseMarkdownBlocks(page.trim()));
  const written = pages
    .map((blocks) => blocks.map((block) => blockXml(block, profile)).join(''))
    .join(PAGE_BREAK_PARAGRAPH);
  // Only add a title heading when the content does not already open with one —
  // the same rule the regenerating writer follows, so the two paths cannot
  // disagree about whether a document gets a second title.
  const heading = title && pages[0]?.[0]?.kind !== 'heading'
    ? paragraphXml(title, profile, styleFor(profile, 'Title') || styleFor(profile, 'Heading1'))
    : '';

  const rewritten = documentXml.slice(0, bodyMatch.index + bodyMatch[0].indexOf('>') + 1)
    + heading + written + sourceSectPr(bodyMatch[1]!)
    + documentXml.slice(bodyMatch.index + bodyMatch[0].length - '</w:body>'.length);

  members['word/document.xml'] = strToU8(rewritten);
  return zipSync(members);
}
