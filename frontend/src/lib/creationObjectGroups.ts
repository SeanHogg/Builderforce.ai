/**
 * The two kind groups the inspector treats as ONE shape — a creative generator (brief
 * in, artifact out) and a document editor (markdown in, markdown out). Shared between
 * `CreationCanvas.tsx` (which gates the runtime actions these kinds get) and
 * `canvasKindSettings.*.ts` (which registers their settings manifests), so the two
 * never hold two different opinions about which kinds belong to which group.
 */

import type { CreationObjectKind } from '@builderforce/creation-canvas-contract';

export const CREATIVE_GENERATOR_KINDS: ReadonlySet<CreationObjectKind> = new Set([
  'image', 'animation', 'podcast', 'comic', 'game', 'cad', 'model3d', 'resume', 'template',
]);

export const DOCUMENT_EDITOR_KINDS: ReadonlySet<CreationObjectKind> = new Set([
  'document', 'prd', 'knowledge', 'note', 'report', 'slides',
]);
