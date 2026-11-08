/**
 * The ONE PDF 1.4 object writer behind every creation export (comic pages, CAD sheets).
 *
 * It owns the bookkeeping both writers used to repeat: sequential object ids (reservable
 * so a parent can name children written later), byte-exact `/Length` values, the
 * cross-reference table with one offset per object, and the trailer. Callers supply only
 * what is specific to them: page dictionaries, vector content streams, image data.
 *
 * `lib/office/pdf.ts` is NOT a candidate for this role: it is a read-only extractor
 * (`readPdf`) with no writing half, so there was no builder to reuse.
 */
import { zlibSync } from 'fflate';

const latin1 = (value: string): Uint8Array => {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff;
  return out;
};

export interface PdfBuilder {
  /** Claim the next object id without writing it yet (ids are dense and start at 1). */
  reserve(): number;
  /** Write a plain object body (a dictionary or any PDF value) for a reserved id. */
  object(id: number, body: string): void;
  /** Write a stream object; `/Length` is the exact byte length of `data`. */
  stream(id: number, dictionary: string, data: Uint8Array | string): void;
  /** Write an 8-bit DeviceRGB image XObject, deflated. `rgb` is width*height*3 bytes. */
  rgbImage(id: number, width: number, height: number, rgb: Uint8Array): void;
  /** Write the catalog and the flat page tree that names `pageIds`. */
  pageTree(catalogId: number, pagesId: number, pageIds: readonly number[]): void;
  /** The finished file; throws when a reserved id was never written. */
  build(rootId: number): Uint8Array;
}

/**
 * `binary` (default true) adds the high-byte comment line PDF recommends for files with
 * binary streams; pass false for a pure-ASCII file that can be handled as text.
 */
export function createPdfBuilder(options: { binary?: boolean } = {}): PdfBuilder {
  const bodies: Array<Uint8Array[] | undefined> = [undefined]; // index = object id
  const reserve = (): number => { bodies.push(undefined); return bodies.length - 1; };
  const put = (id: number, parts: Uint8Array[]): void => {
    if (!Number.isInteger(id) || id < 1 || id >= bodies.length) throw new Error(`pdf: object ${id} was not reserved`);
    if (bodies[id]) throw new Error(`pdf: object ${id} written twice`);
    bodies[id] = parts;
  };

  const builder: PdfBuilder = {
    reserve,
    object: (id, body) => put(id, [latin1(`${body}\n`)]),
    stream(id, dictionary, data) {
      const bytes = typeof data === 'string' ? latin1(data) : data;
      put(id, [latin1(`<< ${dictionary ? `${dictionary} ` : ''}/Length ${bytes.length} >>\nstream\n`), bytes, latin1('\nendstream\n')]);
    },
    rgbImage(id, width, height, rgb) {
      builder.stream(id, `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`, zlibSync(rgb));
    },
    pageTree(catalogId, pagesId, pageIds) {
      builder.object(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
      builder.object(pagesId, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
    },
    build(rootId) {
      const chunks: Uint8Array[] = [];
      let cursor = 0;
      const write = (bytes: Uint8Array): void => { chunks.push(bytes); cursor += bytes.length; };
      write(latin1(options.binary === false ? '%PDF-1.4\n' : '%PDF-1.4\n%\xFF\xFF\xFF\xFF\n'));
      const offsets: number[] = [];
      for (let id = 1; id < bodies.length; id++) {
        const parts = bodies[id];
        if (!parts) throw new Error(`pdf: object ${id} was reserved but never written`);
        offsets[id] = cursor;
        write(latin1(`${id} 0 obj\n`));
        parts.forEach(write);
        write(latin1('endobj\n'));
      }
      const size = bodies.length;
      const xrefAt = cursor;
      write(latin1(`xref\n0 ${size}\n0000000000 65535 f \n`));
      for (let id = 1; id < size; id++) write(latin1(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`));
      write(latin1(`trailer\n<< /Size ${size} /Root ${rootId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`));

      const out = new Uint8Array(cursor);
      let at = 0;
      for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
      return out;
    },
  };
  return builder;
}

/** Bytes as a Latin-1 string (one char per byte), for writers whose callers want text. */
export function pdfBytesToString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
}
