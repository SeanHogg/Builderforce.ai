/**
 * knowledge/documents/documentsPack.ts — the host pack that claims pdf/office files. Memory's builtin text
 * parsers refuse binary document types, so without a parser claiming them they stay assets. This one accepts
 * a source of a binary document media type whose text a host extractor supplied (withDocumentText.ts) and
 * sections it exactly as the builtin plain-text parser does — reused, not reimplemented.
 */

import { DOCS_PACK, type KnowledgePack, type KnowledgeParser } from '@seanhogg/builderforce-memory/knowledge';
import { isBinaryDocumentType, plainTextParser } from '@seanhogg/builderforce-memory/ingest';

export const DOCUMENTS_PACK_ID = 'documents';

export const documentsParser: KnowledgeParser = {
    ...plainTextParser,
    id: 'documents',
    accepts: (source) => source.content.kind === 'text' && isBinaryDocumentType(source.content.mediaType ?? ''),
};

export const DOCUMENTS_PACK: KnowledgePack = {
    id: DOCUMENTS_PACK_ID,
    parsers: [documentsParser],
    ...(DOCS_PACK.judgement ? { judgement: DOCS_PACK.judgement } : {}),
};
