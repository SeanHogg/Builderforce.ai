/**
 * knowledge/documents/documentDoc.ts — the document a read-in-a-worker job builds from a file's bytes: a pdf/office
 * file becomes its extracted text (original media type, so the documents pack claims it), anything else is decoded
 * as UTF-8. An unreadable document yields NUL text, which memory's binary check classifies as an asset.
 */

import type { SourceDocument } from '@seanhogg/builderforce-memory/ingest';
import { isDocumentPath, mediaTypeOfPath } from '@seanhogg/builderforce-memory/knowledge';
import { textDocument } from '../fsDirectorySource.js';
import { extractDocumentText } from './documentText.js';

export async function documentDoc(rootId: string, path: string, bytes: Uint8Array): Promise<SourceDocument> {
    if (!isDocumentPath(path)) return textDocument(rootId, path, new TextDecoder('utf-8').decode(bytes));
    return textDocument(rootId, path, (await extractDocumentText(bytes, mediaTypeOfPath(path))) ?? '\u0000');
}
