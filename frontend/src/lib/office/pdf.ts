/**
 * PDF → text, without a parser dependency.
 *
 * By far the largest reader here, and the reason this family is a directory
 * rather than one file: a PDF is not a container of text but a stream of glyph
 * codes over fonts that each publish their own encoding, so reading one means
 * walking the xref, the object streams, the page tree, the resources, the font
 * CMaps and the widths before a single character is known.
 */

import { PAGE_BREAK_MARKER, decodeXmlText, inflate, latin1 } from './container';

/* ------------------------------------------------------------------ PDF --- */

/**
 * ── WHY THIS READS FONTS AND NOT JUST STREAMS ────────────────────────────────
 * The first version of this reader inflated every stream and pulled the text out
 * of `(…) Tj` literals. That works for a PDF written in 1998. Every PDF a person
 * actually drops on a board — a Google Docs export, a Word "Save as PDF", a
 * Pages CV — embeds SUBSET fonts under `/Encoding /Identity-H`, where the bytes
 * in a shown string are GLYPH INDICES, not characters, and the strings are
 * written in hex (`<0036>`) rather than as literals. Read as characters they
 * decode to mojibake, the legibility gate below then correctly refused to show
 * it, and a five-page résumé landed on the canvas as a file icon reading "Text
 * not extractable" (measured 2026-08-16). The glyph→character table is in the
 * file: every such font carries a `/ToUnicode` CMap. Reading it is the whole
 * difference between a document and an attachment.
 */

const PDF_MAX_DICT_SCAN = 8192;
const PDF_MAX_CONTENT_CHARS = 6_000_000;
const PDF_OBJECT_HEADER = /(?:^|[^0-9])(\d{1,10})\s+(\d{1,5})\s+obj\b/g;
const PDF_STREAM_KEYWORD = /(?:^|[^a-zA-Z])stream[ \t]*\r?\n?/;
const PDF_REFERENCE = /^\s*(\d+)\s+\d+\s+R\b/;
const PDF_SCALAR = /^\s*(\d+\s+\d+\s+R|\/[^\s/<>[\]()]*|[^/<>[\]()\s][^/<>[\]()]*)/;
const PDF_HEX_TOKEN = /<([0-9A-Fa-f\s]*)>/g;
const PDF_ESCAPE: Readonly<Record<string, string>> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };

interface PdfObject { dict: string; stream: Uint8Array | null }
interface PdfFont { twoByte: boolean; winAnsi: boolean; map: Map<number, string>; widths: Map<number, number>; fallback: number }

/**
 * Index every indirect object by number. Only the HEAD of each is kept as its
 * dictionary: slicing to `endobj` copied every embedded image into a string,
 * which cost 14 seconds on one scanned CV, all of it allocation.
 */
function pdfObjects(raw: string, bytes: Uint8Array): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  for (const match of raw.matchAll(PDF_OBJECT_HEADER)) {
    const start = match.index! + match[0].length;
    const close = raw.indexOf('endobj', start);
    const head = raw.slice(start, Math.min(close < 0 ? raw.length : close, start + PDF_MAX_DICT_SCAN));
    const keyword = PDF_STREAM_KEYWORD.exec(head);
    let stream: Uint8Array | null = null;
    if (keyword) {
      const from = start + keyword.index + keyword[0].length;
      const to = raw.indexOf('endstream', from);
      if (to > from) stream = bytes.subarray(from, to);
    }
    objects.set(Number(match[1]), { dict: keyword ? head.slice(0, keyword.index + 1) : head, stream });
  }
  return objects;
}

async function pdfStreamData(object: PdfObject | null | undefined): Promise<Uint8Array | null> {
  if (!object?.stream) return null;
  if (!/\/Filter\s*(?:\[\s*)?\/FlateDecode/.test(object.dict)) return object.stream;
  try {
    return await inflate(object.stream, 'deflate');
  } catch {
    return null;
  }
}

/** PDF 1.5+ packs page and font dictionaries into compressed object streams.
 * Without expanding them a modern file has objects this reader cannot see. */
async function pdfExpandObjectStreams(objects: Map<number, PdfObject>): Promise<void> {
  for (const object of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(object.dict)) continue;
    const data = await pdfStreamData(object);
    if (!data) continue;
    const text = latin1.decode(data);
    const count = Number(/\/N\s+(\d+)/.exec(object.dict)?.[1] ?? 0);
    const first = Number(/\/First\s+(\d+)/.exec(object.dict)?.[1] ?? 0);
    const header = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let index = 0; index < count; index += 1) {
      const number = header[index * 2];
      const offset = header[index * 2 + 1];
      if (!Number.isFinite(number) || !Number.isFinite(offset) || objects.has(number!)) continue;
      const next = header[index * 2 + 3];
      objects.set(number!, { dict: text.slice(first + offset!, first + (Number.isFinite(next) ? next! : text.length)), stream: null });
    }
  }
}

/** The raw token a key holds: a nested dictionary, an array, a reference, a name
 * or a number — bounded by the value, never by a fixed character count. */
function pdfEntry(dict: string, key: string): string {
  const at = new RegExp(`/${key}(?![A-Za-z0-9])`).exec(dict);
  if (!at) return '';
  let index = at.index + at[0].length;
  while (index < dict.length && /\s/.test(dict[index]!)) index += 1;
  const nested = dict.startsWith('<<', index) ? ['<<', '>>'] : dict[index] === '[' ? ['[', ']'] : null;
  if (nested) {
    const [openToken, closeToken] = nested as [string, string];
    let depth = 0;
    for (let scan = index; scan < dict.length; scan += 1) {
      if (dict.startsWith(openToken, scan)) { depth += 1; scan += openToken.length - 1; continue; }
      if (dict.startsWith(closeToken, scan)) {
        depth -= 1;
        if (!depth) return dict.slice(index, scan + closeToken.length);
        scan += closeToken.length - 1;
      }
    }
    return dict.slice(index);
  }
  return PDF_SCALAR.exec(dict.slice(index))?.[1]?.trim() ?? '';
}

function pdfResolve(objects: Map<number, PdfObject>, token: string): PdfObject | null {
  const reference = PDF_REFERENCE.exec(token);
  return reference ? objects.get(Number(reference[1])) ?? null : null;
}

/** A dictionary value written either inline or behind a reference. */
function pdfDictOrReference(objects: Map<number, PdfObject>, dict: string, key: string): string {
  const raw = pdfEntry(dict, key);
  if (!raw) return '';
  return pdfResolve(objects, raw)?.dict ?? raw;
}

const pdfHexDigits = (token: string) => token.replace(/[^0-9A-Fa-f]/g, '');

function pdfUtf16(hex: string): string {
  let out = '';
  for (let index = 0; index + 4 <= hex.length; index += 4) out += String.fromCharCode(parseInt(hex.slice(index, index + 4), 16));
  return out;
}

/** A font's `/ToUnicode` CMap: character code → the text the glyph really shows. */
function pdfCMap(text: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const tokens = [...block[1]!.matchAll(PDF_HEX_TOKEN)].map((match) => pdfHexDigits(match[1]!));
    for (let index = 0; index + 1 < tokens.length; index += 2) map.set(parseInt(tokens[index]!, 16), pdfUtf16(tokens[index + 1]!));
  }
  const range = /<([0-9A-Fa-f\s]*)>\s*<([0-9A-Fa-f\s]*)>\s*(?:\[([\s\S]*?)\]|<([0-9A-Fa-f\s]*)>)/g;
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const row of block[1]!.matchAll(range)) {
      const low = parseInt(pdfHexDigits(row[1]!), 16);
      const high = parseInt(pdfHexDigits(row[2]!), 16);
      if (!Number.isFinite(low) || !Number.isFinite(high) || high < low || high - low > 0xffff) continue;
      if (row[3] !== undefined) {
        [...row[3].matchAll(PDF_HEX_TOKEN)].forEach((item, offset) => map.set(low + offset, pdfUtf16(pdfHexDigits(item[1]!))));
        continue;
      }
      const base = pdfHexDigits(row[4] ?? '');
      const start = parseInt(base.slice(-4), 16);
      const prefix = base.slice(0, -4);
      for (let code = low; code <= high; code += 1) map.set(code, pdfUtf16(prefix + (start + (code - low)).toString(16).padStart(4, '0')));
    }
  }
  return map;
}

/** WinAnsi's own assignments in 0x80–0x9F, the range where it differs from
 * Latin-1 — the curly quotes and dashes every word processor emits. */
const PDF_WIN_ANSI_HIGH = ['€', '', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '', 'Ž', '', '', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '', 'ž', 'Ÿ'];

const pdfNumbers = (token: string) => [...token.matchAll(/[-+]?[0-9]*\.?[0-9]+/g)].map((match) => Number(match[0]));

/** Glyph advances, so a gap between two runs can be told from the next letter.
 * Simple fonts publish `/Widths` from `/FirstChar`; CID fonts publish `/W` as
 * runs of `code [w …]` or `first last w`, defaulting to `/DW`. */
function pdfWidths(objects: Map<number, PdfObject>, font: PdfObject): { widths: Map<number, number>; fallback: number } {
  const widths = new Map<number, number>();
  const descendant = pdfEntry(font.dict, 'DescendantFonts');
  const cid = descendant ? (pdfResolve(objects, descendant.replace(/^\[|\]$/g, '').trim())?.dict ?? descendant) : '';
  if (cid) {
    const declared = pdfEntry(cid, 'W');
    const table = pdfResolve(objects, declared)?.dict ?? declared;
    const pending: number[] = [];
    for (const token of table.matchAll(/\[([^\][]*)\]|([-+]?[0-9]*\.?[0-9]+)/g)) {
      if (token[1] !== undefined) {
        const start = pending.pop();
        if (start !== undefined) pdfNumbers(token[1]).forEach((value, offset) => widths.set(start + offset, value));
        pending.length = 0;
        continue;
      }
      pending.push(Number(token[2]));
      if (pending.length === 3) {
        const [first, last, value] = pending.splice(0, 3) as [number, number, number];
        for (let code = first; code <= last && code - first < 65536; code += 1) widths.set(code, value);
      }
    }
    return { widths, fallback: Number(pdfEntry(cid, 'DW')) || 1000 };
  }
  const declared = pdfEntry(font.dict, 'Widths');
  const first = Number(pdfEntry(font.dict, 'FirstChar')) || 0;
  pdfNumbers(pdfResolve(objects, declared)?.dict ?? declared).forEach((value, offset) => widths.set(first + offset, value));
  const descriptor = pdfResolve(objects, pdfEntry(font.dict, 'FontDescriptor'));
  return { widths, fallback: Number(pdfEntry(descriptor?.dict ?? '', 'MissingWidth')) || 500 };
}

/** The fonts a page's resources name, keyed by the name its content stream uses.
 * Resolved PER PAGE: `/F1` is page-local, and pointed at a different font on
 * page two of the very file that prompted this reader. */
async function pdfFonts(objects: Map<number, PdfObject>, resourcesDict: string): Promise<Map<string, PdfFont>> {
  const fonts = new Map<string, PdfFont>();
  const fontDict = pdfDictOrReference(objects, resourcesDict, 'Font');
  if (!fontDict) return fonts;
  for (const entry of fontDict.matchAll(/\/([^\s/<>[\]()]+)\s*(\d+)\s+\d+\s+R/g)) {
    const font = objects.get(Number(entry[2]));
    if (!font) continue;
    const toUnicode = pdfResolve(objects, pdfEntry(font.dict, 'ToUnicode'));
    const data = toUnicode ? await pdfStreamData(toUnicode) : null;
    fonts.set(entry[1]!, {
      twoByte: /\/Subtype\s*\/Type0/.test(font.dict) || /\/Encoding\s*\/Identity-[HV]/.test(font.dict),
      winAnsi: /\/Encoding\s*\/WinAnsiEncoding/.test(font.dict),
      map: data ? pdfCMap(latin1.decode(data)) : new Map(),
      ...pdfWidths(objects, font),
    });
  }
  return fonts;
}

function pdfLiteralCodes(token: string): number[] {
  const body = token.slice(1, -1);
  const codes: number[] = [];
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== '\\') { codes.push(body.charCodeAt(index) & 0xff); continue; }
    const next = body[index + 1];
    if (next === undefined) break;
    if (next >= '0' && next <= '7') {
      let digits = '';
      while (digits.length < 3 && body[index + 1]! >= '0' && body[index + 1]! <= '7') { digits += body[index + 1]; index += 1; }
      codes.push(parseInt(digits, 8) & 0xff);
      continue;
    }
    index += 1;
    if (next === '\n') continue;
    codes.push((PDF_ESCAPE[next] ?? next).charCodeAt(0) & 0xff);
  }
  return codes;
}

function pdfHexCodes(token: string): number[] {
  const hex = pdfHexDigits(token);
  const codes: number[] = [];
  for (let index = 0; index < hex.length; index += 2) codes.push(parseInt(hex.slice(index, index + 2).padEnd(2, '0'), 16));
  return codes;
}

/** The text a shown string produces AND the width it occupies, in thousandths of
 * the point size. The second half is what tells a gap wide enough to be a space
 * from the next letter, so both are measured in the one pass. */
function pdfShow(token: string, font: PdfFont | undefined): { text: string; width: number } {
  const codes = token.startsWith('<') ? pdfHexCodes(token) : pdfLiteralCodes(token);
  const fallback = font?.fallback ?? 500;
  let text = '';
  let width = 0;
  if (font?.twoByte) {
    for (let index = 0; index + 1 < codes.length; index += 2) {
      const code = (codes[index]! << 8) | codes[index + 1]!;
      text += font.map.get(code) ?? '';
      width += font.widths.get(code) ?? fallback;
    }
    return { text, width };
  }
  for (const code of codes) {
    const mapped = font?.map.get(code);
    const winAnsi = font?.winAnsi && code >= 0x80 && code <= 0x9f ? PDF_WIN_ANSI_HIGH[code - 0x80] : '';
    text += mapped !== undefined ? mapped : winAnsi || String.fromCharCode(code);
    width += font?.widths.get(code) ?? fallback;
  }
  return { text, width };
}

const PDF_NUMBER = '[-+]?[0-9]*\\.?[0-9]+';
const PDF_STRING = '\\((?:\\\\[\\s\\S]|[^\\\\()])*\\)|<[0-9A-Fa-f\\s]*>';
const PDF_CONTENT = new RegExp([
  `/([^\\s/<>\\[\\]()]+)\\s+(${PDF_NUMBER})\\s+(Tf)`,
  '\\[([^\\][]{0,50000})\\]\\s*(TJ)',
  `(${PDF_STRING})\\s*(Tj|'|")`,
  `(${PDF_NUMBER})\\s+(${PDF_NUMBER})\\s+(TD|Td)`,
  `${PDF_NUMBER}\\s+${PDF_NUMBER}\\s+${PDF_NUMBER}\\s+${PDF_NUMBER}\\s+(${PDF_NUMBER})\\s+(${PDF_NUMBER})\\s+(Tm)`,
  `(${PDF_NUMBER})\\s+(TL)`,
  '(T\\*)',
].join('|'), 'g');
const PDF_SHOW_TOKEN = new RegExp(`(${PDF_STRING})|(${PDF_NUMBER})`, 'g');
const PDF_HAS_TEXT = /BT|Tj|TJ/;
/** A gap wider than this share of the point size is a space, not kerning. */
const PDF_SPACE_GAP = 0.18;

function pdfContentText(content: string, fonts: Map<string, PdfFont>): string {
  let font = fonts.size === 1 ? [...fonts.values()][0] : undefined;
  let size = 12;
  // The text LINE origin, which `Tm`/`Td`/`T*` move, and the PEN, which only
  // showing text advances. Collapsing the two made every relative `Td` compound
  // on the width just drawn, so a page that positions each glyph separately —
  // which is what Google Docs writes — read as "S e a n H o g g".
  let lineX = 0;
  let lineY = 0;
  let x = 0;
  let y = 0;
  let pen: number | null = null;
  let leading = 0;
  let lastY: number | null = null;
  const lines: string[] = [];
  let line = '';
  const flush = () => { if (line.trim()) lines.push(line.trimEnd()); line = ''; };
  const moveTo = (nextX: number, nextY: number) => { lineX = nextX; lineY = nextY; x = nextX; y = nextY; };

  const show = ({ text, width }: { text: string; width: number }) => {
    if (lastY !== null && Math.abs(y - lastY) > size * 0.3) flush();
    else if (line && pen !== null && x - pen > size * PDF_SPACE_GAP && !/\s$/.test(line) && !/^\s/.test(text)) line += ' ';
    line += text;
    lastY = y;
    x += (width / 1000) * size;
    pen = x;
  };

  for (const match of content.matchAll(PDF_CONTENT)) {
    if (match[3] === 'Tf') { font = fonts.get(match[1]!) ?? font; size = Math.abs(Number(match[2])) || size; continue; }
    if (match[5] === 'TJ') {
      let text = '';
      let width = 0;
      for (const token of match[4]!.matchAll(PDF_SHOW_TOKEN)) {
        if (token[1] !== undefined) {
          const shown = pdfShow(token[1], font);
          text += shown.text;
          width += shown.width;
          continue;
        }
        const adjust = Number(token[2]);
        width -= adjust;
        if (adjust <= -140 && text && !/\s$/.test(text)) text += ' ';
      }
      if (text) show({ text, width });
      continue;
    }
    if (match[7] === 'Tj' || match[7] === "'" || match[7] === '"') {
      if (match[7] !== 'Tj') { moveTo(lineX, lineY + leading); flush(); }
      const shown = pdfShow(match[6]!, font);
      if (shown.text) show(shown);
      continue;
    }
    if (match[10] === 'Td' || match[10] === 'TD') {
      if (match[10] === 'TD') leading = -Number(match[9]);
      moveTo(lineX + Number(match[8]), lineY + Number(match[9]));
      continue;
    }
    if (match[13] === 'Tm') { moveTo(Number(match[11]), Number(match[12])); continue; }
    if (match[15] === 'TL') { leading = Number(match[14]); continue; }
    if (match[16] === 'T*') { moveTo(lineX, lineY + leading); flush(); }
  }
  flush();
  return lines.join('\n');
}

/** A page's content: one stream, an inline array of streams, or a REFERENCE to
 * an array of them. Word writes the last of those, and reading only the first
 * two left every Word export with a correct page count and no text at all. */
async function pdfPageContent(objects: Map<number, PdfObject>, page: PdfObject): Promise<string> {
  const token = pdfEntry(page.dict, 'Contents');
  const direct = pdfResolve(objects, token);
  const array = direct && !direct.stream && direct.dict.trimStart().startsWith('[') ? direct.dict
    : token.trimStart().startsWith('[') ? token : '';
  const referenced = array
    ? [...array.matchAll(/(\d+)\s+\d+\s+R/g)].map((match) => Number(match[1]))
    : direct ? [Number(PDF_REFERENCE.exec(token)![1])] : [];
  const parts: string[] = [];
  for (const number of referenced) {
    const data = await pdfStreamData(objects.get(number));
    if (data) parts.push(latin1.decode(data));
  }
  return parts.join('\n');
}

/** Resources are inheritable: a page that declares none uses its parent's. */
function pdfPageResources(objects: Map<number, PdfObject>, page: PdfObject, depth = 0): string {
  const own = pdfDictOrReference(objects, page.dict, 'Resources');
  if (own || depth > 8) return own;
  const parent = pdfResolve(objects, pdfEntry(page.dict, 'Parent'));
  return parent ? pdfPageResources(objects, parent, depth + 1) : '';
}

/** Share of characters a person could actually read. A PDF whose fonts publish
 * no usable encoding still decodes to mojibake, and showing that as a document
 * is worse than admitting the text could not be extracted. */
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
 * Read a PDF's page count and its body text, page by page, through each page's
 * own fonts — enough to show real pages on the canvas instead of a file icon,
 * and honest about the cases it cannot read.
 */
export async function readPdf(bytes: Uint8Array): Promise<PdfDocument | null> {
  const raw = latin1.decode(bytes);
  if (!raw.startsWith('%PDF-')) return null;
  const title = decodeXmlText(/<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/.exec(raw)?.[1]?.trim() ?? '');
  const objects = pdfObjects(raw, bytes);
  await pdfExpandObjectStreams(objects);
  const pages = [...objects.values()].filter((object) => /\/Type\s*\/Page(?![a-zA-Z])/.test(object.dict));
  const declared = [...raw.matchAll(/\/Type\s*\/Pages\b[\s\S]{0,400}?\/Count\s+(\d+)/g)].map((match) => Number(match[1]));
  const pageCount = Math.max(1, pages.length, declared.length ? Math.max(...declared) : 0);
  if (/\/Encrypt\b/.test(raw)) return { pageCount, text: null, ...(title ? { title } : {}) };

  const extracted: string[] = [];
  let budget = PDF_MAX_CONTENT_CHARS;
  for (const page of pages) {
    if (budget <= 0) break;
    const content = await pdfPageContent(objects, page);
    budget -= content.length;
    // A page that shows no text at all — a scan, a chart, a full-bleed photo —
    // is skipped BEFORE the operator scan rather than after it. Eleven scanned
    // pages of vector paths cost 24 seconds through the tokenizer and yielded
    // nothing; this literal test costs a millisecond and yields the same nothing.
    if (!content || !PDF_HAS_TEXT.test(content)) continue;
    extracted.push(pdfContentText(content, await pdfFonts(objects, pdfPageResources(objects, page))));
  }

  // One page of the source is one page of the document, so the extracted body
  // keeps the file's own pagination instead of being re-flowed into pages
  // nobody laid out.
  const text = extracted.map((chunk) => chunk.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
    .filter(Boolean)
    .join(`\n\n${PAGE_BREAK_MARKER}\n\n`)
    .trim();
  return {
    pageCount,
    text: text && legibility(text) > 0.9 && /\p{L}{3}/u.test(text) ? text : null,
    ...(title ? { title } : {}),
  };
}
