/**
 * knowledge/documents/documentText.ts — the text of a binary document, from its bytes alone.
 *
 *   PDF                       → `unpdf` (serverless pdf.js; page by page, abort-aware)
 *   DOCX / XLSX / PPTX        → fflate unzip, XML text of `word/document.xml`, `xl/sharedStrings.xml`, `ppt/slides/slide*.xml`
 *   ODT / ODS / ODP           → fflate unzip, XML text of `content.xml`
 *   legacy .doc / .xls / .ppt → undefined (OLE; stays an asset)
 *
 * Paragraph breaks survive (the parser sections by line structure). Two kinds of failure, kept apart:
 *   - FINAL (`readDocument` → `{ failure }`, `extractDocumentText` → `undefined`): the file opens but has no text
 *     (`no-text`), or it is malformed, over the size caps, or not an extractable type (`unreadable`). The review
 *     stores it as an asset.
 *   - TRANSIENT (THROWS): the pdf.js chunk failed to load, or the run was aborted. The engine records a failed read
 *     and retries; the file must NOT become an asset because of it.
 * Pure of fs/network, Worker-safe; pdf.js is imported lazily so only a PDF pays for it. pdf.js TRANSFERS the buffer it
 * is given to its worker (detaching it), so it always gets a private copy: a caller's bytes are never detached.
 */

import { strFromU8, Unzip, UnzipInflate, UnzipPassThrough, unzipSync } from 'fflate';
import { DEFAULT_MAX_FILE_BYTES } from '@seanhogg/builderforce-memory/knowledge';

export const PDF_MEDIA_TYPE = 'application/pdf';
export const DOCX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PPTX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const ODT_MEDIA_TYPE = 'application/vnd.oasis.opendocument.text';
export const ODS_MEDIA_TYPE = 'application/vnd.oasis.opendocument.spreadsheet';
export const ODP_MEDIA_TYPE = 'application/vnd.oasis.opendocument.presentation';

/** The ONE list of media types this module can extract text from. Legacy msword/ms-excel/ms-powerpoint are NOT here: they stay assets. */
export const EXTRACTABLE_DOCUMENT_MEDIA_TYPES: readonly string[] = [
    PDF_MEDIA_TYPE, DOCX_MEDIA_TYPE, XLSX_MEDIA_TYPE, PPTX_MEDIA_TYPE, ODT_MEDIA_TYPE, ODS_MEDIA_TYPE, ODP_MEDIA_TYPE,
];

export const isExtractableDocumentType = (mediaType: string): boolean =>
    EXTRACTABLE_DOCUMENT_MEDIA_TYPES.includes(mediaType.trim().toLowerCase());

/** A zip entry declaring more than this once inflated is not read. */
export const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
/** All the entries read from one zip may declare at most this much once inflated (a zip bomb, or not a document). */
export const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
/** A zip with more entries than this is not a document. */
export const MAX_ZIP_ENTRIES = 10_000;

/** The zip broke a size/entry cap: FINAL (the document is unreadable), not transient. */
class DocumentLimitError extends Error {}
/** The zip is not the document its media type claims (its text-bearing entry is missing): FINAL. */
class DocumentFormatError extends Error {}
/** The pdf.js chunk could not be loaded: TRANSIENT. */
class DocumentEngineUnavailable extends Error {
    constructor(cause: unknown) { super('document: pdf engine failed to load'); this.name = 'DocumentEngineUnavailable'; this.cause = cause; }
}

/** `&#NNN;` / `&#xHH;` with a code point outside Unicode (or a surrogate) is U+FFFD, never a throw. */
function codePoint(value: number): string {
    return Number.isInteger(value) && value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
        ? String.fromCodePoint(value)
        : '�';
}

export function decodeEntities(value: string): string {
    return value
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => codePoint(Number.parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d: string) => codePoint(Number(d)))
        // Ampersand LAST, so "&amp;lt;" decodes to "&lt;" and not to "<".
        .replace(/&amp;/g, '&');
}

interface ScanSpec {
    /** Element whose text is a run (`w:t`, `a:t`, `t`); ignored when `allText`. */
    run?: string;
    /** Closing tags (without `<`/`>`) that end a paragraph: `/w:p`, `/si`, `/text:p`. */
    paragraphEnds: readonly string[];
    /** Opening tags that stand for a character (`w:tab` → tab). */
    chars?: Readonly<Record<string, string>>;
    /** ODF: every character-data run counts, not only a named element. */
    allText?: boolean;
}

/**
 * LINEAR scanner: every `<…>` tag is visited once (`indexOf`), a run's text is the characters up to the next `<`.
 * No backtracking regex, so an unclosed tag or a megabyte of `<w:t>` cannot go quadratic. One line per paragraph.
 */
function scanText(xml: string, spec: ScanSpec): string {
    const bounded = xml.length > MAX_TOTAL_BYTES ? xml.slice(0, MAX_TOTAL_BYTES) : xml;
    const lines: string[] = [];
    let line = '';
    let i = 0;
    while (i < bounded.length) {
        const lt = bounded.indexOf('<', i);
        if (lt < 0) {
            if (spec.allText) line += decodeEntities(bounded.slice(i));
            break;
        }
        if (spec.allText && lt > i) line += decodeEntities(bounded.slice(i, lt));
        const gt = bounded.indexOf('>', lt + 1);
        if (gt < 0) break; // an unterminated tag: nothing after it is markup we can trust
        const tag = bounded.slice(lt + 1, gt);
        let n = tag[0] === '/' ? 1 : 0;
        while (n < tag.length && tag.charCodeAt(n) > 32 && tag[n] !== '/') n++;
        const name = tag.slice(0, n);
        const selfClosing = tag.endsWith('/');
        i = gt + 1;
        if (spec.paragraphEnds.includes(name)) {
            lines.push(line);
            line = '';
        } else if (spec.chars && Object.hasOwn(spec.chars, name)) {
            line += spec.chars[name];
        } else if (!spec.allText && name === spec.run && !selfClosing) {
            const end = bounded.indexOf('<', i);
            const stop = end < 0 ? bounded.length : end;
            line += decodeEntities(bounded.slice(i, stop));
            i = stop;
        }
    }
    if (line) lines.push(line);
    return lines.join('\n');
}

const WORD_SPEC: ScanSpec = { run: 'w:t', paragraphEnds: ['/w:p'], chars: { 'w:tab': '\t' } };
const SHEET_SPEC: ScanSpec = { run: 't', paragraphEnds: ['/si'] };
const SLIDE_SPEC: ScanSpec = { run: 'a:t', paragraphEnds: ['/a:p'] };
const ODF_SPEC: ScanSpec = { allText: true, paragraphEnds: ['/text:p', '/text:h'], chars: { 'text:tab': '\t', 'text:s': ' ' } };

const slideNumber = (name: string): number => Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0);

/**
 * Compressed bytes fed per push. Deflate expands at most ~1032:1, so one push can inflate at most ~4 MB: the
 * process never holds more than that beyond the caps, and the signal/caps are checked between pushes.
 */
const PUSH_BYTES = 4096;

/**
 * The entry names of a zip, read from its central directory WITHOUT inflating anything (the cheap "is this a Word
 * document?" check). Undefined when the bytes are not a readable zip or hold more than `MAX_ZIP_ENTRIES` entries.
 */
export function zipEntryNames(bytes: Uint8Array): string[] | undefined {
    const names: string[] = [];
    try {
        unzipSync(bytes, {
            filter: (file) => {
                if (names.length >= MAX_ZIP_ENTRIES) throw new DocumentLimitError('document: too many zip entries');
                names.push(file.name);
                return false;
            },
        });
    } catch {
        return undefined;
    }
    return names;
}

/**
 * Unzip only the wanted entries, STREAMING: the DECLARED sizes are a cheap pre-check (per entry, and summed over the
 * wanted entries), and the caps are ALSO enforced on the actual inflated byte count (a header may lie), so inflating
 * stops the moment either is passed.
 * `onChunk` (a test seam) is called with every inflated chunk of a wanted entry.
 */
export function unzipEntries(
    bytes: Uint8Array, wanted: (name: string) => boolean, signal?: AbortSignal, onChunk?: (chunk: Uint8Array) => void,
): Record<string, Uint8Array> {
    const out: Record<string, Uint8Array> = {};
    let seen = 0;
    let total = 0;
    /** Sum of the sizes DECLARED by the wanted entries so far: the cheap pre-check on the zip as a whole. */
    let declaredTotal = 0;
    const unzip = new Unzip((file) => {
        signal?.throwIfAborted();
        if (++seen > MAX_ZIP_ENTRIES) throw new DocumentLimitError('document: too many zip entries');
        if (!wanted(file.name)) return;
        const declared = file.originalSize ?? 0;
        if (declared > MAX_ENTRY_BYTES) throw new DocumentLimitError('document: zip entry too large');
        declaredTotal += declared;
        if (declaredTotal > MAX_TOTAL_BYTES) throw new DocumentLimitError('document: zip inflates too large');
        const parts: Uint8Array[] = [];
        let entryBytes = 0;
        file.ondata = (err, chunk, final) => {
            if (err) throw err;
            signal?.throwIfAborted();
            entryBytes += chunk.length;
            total += chunk.length;
            if (entryBytes > MAX_ENTRY_BYTES) throw new DocumentLimitError('document: zip entry too large');
            if (total > MAX_TOTAL_BYTES) throw new DocumentLimitError('document: zip inflates too large');
            onChunk?.(chunk);
            parts.push(chunk);
            if (final) {
                const joined = new Uint8Array(entryBytes);
                let at = 0;
                for (const p of parts) { joined.set(p, at); at += p.length; }
                out[file.name] = joined;
            }
        };
        file.start();
    });
    unzip.register(UnzipInflate);
    unzip.register(UnzipPassThrough);
    if (bytes.length === 0) unzip.push(bytes, true);
    for (let at = 0; at < bytes.length; at += PUSH_BYTES) {
        signal?.throwIfAborted();
        unzip.push(bytes.subarray(at, at + PUSH_BYTES), at + PUSH_BYTES >= bytes.length);
    }
    return out;
}

/** The text-bearing entry a DOCX / ODF document cannot be without: missing, the zip is not that document (unreadable). */
function requiredEntry(bytes: Uint8Array, name: string, signal?: AbortSignal): Uint8Array {
    const entry = unzipEntries(bytes, (n) => n === name, signal)[name];
    if (!entry) throw new DocumentFormatError(`document: no ${name}`);
    return entry;
}

/** A workbook with no shared strings, or a deck with no slides, is a real document with no text (''). */
function ooxmlText(bytes: Uint8Array, mediaType: string, signal?: AbortSignal): string {
    if (mediaType === DOCX_MEDIA_TYPE) return scanText(strFromU8(requiredEntry(bytes, 'word/document.xml', signal)), WORD_SPEC);
    if (mediaType === XLSX_MEDIA_TYPE) {
        const strings = unzipEntries(bytes, (n) => n === 'xl/sharedStrings.xml', signal)['xl/sharedStrings.xml'];
        return strings ? scanText(strFromU8(strings), SHEET_SPEC) : '';
    }
    const entries = unzipEntries(bytes, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n), signal);
    const names = Object.keys(entries).sort((a, b) => slideNumber(a) - slideNumber(b));
    return names.map((n) => { signal?.throwIfAborted(); return scanText(strFromU8(entries[n]!), SLIDE_SPEC); }).join('\n\n');
}

interface PdfTextItem { str?: string; hasEOL?: boolean }

async function pdfText(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
    let mod: typeof import('unpdf');
    try {
        mod = await import('unpdf');
    } catch (error) {
        throw new DocumentEngineUnavailable(error);
    }
    signal?.throwIfAborted();
    // A PRIVATE copy: pdf.js transfers (detaches) the buffer it is handed, which must never be the caller's.
    const pdf = await mod.getDocumentProxy(bytes.slice());
    try {
        const pages: string[] = [];
        let size = 0;
        for (let p = 1; p <= pdf.numPages && size < DEFAULT_MAX_FILE_BYTES; p++) {
            signal?.throwIfAborted();
            const content = await (await pdf.getPage(p)).getTextContent();
            let page = '';
            for (const item of content.items as PdfTextItem[]) {
                if (typeof item.str !== 'string') continue;
                page += item.str;
                if (item.hasEOL) page += '\n';
            }
            pages.push(page);
            size += page.length;
        }
        return pages.join('\n');
    } finally {
        // PDFDocumentProxy has no destroy(); the loading task owns the worker and transport.
        await pdf.loadingTask.destroy();
    }
}

/** Control characters other than tab/newline/CR: NULs would make the text read as binary again, and none belong in a fact. */
// eslint-disable-next-line no-control-regex
const stripControl = (text: string): string => text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

/**
 * Failures that say nothing about the FILE: an abort or an engine that did not load. These rethrow. Anything else
 * (a RangeError included) was raised while parsing the bytes, so the file is unreadable, not retried forever.
 */
function isTransient(error: unknown, signal?: AbortSignal): boolean {
    return signal?.aborted === true
        || error instanceof DocumentEngineUnavailable
        || (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError');
}

/**
 * What reading a document gave: its text, or why there is none.
 *   - `no-text`: the file opened but holds no text (a scanned PDF, an empty DOCX).
 *   - `unreadable`: malformed, over the caps, or not an extractable type; `reason` says which.
 */
export type DocumentRead =
    | { text: string }
    | { failure: 'no-text' }
    | { failure: 'unreadable'; reason: string };

const unreadable = (reason: string): DocumentRead => ({ failure: 'unreadable', reason });

/**
 * Read `bytes` as the document `mediaType` says it is. THROWS on a transient failure (see the module header) and on
 * `signal` aborting; every other failure is a `{ failure }` answer. The caller's `bytes` are never detached.
 */
export async function readDocument(bytes: Uint8Array, mediaType: string, signal?: AbortSignal): Promise<DocumentRead> {
    const type = mediaType.trim().toLowerCase();
    if (!isExtractableDocumentType(type)) return unreadable('not an extractable document type');
    signal?.throwIfAborted();
    let raw: string;
    try {
        if (type === PDF_MEDIA_TYPE) raw = await pdfText(bytes, signal);
        else if (type === DOCX_MEDIA_TYPE || type === XLSX_MEDIA_TYPE || type === PPTX_MEDIA_TYPE) raw = ooxmlText(bytes, type, signal);
        else raw = scanText(strFromU8(requiredEntry(bytes, 'content.xml', signal)), ODF_SPEC);
    } catch (error) {
        if (isTransient(error, signal)) throw error;
        return unreadable(error instanceof Error && error.message ? error.message : 'unknown error');
    }
    const text = stripControl(raw).trim();
    return text ? { text: text.slice(0, DEFAULT_MAX_FILE_BYTES) } : { failure: 'no-text' };
}

/**
 * The text of `bytes` as the document `mediaType` says it is, or undefined (unextractable type, malformed, over the
 * caps, no text layer). THROWS on a transient failure (see the module header) and on `signal` aborting.
 */
export async function extractDocumentText(bytes: Uint8Array, mediaType: string, signal?: AbortSignal): Promise<string | undefined> {
    const read = await readDocument(bytes, mediaType, signal);
    return 'text' in read ? read.text : undefined;
}
