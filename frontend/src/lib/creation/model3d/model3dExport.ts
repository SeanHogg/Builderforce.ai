import { slugify } from '@builderforce/creation-canvas-contract';
import { meshPreviewSvg, svgDataUrl, type GeometryPreviewOptions } from '@/lib/creativeGeometry';
import { EDITED_MEDIA_MIME } from '@/lib/creationDeliverables';
import { meshToStep } from '../mesh/meshStep';
import { meshToStlAscii } from '../mesh/meshStl';
import { meshToGeometryTriangles } from '../mesh/triMesh';
import { model3dToMesh } from './model3dMesh';
import type { Model3dState } from './model3dState';

/** The formats a model leaves as. Both are meshes; STEP carries it as one faceted solid (see `meshStep`). */
export type Model3dExportFormat = 'stl' | 'step';

export const MODEL3D_EXPORT_ORDER: readonly Model3dExportFormat[] = ['stl', 'step'];

const FORMATS: Readonly<Record<Model3dExportFormat, { mimeType: string; extension: string; label: string }>> = {
  stl: { mimeType: EDITED_MEDIA_MIME.meshStl, extension: 'stl', label: 'STL' },
  step: { mimeType: EDITED_MEDIA_MIME.meshStep, extension: 'step', label: 'STEP' },
};

export interface Model3dExport {
  blob: Blob;
  fileName: string;
  mimeType: string;
  label: string;
  triangleCount: number;
  /** Difference/intersection operations that were exported as unions — the caller should say so. */
  approximated: number;
}

export function model3dExportFileName(title: string, format: Model3dExportFormat): string {
  return `${slugify(title) || 'model'}.${FORMATS[format].extension}`;
}

export function buildModel3dExport(state: Model3dState, format: Model3dExportFormat, title: string): Model3dExport {
  const { mesh, approximated } = model3dToMesh(state);
  const spec = FORMATS[format];
  const text = format === 'stl' ? meshToStlAscii(mesh, title) : meshToStep(mesh, title);
  return {
    blob: new Blob([text], { type: spec.mimeType }),
    fileName: model3dExportFileName(title, format),
    mimeType: spec.mimeType,
    label: spec.label,
    triangleCount: mesh.triangles.length,
    approximated,
  };
}

/** The model drawn as a shaded SVG picture (the card's preview and the exported thumbnail), or null for an empty scene. */
export function model3dPreviewSvg(state: Model3dState, options: GeometryPreviewOptions = {}): string | null {
  return meshPreviewSvg(meshToGeometryTriangles(model3dToMesh(state).mesh), options);
}

export function model3dPreviewUrl(state: Model3dState, options: GeometryPreviewOptions = {}): string | null {
  const svg = model3dPreviewSvg(state, options);
  return svg ? svgDataUrl(svg) : null;
}
