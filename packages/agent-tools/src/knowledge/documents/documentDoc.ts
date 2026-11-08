/**
 * knowledge/documents/documentDoc.ts — the ONE "bytes → SourceDocument" helper (`documentDoc`) for a read-in-a-worker job
 * (VS Code extractJobHandler): a pdf/office file becomes its extracted text (original media type, so the
 * documents pack claims it), anything else is decoded as UTF-8. A document with nothing extractable (legacy
 * format, malformed, over the caps, no text layer) yields NUL text, which memory's binary check classifies as
 * an asset. A TRANSIENT extraction failure (engine load, abort, out of memory) throws, so the caller records a
 * failed read and retries instead of turning the file into an asset.
 */

import type { SourceDocument } from '@seanhogg/builderforce-memory/ingest';
import { isDocumentPath, mediaTypeOfPath } from '@seanhogg/builderforce-memory/knowledge';
import { textDocument } from '../fsDirectorySource.js';
import { extractDocumentText } from './documentText.js';

export async function documentDoc(
    rootId: string,
    path: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
): Promise<SourceDocument> {
    if (!isDocumentPath(path)) return textDocument(rootId, path, new TextDecoder('utf-8').decode(bytes));
    return textDocument(rootId, path, (await extractDocumentText(bytes, mediaTypeOfPath(path), signal)) ?? '\u0000');
}
