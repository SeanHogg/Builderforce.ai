/**
 * What a Canvas object can be taken away AS — the one export taxonomy.
 *
 * Every object leaves the board in the format its own tool uses: a deck becomes
 * a .pptx, a sheet becomes a .xlsx, a document becomes a .docx, a diagram
 * becomes its own notation plus an .svg. Nothing is offered a format it cannot
 * fill, and nothing is silently downgraded to markdown because that was the
 * easiest thing to write.
 *
 * This lived inside `CreationCanvas` as seven hand-maintained inline kind lists
 * — one per button — which is how the card came to offer Word and PDF while the
 * inspector offered Word and CSV for the same object. It is not board state, so
 * it moved here: the board's export runner, the shared button row, and the Files
 * library now read ONE list of actions per kind, one MIME per action, and one
 * answer to "what does this kind export as by default".
 */

import type { CreationObjectKind } from '@builderforce/creation-canvas-contract';

export type CanvasExportAction = 'copy' | 'markdown' | 'html' | 'csv' | 'xlsx' | 'docx' | 'pdf' | 'pptx' | 'svg' | 'json' | 'diagram' | 'scorm';

export const EXPORT_MIME: Readonly<Record<CanvasExportAction, string>> = {
  copy: 'text/plain', markdown: 'text/markdown', html: 'text/html', csv: 'text/csv', json: 'application/json',
  diagram: 'application/vnd.jgraph.mxfile',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  scorm: 'application/zip',
};

/** The file extension each action produces. `copy` writes no file. */
export const EXPORT_EXTENSION: Readonly<Record<Exclude<CanvasExportAction, 'copy' | 'diagram'>, string>> = {
  markdown: 'md', html: 'html', csv: 'csv', xlsx: 'xlsx', docx: 'docx', pdf: 'pdf', pptx: 'pptx', svg: 'svg', json: 'json', scorm: 'zip',
};

/** Exports that are rendered by `/api/exports` rather than written in the
 * browser, and so need an authenticated session. */
export const SERVER_RENDERED_ACTIONS: ReadonlySet<CanvasExportAction> = new Set<CanvasExportAction>(['docx', 'pptx', 'xlsx']);

/**
 * Every format a kind offers, NATIVE FIRST.
 *
 * Order is the contract: the head of the list is what a one-click download
 * produces, and the rest is what the button row shows after it. A kind absent
 * from this table has no artifact to take away — an agent card, a frame, a
 * timer — and gets no export row at all rather than a "Download Markdown"
 * button that writes out its own title.
 */
const EXPORT_ACTIONS: Partial<Record<CreationObjectKind, readonly CanvasExportAction[]>> = {
  document: ['docx', 'pdf', 'markdown', 'copy'],
  prd: ['docx', 'pdf', 'markdown', 'copy'],
  knowledge: ['docx', 'pdf', 'markdown', 'copy'],
  report: ['docx', 'pdf', 'markdown', 'copy'],
  note: ['docx', 'pdf', 'markdown', 'copy'],
  // A resume is sent as a file AND pasted into an application form, so HTML sits
  // alongside the two containers a recruiter asks for.
  resume: ['docx', 'pdf', 'html', 'markdown', 'copy'],
  slides: ['pptx', 'pdf', 'markdown', 'copy'],
  diagram: ['diagram', 'svg', 'pdf', 'copy'],
  // Drawn artifacts: the generator produced a picture, so the picture is what
  // leaves — as vector where it drew vector, and on a page either way.
  cad: ['svg', 'pdf'],
  comic: ['pdf'],
  spreadsheet: ['xlsx', 'csv'],
  table: ['xlsx', 'csv'],
  dataset: ['xlsx', 'csv'],
  // A Brain card is a doorway into its conversation, not the transcript itself.
  // Transcript actions live on each assistant reply, where their scope is clear.
  code: ['markdown', 'copy'],
  dashboard: ['json'],
  chart: ['json'],
  evaluation: ['json'],
  featureSummary: ['json'],
  projectComparison: ['json'],
  // A pitch, its rubric, its Q&A drill, and its written entry are all documents
  // a person hands to someone else — a run sheet, a readiness review, a prep
  // pack, a submission. They export as documents, not as JSON.
  pitch: ['docx', 'pdf', 'markdown', 'copy'],
  pitchScorecard: ['docx', 'pdf', 'markdown', 'copy'],
  pitchQa: ['docx', 'pdf', 'markdown', 'copy'],
  pitchApplication: ['docx', 'pdf', 'markdown', 'copy'],
  course: ['scorm', 'json'],
};

const NO_ACTIONS: readonly CanvasExportAction[] = [];

/** The formats this kind offers, native first. Empty when it has no artifact. */
export function exportActionsFor(kind: CreationObjectKind): readonly CanvasExportAction[] {
  return EXPORT_ACTIONS[kind] ?? NO_ACTIONS;
}

/** The format an object exports to when nothing more specific was asked for —
 * the head of its own list, so "download this" and the first button agree. */
export function defaultExportAction(kind: CreationObjectKind): CanvasExportAction {
  return exportActionsFor(kind)[0] ?? 'markdown';
}
