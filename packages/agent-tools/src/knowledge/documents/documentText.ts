/**
 * knowledge/documents/documentText.ts — the text of a binary document, from its bytes alone.
 *
 *   PDF                       → `unpdf` (serverless pdf.js; pages merged)
 *   DOCX / XLSX / PPTX        → fflate unzip, XML text of `word/document.xml`, `xl/sharedStrings.xml`, `ppt/slides/slide*.xml`
 *   ODT / ODS / ODP           → fflate unzip, XML text of `content.xml`
 *   legacy .doc / .xls / .ppt → undefined (OLE; stays an asset)
 *
 * Paragraph breaks survive (the parser sections by line structure). NEVER throws for a malformed
 * file — a file nothing can be read from yields `undefined`, so the review stores it as an asset.
 * Pure of fs/network, Worker-safe; pdf.js is imported lazily so only a PDF pays for it.
 */

import { strFromU8, unzipSync } from 'fflate';
import { DEFAULT_MAX_FILE_BYTES } from '@seanhogg/builderforce-memory/knowledge';

const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SLIDES = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const ODF = /^application\/vnd\.oasis\.opendocument\./;
/** A zip entry larger than this once inflated is not read (a zip bomb, or not a document). */
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;

function decodeEntities(value: string): string {
    return value
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
        // Ampersand LAST, so "&amp;lt;" decodes to "&lt;" and not to "<".
        .replace(/&amp;/g, '&');
}

/** OOXML: the `<x:t>` runs of each paragraph (split on its closing tag), one line per paragraph. */
function runsText(xml: string, paragraphEnd: RegExp, run: RegExp): string {
    return xml.split(paragraphEnd).map((para) => [...para.matchAll(run)].map((m) => decodeEntities(m[1] ?? '')).join('')).join('\n');
}

/** ODF: every tag stripped, paragraph/heading ends become newlines, `<text:tab/>` a tab, `<text:s/>` a space. */
function odfText(xml: string): string {
    return decodeEntities(
        xml.replace(/<\/text:(?:p|h)>/g, '\n').replace(/<text:tab\b[^>]*\/>/g, '\t').replace(/<text:s\b[^>]*\/>/g, ' ').replace(/<[^>]+>/g, ''),
    );
}

const slideNumber = (name: string): number => Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0);

function unzipEntries(bytes: Uint8Array, wanted: (name: string) => boolean): Record<string, Uint8Array> {
    return unzipSync(bytes, { filter: (f) => wanted(f.name) && f.originalSize <= MAX_ENTRY_BYTES });
}

function ooxmlText(bytes: Uint8Array, mediaType: string): string | undefined {
    if (mediaType === WORD) {
        const doc = unzipEntries(bytes, (n) => n === 'word/document.xml')['word/document.xml'];
        return doc && runsText(strFromU8(doc).replace(/<w:tab\b[^>]*\/?>/g, '<w:t>\t</w:t>'), /<\/w:p>/, /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g);
    }
    if (mediaType === SHEET) {
        const strings = unzipEntries(bytes, (n) => n === 'xl/sharedStrings.xml')['xl/sharedStrings.xml'];
        return strings && runsText(strFromU8(strings), /<\/si>/, /<t\b[^>]*>([\s\S]*?)<\/t>/g);
    }
    const entries = unzipEntries(bytes, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    const names = Object.keys(entries).sort((a, b) => slideNumber(a) - slideNumber(b));
    return names.length === 0 ? undefined : names.map((n) => runsText(strFromU8(entries[n]!), /<\/a:p>/, /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)).join('\n\n');
}

async function pdfText(bytes: Uint8Array): Promise<string> {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
    return Array.isArray(text) ? (text as string[]).join('\n') : text;
}

/** Control characters other than tab/newline/CR: NULs would make the text read as binary again, and none belong in a fact. */
// eslint-disable-next-line no-control-regex
const stripControl = (text: string): string => text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

/** The text of `bytes` as the document `mediaType` says it is, or undefined (unsupported type, malformed, no text layer). */
export async function extractDocumentText(bytes: Uint8Array, mediaType: string): Promise<string | undefined> {
    const type = mediaType.trim().toLowerCase();
    try {
        let raw: string | undefined;
        if (type === 'application/pdf') raw = await pdfText(bytes);
        else if (type === WORD || type === SHEET || type === SLIDES) raw = ooxmlText(bytes, type);
        else if (ODF.test(type)) {
            const content = unzipEntries(bytes, (n) => n === 'content.xml')['content.xml'];
            raw = content && odfText(strFromU8(content));
        }
        const text = raw === undefined ? '' : stripControl(raw).trim();
        return text ? text.slice(0, DEFAULT_MAX_FILE_BYTES) : undefined;
    } catch {
        return undefined;
    }
}
