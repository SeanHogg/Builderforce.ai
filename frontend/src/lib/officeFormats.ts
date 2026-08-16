/**
 * Readers for the file formats people actually drop on a canvas.
 *
 * A Word document, a workbook, a deck, or a PDF that lands on the board has to
 * arrive as *content* — pages, sheets, slides, text — not as an opaque
 * attachment with a file icon. These readers turn each container into the
 * shared canvas shapes (markdown, tabular sources, slides) so the object that
 * appears is one the canvas can already render, edit, query, and export.
 *
 * Everything here runs on platform primitives — `DecompressionStream` for the
 * ZIP members of OOXML and for PDF Flate streams — so a dropped file is read in
 * the browser with no parser dependency and no upload round-trip.
 *
 * ── WHY THIS FILE IS A DOOR AND NOT THE IMPLEMENTATION ──────────────────────
 * One format per module under `office/`, behind this single entry point. The
 * readers had grown to 992 lines in one file — past the 800-line architecture
 * ceiling — and they were never one thing: `pdf.ts` alone is 440 lines of xref,
 * object streams, font CMaps and glyph widths and shares nothing with `.docx`
 * beyond the two text decoders. The one thing they DO share, the ZIP container,
 * is now stated once in `office/container.ts` instead of being the reason the
 * four OOXML readers had to live in the same file as the PDF one.
 *
 * The export surface is unchanged, so every importer — `canvasFileImport`,
 * `canvasDocuments`, `diagramVsdx`, `CreationCanvas` and the tests — is
 * untouched by the split.
 */

export { MAX_PARSEABLE_BYTES, openZip, decodeXmlText, type ZipArchive } from './office/container';
export { PAGE_BREAK_MARKER, docxXmlToMarkdown, readDocx, type OfficeDocument } from './office/docx';
export { readXlsx, type WorkbookCell, type WorkbookSheet } from './office/xlsx';
export { readPptx, type OfficeSlide } from './office/pptx';
export { readPdf, type PdfDocument } from './office/pdf';
export { rtfToText } from './office/rtf';
