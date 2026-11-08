/**
 * knowledge/documents/documentsPack.ts — the host pack that claims pdf/office files. Memory's builtin text
 * parsers refuse binary document types, so without a parser claiming them they stay assets. This one accepts
 * a source of an EXTRACTABLE document media type (documentText.ts: pdf, OOXML, ODF) whose text a host extractor
 * supplied (withDocumentText.ts) and sections it exactly as the builtin plain-text parser does — reused, not
 * reimplemented. Legacy msword/ms-excel/ms-powerpoint can never be extracted, so they are not claimed and stay assets.
 */

import { DOCS_PACK, type KnowledgePack, type KnowledgeParser } from '@seanhogg/builderforce-memory/knowledge';
import { plainTextParser } from '@seanhogg/builderforce-memory/ingest';
import { isExtractableDocumentType } from './documentText.js';

export const DOCUMENTS_PACK_ID = 'documents';

export const documentsParser: KnowledgeParser = {
    ...plainTextParser,
    id: 'documents',
    accepts: (source) => source.content.kind === 'text' && isExtractableDocumentType(source.content.mediaType ?? ''),
};

export const DOCUMENTS_PACK: KnowledgePack = {
    id: DOCUMENTS_PACK_ID,
    parsers: [documentsParser],
    ...(DOCS_PACK.judgement ? { judgement: DOCS_PACK.judgement } : {}),
};
