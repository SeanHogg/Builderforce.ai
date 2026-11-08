/**
 * knowledge/documents/documentText.ts — the text of a binary document, from its bytes alone.
 *
 *   PDF                       → `unpdf` (serverless pdf.js; page by page, abort-aware)
 *   DOCX / XLSX / PPTX        → fflate unzip, XML text of `word/document.xml`, `xl/sharedStrings.xml`, `ppt/slides/slide*.xml`
 *   ODT / ODS / ODP           → fflate unzip, XML text of `content.xml`
 *   legacy .doc / .xls / .ppt → undefined (OLE; stays an asset)
 *
 * Paragraph breaks survive (the parser sections by line structure). Two kinds of failure, kept apart:
 *   - FINAL (returns `undefined`): the file is malformed, over the size caps, has no text layer, or is not an
 *     extractable type. The review stores it as an asset.
 *   - TRANSIENT (THROWS): the pdf.js chunk failed to load, the run was aborted, or memory ran out. The
 *     engine records a failed read and retries; the file must NOT become an asset because of it.
 * Pure of fs/network, Worker-safe; pdf.js is imported lazily so only a PDF pays for it.
 */

import { strFromU8, unzipSync } from 'fflate';
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

/** Unzip only the wanted entries. Declared sizes are checked in the filter, BEFORE fflate allocates for inflating. */
function unzipEntries(bytes: Uint8Array, wanted: (name: string) => boolean, signal?: AbortSignal): Record<string, Uint8Array> {
    let seen = 0;
    let total = 0;
    return unzipSync(bytes, {
        filter: (f) => {
            signal?.throwIfAborted();
            if (++seen > MAX_ZIP_ENTRIES) throw new DocumentLimitError('document: too many zip entries');
            if (!wanted(f.name)) return false;
            if (f.originalSize > MAX_ENTRY_BYTES) throw new DocumentLimitError('document: zip entry too large');
            total += f.originalSize;
            if (total > MAX_TOTAL_BYTES) throw new DocumentLimitError('document: zip inflates too large');
            return true;
        },
    });
}

function ooxmlText(bytes: Uint8Array, mediaType: string, signal?: AbortSignal): string | undefined {
    if (mediaType === DOCX_MEDIA_TYPE) {
        const doc = unzipEntries(bytes, (n) => n === 'word/document.xml', signal)['word/document.xml'];
        return doc && scanText(strFromU8(doc), WORD_SPEC);
    }
    if (mediaType === XLSX_MEDIA_TYPE) {
        const strings = unzipEntries(bytes, (n) => n === 'xl/sharedStrings.xml', signal)['xl/sharedStrings.xml'];
        return strings && scanText(strFromU8(strings), SHEET_SPEC);
    }
    const entries = unzipEntries(bytes, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n), signal);
    const names = Object.keys(entries).sort((a, b) => slideNumber(a) - slideNumber(b));
    if (names.length === 0) return undefined;
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
    const pdf = await mod.getDocumentProxy(bytes);
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
        await pdf.destroy();
    }
}

/** Control characters other than tab/newline/CR: NULs would make the text read as binary again, and none belong in a fact. */
// eslint-disable-next-line no-control-regex
const stripControl = (text: string): string => text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

/** Failures that say nothing about the FILE: an abort, memory exhaustion, an engine that did not load. These rethrow. */
function isTransient(error: unknown, signal?: AbortSignal): boolean {
    return signal?.aborted === true
        || error instanceof DocumentEngineUnavailable
        || error instanceof RangeError
        || (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError');
}

/**
 * The text of `bytes` as the document `mediaType` says it is, or undefined (unextractable type, malformed, over the
 * caps, no text layer). THROWS on a transient failure (see the module header) and on `signal` aborting.
 */
export async function extractDocumentText(bytes: Uint8Array, mediaType: string, signal?: AbortSignal): Promise<string | undefined> {
    const type = mediaType.trim().toLowerCase();
    if (!isExtractableDocumentType(type)) return undefined;
    signal?.throwIfAborted();
    try {
        let raw: string | undefined;
        if (type === PDF_MEDIA_TYPE) raw = await pdfText(bytes, signal);
        else if (type === DOCX_MEDIA_TYPE || type === XLSX_MEDIA_TYPE || type === PPTX_MEDIA_TYPE) raw = ooxmlText(bytes, type, signal);
        else {
            const content = unzipEntries(bytes, (n) => n === 'content.xml', signal)['content.xml'];
            raw = content && scanText(strFromU8(content), ODF_SPEC);
        }
        const text = raw === undefined ? '' : stripControl(raw).trim();
        return text ? text.slice(0, DEFAULT_MAX_FILE_BYTES) : undefined;
    } catch (error) {
        if (isTransient(error, signal)) throw error;
        return undefined;
    }
}
