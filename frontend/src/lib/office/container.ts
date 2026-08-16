/**
 * The ZIP container every OOXML format is packed in, plus the XML decoding its
 * parts share.
 *
 * `.docx`, `.xlsx`, `.pptx` and `.vsdx` are all ZIPs of XML parts, so the reader
 * for each one is a different walk over the SAME archive — which is why the
 * archive, its size ceiling and the two text decoders live here rather than in
 * whichever format happened to need them first.
 *
 * Everything runs on platform primitives (`DecompressionStream`), so a dropped
 * file is read in the browser with no parser dependency and no upload.
 */

const utf8 = new TextDecoder();
/** One character per byte, so string offsets equal byte offsets when scanning a
 * binary container such as PDF for its structural keywords. */
export const latin1 = new TextDecoder('latin1');

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

export async function inflate(raw: Uint8Array, format: 'deflate-raw' | 'deflate'): Promise<Uint8Array> {
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

export function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? decodeXmlText(match[1]!) : null;
}

/** Escape the characters that would break a markdown table cell or heading. */
export function inlineSafe(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

/* -------------------------------------------------- conversion markers --- */

/** Marker a converted document carries where the source had a hard page break,
 * so the paginated reader shows the pages the author actually laid out. An HTML
 * comment survives the markdown pipeline without rendering.
 *
 * Shared rather than owned by one reader: `.docx` writes it from a `w:br` and
 * the PDF reader writes it between pages. Two copies of one marker string is
 * two ways for a page break to stop being recognised. */
export const PAGE_BREAK_MARKER = '<!--page-break-->';
