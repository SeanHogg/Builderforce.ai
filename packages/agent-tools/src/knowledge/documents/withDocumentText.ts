/**
 * knowledge/documents/withDocumentText.ts — a `DirectorySource` decorator that turns a pdf/office file
 * into the text of its content, so the documents pack (documentsPack.ts) can read it. Memory's contract
 * is unchanged: a source still answers `read(path) → text`; this one reads the BYTES and extracts.
 *
 * The review re-hashes what it read through `hashOf(text, path)` and compares it with the listing hash, which is
 * over the file's BYTES. For a document the text is not those bytes, so {@link withDocumentHashes} answers
 * `hashOf` with the hash of the bytes ACTUALLY read on the path's most recent document read (never the cached
 * listing hash, which would make "changed since plan" always pass). Keyed by PATH, so identical documents at
 * different paths each keep their own hash. Without a byte hash it delegates to the inner `hashOf(text, path)`.
 */

import { isDocumentPath, mediaTypeOfPath, type DirectorySource } from '@seanhogg/builderforce-memory/knowledge';
import { extractDocumentText } from './documentText.js';

/** Forward-compatible view of `DirectorySource`: memory >= 2026.10.62 adds `hashOf(text, path)` and `readTimeoutMs(path)`; older engines ignore both. */
export type DocumentAwareSource = DirectorySource & {
    hashOf?(text: string, path?: string): string;
    readTimeoutMs?(path: string): number | undefined;
};

/** A NUL makes memory's `isBinaryText` classify the text binary, so an unreadable document stays an asset. */
const UNREADABLE = '\u0000';

/** Extracting a large pdf is slower than the engine's default 5 s read deadline. */
export const DOCUMENT_READ_TIMEOUT_MS = 60_000;

/**
 * `hashOf(text, path)` answers `hashOfRead(path)` (the hash of the bytes last read for that path) when it has one,
 * else the inner source's `hashOf(text, path)`. No inner `hashOf` leaves `hashOf` undefined, as before.
 */
export function withDocumentHashes<S extends DirectorySource>(source: S, hashOfRead?: (path: string) => string | undefined): S & DocumentAwareSource {
    const { hashOf } = source as DocumentAwareSource;
    if (!hashOf) return source as S & DocumentAwareSource;
    return { ...source, hashOf: (text: string, path?: string) => (path === undefined ? undefined : hashOfRead?.(path)) ?? hashOf(text, path) } as S & DocumentAwareSource;
}

/**
 * Document paths (pdf, docx, xlsx, pptx, odt, ods, odp, and legacy .doc/.xls/.ppt which stay unreadable) are read as
 * bytes and returned as text of their ORIGINAL media type, so the plan and the prefetch see the type the documents
 * parser claims. Everything else passes through. `readBytes` is the host's byte read; `hashBytes` is the SAME
 * function the source's `list()` hashes bytes with (omit it when the listing hash is not a byte hash). A transient extraction failure
 * throws (the engine retries); `readTimeoutMs` gives document paths a longer deadline than the engine default.
 */
export function withDocumentText<S extends DirectorySource>(
    source: S,
    readBytes: (path: string, signal?: AbortSignal) => Promise<Uint8Array>,
    hashBytes?: (bytes: Uint8Array) => string,
): S & DocumentAwareSource {
    const readHashes = new Map<string, string>();
    const inner = source as DocumentAwareSource;
    const extracting = {
        ...source,
        async read(path, signal) {
            if (!isDocumentPath(path)) return source.read(path, signal);
            const mediaType = mediaTypeOfPath(path);
            readHashes.delete(path);
            const bytes = await readBytes(path, signal);
            if (hashBytes) readHashes.set(path, hashBytes(bytes));
            const text = await extractDocumentText(bytes, mediaType, signal);
            return { id: path, tenantId: source.rootId, title: path, content: { kind: 'text', text: text ?? UNREADABLE, mediaType } };
        },
        readTimeoutMs: (path: string) => (isDocumentPath(path) ? DOCUMENT_READ_TIMEOUT_MS : inner.readTimeoutMs?.(path)),
    } as S & DocumentAwareSource;
    return withDocumentHashes(extracting, (path) => readHashes.get(path));
}
