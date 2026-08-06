/**
 * Readers for the file formats people actually drop on a canvas.
 *
 * A Word document, a workbook, a deck, or a PDF that lands on the board has to
 * arrive as *content* — pages, sheets, slides, text — not as an opaque
 * attachment with a file icon. These readers turn each container into the
 * shared canvas shapes (markdown, tabular sources, slides) so the object that
 * appears is one the canvas can already render, edit, query, and export.
 *
 * Everything here runs on platform primitives — `DecompressionStream` for the
 * ZIP members of OOXML and for PDF Flate streams — so a dropped file is read in
 * the browser with no parser dependency and no upload round-trip.
 */

const utf8 = new TextDecoder();
/** One character per byte, so string offsets equal byte offsets when scanning a
 * binary container such as PDF for its structural keywords. */
const latin1 = new TextDecoder('latin1');

/** Ceiling for in-browser parsing. Past this a file is kept as an attachment
 * rather than blocking the tab on a parse that will not finish usefully. */
export const MAX_PARSEABLE_BYTES = 48 * 1024 * 1024;

/* ------------------------------------------------------------------ ZIP --- */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const STORED = 0;
const DEFLATED = 8;

type ZipEntry = { method: number; localOffset: number; compressedSize: number };

export interface ZipArchive {
  /** Every member path in the archive, in central-directory order. */
  names: string[];
  read(name: string): Promise<Uint8Array | null>;
  readText(name: string): Promise<string | null>;
}

async function inflate(raw: Uint8Array, format: 'deflate-raw' | 'deflate'): Promise<Uint8Array> {
  const source = new Response(raw as unknown as BodyInit).body;
  if (!source) return raw;
  const stream = source.pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Open a ZIP container without inflating it.
 *
 * Members are decompressed on demand: a workbook can carry dozens of sheets and
 * a deck dozens of slides, and inflating parts nobody reads is the difference
 * between a card appearing at once and the tab stalling on a drop.
 */
export function openZip(bytes: Uint8Array): ZipArchive | null {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);

  let eocd = -1;
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  for (let index = bytes.length - 22; index >= floor; index -= 1) {
    if (u32(index) === EOCD_SIGNATURE) { eocd = index; break; }
  }
  if (eocd < 0) return null;

  let count = u16(eocd + 10);
  let directory = u32(eocd + 16);
  // A workbook with more than 65,535 members, or one written past the 4 GB
  // mark, records its real counts in the ZIP64 record instead.
  const locator = eocd - 20;
  if (locator >= 0 && u32(locator) === ZIP64_LOCATOR_SIGNATURE) {
    const zip64 = Number(view.getBigUint64(locator + 8, true));
    if (zip64 >= 0 && zip64 + 56 <= bytes.length && u32(zip64) === ZIP64_EOCD_SIGNATURE) {
      count = Number(view.getBigUint64(zip64 + 32, true));
      directory = Number(view.getBigUint64(zip64 + 48, true));
    }
  }

  const entries = new Map<string, ZipEntry>();
  const names: string[] = [];
  let offset = directory;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || u32(offset) !== CENTRAL_SIGNATURE) break;
    const method = u16(offset + 10);
    const compressedSize = u32(offset + 20);
    const nameLength = u16(offset + 28);
    const extraLength = u16(offset + 30);
    const commentLength = u16(offset + 32);
    const localOffset = u32(offset + 42);
    const name = utf8.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name && !name.endsWith('/') && !entries.has(name)) {
      entries.set(name, { method, localOffset, compressedSize });
      names.push(name);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (!names.length) return null;

  const read = async (name: string): Promise<Uint8Array | null> => {
    const entry = entries.get(name);
    if (!entry || entry.localOffset + 30 > bytes.length) return null;
    const nameLength = u16(entry.localOffset + 26);
    const extraLength = u16(entry.localOffset + 28);
    const start = entry.localOffset + 30 + nameLength + extraLength;
    const raw = bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === STORED) return raw;
    if (entry.method !== DEFLATED) return null;
    try {
      return await inflate(raw, 'deflate-raw');
    } catch {
      return null;
    }
  };

  return {
    names,
    read,
    readText: async (name: string) => {
      const raw = await read(name);
      return raw ? utf8.decode(raw) : null;
    },
  };
}

/* ------------------------------------------------------------------ XML --- */

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ',
};

/** Decode the entity forms an OOXML part actually uses. */
export function decodeXmlText(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? decodeXmlText(match[1]!) : null;
}

/** Escape the characters that would break a markdown table cell or heading. */
function inlineSafe(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

/* ----------------------------------------------------------------- DOCX --- */

/** Marker a converted document carries where the source had a hard page break,
 * so the paginated reader shows the pages the author actually laid out. An HTML
 * comment survives the markdown pipeline without rendering. */
export const PAGE_BREAK_MARKER = '<!--page-break-->';

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

function docxRunText(scope: string): { text: string; pageBreak: boolean } {
  let text = '';
  let pageBreak = false;
  for (const match of scope.matchAll(RUN_TOKEN)) {
    if (match[1] != null) { text += decodeXmlText(match[1]); continue; }
    if (match[0].startsWith('<w:tab')) { text += '\t'; continue; }
    if (match[0].startsWith('<w:lastRenderedPageBreak')) { pageBreak = true; continue; }
    if (/w:type="page"/.test(match[2] ?? '')) { pageBreak = true; continue; }
    text += '\n';
  }
  return { text, pageBreak };
}

/** Emphasis is read per run so a bolded phrase inside a sentence survives the
 * conversion — losing it turns a specification's normative words into prose. */
function docxParagraphText(paragraph: string): { text: string; pageBreak: boolean } {
  let text = '';
  let pageBreak = false;
  const runs = paragraph.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g);
  let sawRun = false;
  for (const run of runs) {
    sawRun = true;
    const body = run[1]!;
    const properties = /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/.exec(body)?.[0] ?? '';
    const bold = /<w:b(?:\s[^>]*)?\/?>/.test(properties) && !/<w:b\b[^>]*w:val="(?:0|false)"/.test(properties);
    const italic = /<w:i(?:\s[^>]*)?\/?>/.test(properties) && !/<w:i\b[^>]*w:val="(?:0|false)"/.test(properties);
    const run_ = docxRunText(body);
    pageBreak = pageBreak || run_.pageBreak;
    if (!run_.text) continue;
    const trimmed = run_.text.trim();
    const marks = `${bold ? '**' : ''}${italic ? '*' : ''}`;
    text += marks && trimmed
      ? run_.text.replace(trimmed, `${marks}${trimmed}${[...marks].reverse().join('')}`)
      : run_.text;
  }
  if (!sawRun) {
    const fallback = docxRunText(paragraph);
    return { text: fallback.text, pageBreak: fallback.pageBreak };
  }
  return { text, pageBreak };
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
    const { text, pageBreak } = docxParagraphText(block);
    if (pending || pageBreak) {
      // A break declared mid-paragraph belongs before the text that follows it.
      if (lines[lines.length - 1] !== '') lines.push('');
      lines.push(PAGE_BREAK_MARKER, '');
      authoredPages += 1;
      pending = false;
    }
    const content = text.replace(/\s+$/g, '');
    if (!content.trim()) { if (lines[lines.length - 1] !== '') lines.push(''); continue; }
    const prefix = level ? `${'#'.repeat(level)} ` : list === 'bullet' ? '- ' : list === 'number' ? '1. ' : quote ? '> ' : '';
    lines.push(`${prefix}${content.trim()}`);
    if (level || !list) lines.push('');
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

/* ----------------------------------------------------------------- XLSX --- */

export type WorkbookCell = string | number;
export interface WorkbookSheet {
  name: string;
  columns: string[];
  rows: Array<Record<string, WorkbookCell>>;
}

/** `AB` → 27. Cell references, not element order, decide a column: a sparse row
 * that skips an empty cell would otherwise shift every value left. */
function columnIndex(reference: string): number {
  const letters = /^([A-Z]+)/.exec(reference.toUpperCase())?.[1] ?? '';
  return [...letters].reduce((total, letter) => total * 26 + (letter.charCodeAt(0) - 64), 0) - 1;
}

function sharedStringValues(xml: string): string[] {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si(?:\s[^>]*)?\/>/g)].map((item) =>
    [...(item[1] ?? '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((text) => decodeXmlText(text[1]!)).join(''));
}

const SHEET_ROW = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>|<row(?:\s[^>]*)?\/>/g;
const SHEET_CELL = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;

/** Excel serial day → ISO date. The epoch is 1899-12-30 to absorb the
 * deliberate 1900 leap-year bug every spreadsheet keeps for compatibility. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DATE_NUMBER_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateStyle(style: string | null, dateStyles: Set<number>): boolean {
  const index = Number(style);
  return Number.isFinite(index) && dateStyles.has(index);
}

function excelDate(serial: number): string {
  const time = EXCEL_EPOCH_MS + Math.round(serial * 86_400_000);
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return String(serial);
  const iso = date.toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
}

function parseSheetXml(name: string, xml: string, shared: string[], dateStyles: Set<number>, maxRows: number): WorkbookSheet {
  const grid: WorkbookCell[][] = [];
  for (const rowMatch of xml.matchAll(SHEET_ROW)) {
    if (grid.length >= maxRows + 1) break;
    const row: WorkbookCell[] = [];
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(SHEET_CELL)) {
      const attributes = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      const reference = attribute(attributes, 'r') ?? '';
      const index = reference ? columnIndex(reference) : row.length;
      const type = attribute(attributes, 't') ?? 'n';
      const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
      let value: WorkbookCell = '';
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr' || type === 'str') {
        value = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((text) => decodeXmlText(text[1]!)).join('') || decodeXmlText(raw);
      } else if (type === 'b') value = raw === '1' ? 'true' : 'false';
      else if (raw) {
        const numeric = Number(raw);
        value = Number.isFinite(numeric)
          ? isDateStyle(attribute(attributes, 's'), dateStyles) ? excelDate(numeric) : numeric
          : decodeXmlText(raw);
      }
      if (index >= 0) row[index] = value;
    }
    grid.push(row);
  }
  while (grid.length && !grid[grid.length - 1]!.some((cell) => cell !== '' && cell != null)) grid.pop();
  const [header, ...body] = grid;
  if (!header) return { name, columns: [], rows: [] };
  const width = Math.max(header.length, ...body.map((row) => row.length), 0);
  const columns = Array.from({ length: width }, (_, index) => {
    const label = String(header[index] ?? '').trim();
    return label || `Column ${index + 1}`;
  });
  const unique = columns.map((label, index) => columns.indexOf(label) === index ? label : `${label} (${index + 1})`);
  return {
    name,
    columns: unique,
    rows: body.map((row) => Object.fromEntries(unique.map((label, index) => [label, row[index] ?? '']))),
  };
}

/** Number formats a workbook defines itself; a serial rendered as `45231`
 * instead of a date makes an imported sheet unreadable. */
function customDateStyles(stylesXml: string): Set<number> {
  const dateFormats = new Set(DATE_NUMBER_FORMATS);
  for (const format of stylesXml.matchAll(/<numFmt\b([^>]*)\/>/g)) {
    const id = Number(attribute(format[1]!, 'numFmtId'));
    const code = attribute(format[1]!, 'formatCode') ?? '';
    if (Number.isFinite(id) && /[dmyhs]/i.test(code) && !/[#0]/.test(code.replace(/\[[^\]]*\]/g, ''))) dateFormats.add(id);
  }
  const applied = new Set<number>();
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  [...cellXfs.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)].forEach((xf, index) => {
    if (dateFormats.has(Number(attribute(xf[1]!, 'numFmtId')))) applied.add(index);
  });
  return applied;
}

/** Read every populated sheet of an `.xlsx` workbook. Sheet order and names are
 * taken from the workbook part so tabs read the way they do in Excel. */
export async function readXlsx(bytes: Uint8Array, maxRows = 50_000): Promise<WorkbookSheet[] | null> {
  const archive = openZip(bytes);
  const workbookXml = await archive?.readText('xl/workbook.xml');
  if (!archive || !workbookXml) return null;
  const relationships = new Map<string, string>();
  for (const match of (await archive.readText('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const id = attribute(match[1]!, 'Id');
    const target = attribute(match[1]!, 'Target');
    if (id && target) relationships.set(id, target.replace(/^\/?xl\//, '').replace(/^\.\//, ''));
  }
  const shared = sharedStringValues(await archive.readText('xl/sharedStrings.xml') ?? '');
  const dateStyles = customDateStyles(await archive.readText('xl/styles.xml') ?? '');
  const sheets: WorkbookSheet[] = [];
  const declared = [...workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)];
  for (const [index, match] of declared.entries()) {
    const name = attribute(match[1]!, 'name') ?? `Sheet${index + 1}`;
    const relationshipId = attribute(match[1]!, 'r:id') ?? attribute(match[1]!, 'relationshipId') ?? '';
    const path = relationships.get(relationshipId) ?? `worksheets/sheet${index + 1}.xml`;
    const xml = await archive.readText(`xl/${path}`) ?? await archive.readText(path);
    if (!xml) continue;
    const sheet = parseSheetXml(name, xml, shared, dateStyles, maxRows);
    if (sheet.columns.length) sheets.push(sheet);
  }
  return sheets.length ? sheets : null;
}

/* ----------------------------------------------------------------- PPTX --- */

export interface OfficeSlide { title: string; bullets: string[]; notes?: string }

function slideParagraphs(xml: string): string[] {
  return [...xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>|<a:p(?:\s[^>]*)?\/>/g)]
    .map((paragraph) => [...(paragraph[1] ?? '').matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((text) => decodeXmlText(text[1]!)).join('').trim())
    .filter(Boolean);
}

/** A slide's title placeholder, when the deck declared one — the first text box
 * on the slide is often a subtitle or a page number instead. */
function placeholderTitle(xml: string): string | null {
  for (const shape of xml.matchAll(/<p:sp(?:\s[^>]*)?>([\s\S]*?)<\/p:sp>/g)) {
    const body = shape[1]!;
    if (!/<p:ph\b[^>]*type="(?:ctrTitle|title)"/.test(body)) continue;
    const text = slideParagraphs(body).join(' ').trim();
    if (text) return text;
  }
  return null;
}

/** Read the slides of a `.pptx` deck in presentation order. */
export async function readPptx(bytes: Uint8Array, maxSlides = 200): Promise<OfficeSlide[] | null> {
  const archive = openZip(bytes);
  if (!archive) return null;
  const slidePaths = archive.names
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => Number(/(\d+)\.xml$/.exec(left)![1]) - Number(/(\d+)\.xml$/.exec(right)![1]))
    .slice(0, maxSlides);
  if (!slidePaths.length) return null;
  const slides: OfficeSlide[] = [];
  for (const path of slidePaths) {
    const xml = await archive.readText(path);
    if (!xml) continue;
    const paragraphs = slideParagraphs(xml);
    const declared = placeholderTitle(xml);
    const title = declared ?? paragraphs[0] ?? '';
    const bullets = declared ? paragraphs.filter((line) => line !== declared) : paragraphs.slice(1);
    const notesXml = await archive.readText(path.replace('ppt/slides/', 'ppt/notesSlides/').replace('slide', 'notesSlide'));
    const notes = notesXml ? slideParagraphs(notesXml).join('\n').trim() : '';
    if (!title && !bullets.length && !notes) continue;
    slides.push({ title, bullets, ...(notes ? { notes } : {}) });
  }
  return slides.length ? slides : null;
}

/* ------------------------------------------------------------------ PDF --- */

const PDF_STREAM = /stream\r?\n?/g;
const PDF_TEXT_SHOW = /\((?:\\[\s\S]|[^\\()])*\)\s*(?:Tj|'|")|\[(?:[^[\]\\]|\\[\s\S])*\]\s*TJ|(?:T\*|TD|Td)/g;
const PDF_STRING = /\((?:\\[\s\S]|[^\\()])*\)/g;
const PDF_ESCAPE: Readonly<Record<string, string>> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };

function pdfLiteral(token: string): string {
  return token.slice(1, -1).replace(/\\(\d{1,3}|[\s\S])/g, (_match, escape: string) =>
    /^\d+$/.test(escape) ? String.fromCharCode(parseInt(escape, 8)) : PDF_ESCAPE[escape] ?? (escape === '\n' ? '' : escape));
}

function pdfContentText(content: string): string {
  let text = '';
  for (const match of content.matchAll(PDF_TEXT_SHOW)) {
    const token = match[0];
    if (token.endsWith('TJ')) {
      text += [...token.matchAll(PDF_STRING)].map((part) => pdfLiteral(part[0])).join('');
      continue;
    }
    if (token.startsWith('(')) { text += pdfLiteral(PDF_STRING.exec(token)?.[0] ?? '()'); continue; }
    text += '\n';
  }
  return text;
}

/** Share of characters a person could actually read. A PDF whose fonts use a
 * custom encoding decodes to mojibake, and showing that as a document is worse
 * than admitting the text could not be extracted. */
function legibility(value: string): number {
  const characters = [...value];
  if (!characters.length) return 0;
  const readable = characters.filter((character) => /[\p{L}\p{N}\p{P}\s]/u.test(character)).length;
  return readable / characters.length;
}

export interface PdfDocument {
  pageCount: number;
  /** Extracted body text, or `null` when the file is encrypted, image-only, or
   * uses encodings this reader cannot map. */
  text: string | null;
  title?: string;
}

/**
 * Read a PDF's page count and, where the text is Flate-compressed with a
 * standard encoding, its body text — enough to show real pages on the canvas
 * instead of a file icon, and honest about the cases it cannot read.
 */
export async function readPdf(bytes: Uint8Array): Promise<PdfDocument | null> {
  const raw = latin1.decode(bytes);
  if (!raw.startsWith('%PDF-')) return null;
  const declared = [...raw.matchAll(/\/Type\s*\/Pages\b[\s\S]{0,400}?\/Count\s+(\d+)/g)].map((match) => Number(match[1]));
  const counted = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  const pageCount = Math.max(1, declared.length ? Math.max(...declared) : 0, counted);
  const title = decodeXmlText(/<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/.exec(raw)?.[1]?.trim() ?? '');
  if (/\/Encrypt\b/.test(raw)) return { pageCount, text: null, ...(title ? { title } : {}) };

  const chunks: string[] = [];
  PDF_STREAM.lastIndex = 0;
  for (const match of raw.matchAll(PDF_STREAM)) {
    const start = match.index! + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    const header = raw.slice(Math.max(0, match.index! - 400), match.index!);
    if (/\/Subtype\s*\/Image\b/.test(header)) continue;
    const body = bytes.subarray(start, end);
    if (!body.length) continue;
    const flate = /\/Filter\s*(?:\[\s*)?\/FlateDecode/.test(header);
    try {
      const content = flate ? utf8.decode(await inflate(body, 'deflate')) : latin1.decode(body);
      if (!/\b(?:Tj|TJ|T\*|Td)\b/.test(content)) continue;
      chunks.push(pdfContentText(content));
    } catch { /* a stream this reader cannot inflate contributes nothing */ }
    if (chunks.length >= pageCount + 8) break;
  }
  // One content stream is one page, so the extracted body keeps the source's
  // own pagination instead of being re-flowed into pages nobody laid out.
  const text = chunks.map((chunk) => chunk.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
    .filter(Boolean)
    .join(`\n\n${PAGE_BREAK_MARKER}\n\n`)
    .trim();
  return {
    pageCount,
    text: text && legibility(text) > 0.9 && /\p{L}{3}/u.test(text) ? text : null,
    ...(title ? { title } : {}),
  };
}

/* ------------------------------------------------------------------ RTF --- */

const RTF_UNICODE = /\\u(-?\d+)\s?\??/g;
const RTF_CONTROL = /\\([a-z]+)(-?\d+)?[ ]?/gi;

/** Plain text from an RTF file — the paragraph structure survives, the control
 * words do not. */
export function rtfToText(source: string): string {
  if (!source.trimStart().startsWith('{\\rtf')) return '';
  return source
    .replace(/\{\\\*[\s\S]*?\}/g, '')
    .replace(RTF_UNICODE, (_match, code: string) => String.fromCharCode(Number(code) < 0 ? Number(code) + 65536 : Number(code)))
    .replace(/\\'([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(RTF_CONTROL, (_match, word: string) => (word === 'par' || word === 'line' || word === 'sect' ? '\n' : word === 'tab' ? '\t' : ''))
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
