/**
 * `@builderforce/agent-tools/documents` — the narrow entry for document text extraction (pdf, OOXML, ODF), so a
 * Worker can import it without the whole knowledge barrel.
 */
export {
    documentDoc, DOCX_MEDIA_TYPE, EXTRACTABLE_DOCUMENT_MEDIA_TYPES, extractDocumentText, PDF_MEDIA_TYPE, readDocument,
    zipEntryNames,
} from './knowledge/documents/index.js';
export type { DocumentRead } from './knowledge/documents/index.js';
