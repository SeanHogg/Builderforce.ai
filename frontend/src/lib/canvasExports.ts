/**
 * What a Canvas object can be taken away AS — the one export taxonomy.
 *
 * This lived inside `CreationCanvas` until the document card grew its own
 * download buttons, at which point the card would have had to import the board
 * that renders it. The taxonomy is not board state, so it moved here: the
 * board's export runner, the inspector's button row, the Files library, and the
 * document card now read one list of actions, one MIME per action, and one
 * answer to "what does this kind export as by default".
 */

import type { CreationObjectKind } from '@builderforce/creation-canvas-contract';

export type CanvasExportAction = 'copy' | 'markdown' | 'csv' | 'docx' | 'pdf' | 'pptx' | 'json' | 'diagram';

export const EXPORT_MIME: Readonly<Record<CanvasExportAction, string>> = {
  copy: 'text/plain', markdown: 'text/markdown', csv: 'text/csv', json: 'application/json',
  diagram: 'application/vnd.jgraph.mxfile',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/**
 * Objects whose body is a written document, and so are offered as Word and PDF.
 *
 * One set rather than a repeated inline kind list: the card's download buttons
 * and the inspector's have to offer the same formats for the same object, or a
 * person finds Word on one surface and not the other for the same document.
 */
export const OFFICE_DOCUMENT_KINDS: ReadonlySet<CreationObjectKind> = new Set<CreationObjectKind>(['document', 'prd', 'knowledge', 'report', 'note']);

/** The format an object exports to when nothing more specific was asked for —
 * a deck becomes a deck, a sheet becomes rows, a diagram stays a diagram. */
export function defaultExportAction(kind: CreationObjectKind): CanvasExportAction {
  if (kind === 'slides') return 'pptx';
  if (kind === 'diagram') return 'diagram';
  if (kind === 'spreadsheet' || kind === 'table' || kind === 'dataset') return 'csv';
  if (OFFICE_DOCUMENT_KINDS.has(kind)) return 'docx';
  return 'markdown';
}
