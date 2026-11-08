import { resolveExportColor } from '../exportColors';
import { slugify } from '@builderforce/creation-canvas-contract';
import { EDITED_MEDIA_MIME } from '@/lib/creationDeliverables';
import { meshToStep } from '../mesh/meshStep';
import { meshToStlAscii } from '../mesh/meshStl';
import { cadToMesh } from './cadExtrude';
import { renderCadDxf } from './cadDxf';
import { renderCadPdf } from './cadPdf';
import { renderCadSvg } from './cadSvg';
import type { CadState } from './cadState';

/**
 * Every format a drawing leaves as, in one table.
 *
 * Drawings: SVG (vector picture), DXF (every CAD package), PDF (print at true size).
 * Solids: STL and STEP, the sheet's closed shapes extruded to plates — see `cadExtrude`.
 */
export type CadExportFormat = 'svg' | 'dxf' | 'pdf' | 'stl' | 'step';

interface FormatSpec {
  mimeType: string;
  extension: string;
  /** What the deliverable record calls it. */
  label: string;
  render: (state: CadState, title: string, paper: string) => string;
}

export const CAD_EXPORT_FORMATS: Readonly<Record<CadExportFormat, FormatSpec>> = {
  svg: { mimeType: EDITED_MEDIA_MIME.cadSvg, extension: 'svg', label: 'SVG', render: (state, _title, paper) => renderCadSvg(state, paper) },
  dxf: { mimeType: EDITED_MEDIA_MIME.cadDxf, extension: 'dxf', label: 'DXF', render: (state) => renderCadDxf(state) },
  pdf: { mimeType: EDITED_MEDIA_MIME.cadPdf, extension: 'pdf', label: 'PDF', render: (state) => renderCadPdf(state) },
  stl: { mimeType: EDITED_MEDIA_MIME.meshStl, extension: 'stl', label: 'STL', render: (state, title) => meshToStlAscii(cadToMesh(state), title) },
  step: { mimeType: EDITED_MEDIA_MIME.meshStep, extension: 'step', label: 'STEP', render: (state, title) => meshToStep(cadToMesh(state), title) },
};

export const CAD_EXPORT_ORDER: readonly CadExportFormat[] = ['svg', 'dxf', 'pdf', 'stl', 'step'];

export function cadExportFileName(title: string, format: CadExportFormat): string {
  return `${slugify(title) || 'drawing'}.${CAD_EXPORT_FORMATS[format].extension}`;
}

/** `paper` is the export palette's `paper`, resolved by the caller (only the SVG writes it). */
export function buildCadExport(state: CadState, format: CadExportFormat, title: string, paper: string = resolveExportColor('paper')): { blob: Blob; fileName: string; mimeType: string; label: string } {
  const spec = CAD_EXPORT_FORMATS[format];
  return { blob: new Blob([spec.render(state, title, paper)], { type: spec.mimeType }), fileName: cadExportFileName(title, format), mimeType: spec.mimeType, label: spec.label };
}
