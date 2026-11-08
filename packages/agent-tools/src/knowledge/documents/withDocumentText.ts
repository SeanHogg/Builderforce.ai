/**
 * knowledge/documents/withDocumentText.ts — a `DirectorySource` decorator that turns a pdf/office file
 * into the text of its content, so the documents pack (documentsPack.ts) can read it. Memory's contract
 * is unchanged: a source still answers `read(path) → text`; this one reads the BYTES and extracts.
 *
 * The listing hash is over the file's bytes (or its metadata), never over the extracted text, so a
 * source that re-hashes what it read (`hashOf`) would see "changed since plan" for every document.
 * {@link withDocumentHashes} answers that: it remembers the hash `list()` gave a document path and maps the
 * text read for it back to that hash. A browser review worker, whose `hashOf` lives beside a proxy whose
 * `read` already extracts page-side, uses it alone.
 */

import { hashText } from '@seanhogg/builderforce-memory/ingest';
import { isDocumentPath, mediaTypeOfPath, type DirectorySource } from '@seanhogg/builderforce-memory/knowledge';
import { extractDocumentText } from './documentText.js';

/** A NUL makes memory's `isBinaryText` classify the text binary, so an unreadable document stays an asset. */
const UNREADABLE = '\u0000';

const keyOf = (text: string): string => `${text.length}:${hashText(text)}`;

/** `list()` remembers each document path's hash; `read()` of a document path maps its text to it; `hashOf` answers with it. */
export function withDocumentHashes<S extends DirectorySource>(source: S): S {
    const listed = new Map<string, string>();
    const byText = new Map<string, string>();
    const { hashOf } = source;
    return {
        ...source,
        async *list() {
            for await (const entry of source.list()) {
                if (isDocumentPath(entry.path)) listed.set(entry.path, entry.hash);
                yield entry;
            }
        },
        async read(path, signal) {
            const doc = await source.read(path, signal);
            const hash = listed.get(path);
            if (hash !== undefined && doc.content.kind === 'text') byText.set(keyOf(doc.content.text), hash);
            return doc;
        },
        ...(hashOf ? { hashOf: (text: string) => byText.get(keyOf(text)) ?? hashOf(text) } : {}),
    };
}

/**
 * Document paths (pdf, docx, xlsx, pptx, odt, ods, odp, and legacy .doc/.xls/.ppt which stay unreadable) are read as
 * bytes and returned as text of their ORIGINAL media type, so the plan and the prefetch see the type the documents
 * parser claims. Everything else passes through. `readBytes` is the host's byte read.
 */
export function withDocumentText<S extends DirectorySource>(
    source: S,
    readBytes: (path: string, signal?: AbortSignal) => Promise<Uint8Array>,
): S {
    const extracting: S = {
        ...source,
        async read(path, signal) {
            if (!isDocumentPath(path)) return source.read(path, signal);
            const mediaType = mediaTypeOfPath(path);
            const text = await extractDocumentText(await readBytes(path, signal), mediaType);
            return { id: path, tenantId: source.rootId, title: path, content: { kind: 'text', text: text ?? UNREADABLE, mediaType } };
        },
    };
    return withDocumentHashes(extracting);
}
