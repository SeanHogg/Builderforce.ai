/**
 * The image kind's NON-DESTRUCTIVE edit stack, as pure data.
 *
 * The base picture (`outputUrl`) is never rewritten. What the person did to it —
 * orient, crop, adjust, annotate — is this small record, kept on the object as
 * `imageEdit`, and rendered on demand (`renderImageEdit`). Undo is therefore "change
 * the record", and "reset" is "forget the record".
 *
 * Order of application, fixed so the preview and the export cannot disagree:
 *   flip → rotate → adjust (filter) → crop → annotate.
 *
 * Annotations are the canvas drawing runtime's own strokes (`canvasDrawing.ts`), held in
 * an {@link IMAGE_ANNOTATION_SPAN}-wide space relative to the CROPPED output, so they
 * survive a resolution change (preview at 1200px, export at full size).
 */
import { slugify } from '@builderforce/creation-canvas-contract';
import { canvasStrokes, type CanvasStroke } from '@/lib/canvasDrawing';

export const IMAGE_EDIT_VERSION = 1;
/** Annotation space: the output is always this many units wide. */
export const IMAGE_ANNOTATION_SPAN = 1000;
export const IMAGE_ADJUST_RANGE = { min: 0, max: 200, neutral: 100 } as const;
/** No side may be cropped away entirely; the two insets of an axis share this ceiling. */
export const IMAGE_CROP_MAX_INSET = 0.9;
export const IMAGE_EXPORT_FORMATS = {
  png: { mimeType: 'image/png', extension: 'png', label: 'PNG', quality: undefined },
  webp: { mimeType: 'image/webp', extension: 'webp', label: 'WebP', quality: 0.92 },
} as const;
export type ImageExportFormat = keyof typeof IMAGE_EXPORT_FORMATS;

/**
 * The export format a blob actually is. A browser that cannot encode the requested type
 * (Safari and WebP) hands back a PNG, so the file name, mime and label come from the blob,
 * not from the button that was pressed. Null for a type that is not an export format.
 */
export function imageFormatOfMime(mimeType: string): ImageExportFormat | null {
  const bare = mimeType.split(';')[0]!.trim().toLowerCase();
  return (Object.keys(IMAGE_EXPORT_FORMATS) as ImageExportFormat[]).find((format) => IMAGE_EXPORT_FORMATS[format].mimeType === bare) ?? null;
}

export type ImageRotation = 0 | 90 | 180 | 270;
/** Fractions of the oriented image removed from each edge. */
export interface ImageCrop { left: number; top: number; right: number; bottom: number }
/** Percentages; 100 leaves the pixel alone. */
export interface ImageAdjustments { brightness: number; contrast: number; saturation: number }

export interface ImageEdit {
  version: typeof IMAGE_EDIT_VERSION;
  rotation: ImageRotation;
  flipX: boolean;
  flipY: boolean;
  crop: ImageCrop;
  adjust: ImageAdjustments;
  strokes: CanvasStroke[];
}

const NO_CROP: ImageCrop = { left: 0, top: 0, right: 0, bottom: 0 };
const NEUTRAL: ImageAdjustments = { brightness: 100, contrast: 100, saturation: 100 };

export function defaultImageEdit(): ImageEdit {
  return { version: IMAGE_EDIT_VERSION, rotation: 0, flipX: false, flipY: false, crop: { ...NO_CROP }, adjust: { ...NEUTRAL }, strokes: [] };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Keep one axis's pair of insets inside the ceiling, trimming the one just changed last. */
function insetPair(first: number, second: number): [number, number] {
  const total = first + second;
  if (total <= IMAGE_CROP_MAX_INSET) return [first, second];
  const scale = IMAGE_CROP_MAX_INSET / total;
  return [first * scale, second * scale];
}

function normalizedCrop(raw: Partial<Record<keyof ImageCrop, unknown>> | undefined): ImageCrop {
  const read = (key: keyof ImageCrop) => clamp(raw?.[key], 0, IMAGE_CROP_MAX_INSET, 0);
  const [left, right] = insetPair(read('left'), read('right'));
  const [top, bottom] = insetPair(read('top'), read('bottom'));
  return { left, top, right, bottom };
}

/** Read stored or AI-authored JSON defensively: a bad patch must not break the editor. */
export function imageEditFrom(value: unknown): ImageEdit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultImageEdit();
  const raw = value as Record<string, unknown>;
  const adjust = (raw.adjust && typeof raw.adjust === 'object' ? raw.adjust : {}) as Record<string, unknown>;
  const { min, max, neutral } = IMAGE_ADJUST_RANGE;
  return {
    version: IMAGE_EDIT_VERSION,
    rotation: ([0, 90, 180, 270] as const).find((angle) => angle === raw.rotation) ?? 0,
    flipX: raw.flipX === true,
    flipY: raw.flipY === true,
    crop: normalizedCrop(raw.crop && typeof raw.crop === 'object' ? raw.crop as Record<string, unknown> : undefined),
    adjust: {
      brightness: clamp(adjust.brightness, min, max, neutral),
      contrast: clamp(adjust.contrast, min, max, neutral),
      saturation: clamp(adjust.saturation, min, max, neutral),
    },
    strokes: canvasStrokes({ strokes: raw.strokes }),
  };
}

export function isImageEditIdentity(edit: ImageEdit): boolean {
  return edit.rotation === 0 && !edit.flipX && !edit.flipY
    && edit.crop.left === 0 && edit.crop.top === 0 && edit.crop.right === 0 && edit.crop.bottom === 0
    && edit.adjust.brightness === NEUTRAL.brightness && edit.adjust.contrast === NEUTRAL.contrast && edit.adjust.saturation === NEUTRAL.saturation
    && edit.strokes.length === 0;
}

/** A quarter turn. Cropping is expressed on the oriented image, so it resets with the turn; annotations are laid over the RESULT and stay put. */
export function rotateImage(edit: ImageEdit, direction: 1 | -1): ImageEdit {
  const rotation = (((edit.rotation + direction * 90) % 360) + 360) % 360 as ImageRotation;
  return { ...edit, rotation, crop: { ...NO_CROP } };
}

export function flipImage(edit: ImageEdit, axis: 'x' | 'y'): ImageEdit {
  return { ...edit, ...(axis === 'x' ? { flipX: !edit.flipX } : { flipY: !edit.flipY }) };
}

export function cropImage(edit: ImageEdit, patch: Partial<ImageCrop>): ImageEdit {
  return { ...edit, crop: normalizedCrop({ ...edit.crop, ...patch }) };
}

export function adjustImage(edit: ImageEdit, patch: Partial<ImageAdjustments>): ImageEdit {
  const { min, max, neutral } = IMAGE_ADJUST_RANGE;
  return { ...edit, adjust: {
    brightness: clamp(patch.brightness, min, max, edit.adjust.brightness ?? neutral),
    contrast: clamp(patch.contrast, min, max, edit.adjust.contrast ?? neutral),
    saturation: clamp(patch.saturation, min, max, edit.adjust.saturation ?? neutral),
  } };
}

/** Adding and erasing marks is the shared `DrawingSurface`'s job; only undo is the edit stack's. */
export function undoImageStroke(edit: ImageEdit): ImageEdit {
  return { ...edit, strokes: edit.strokes.slice(0, -1) };
}

/** Swapped by a quarter turn. */
export function orientedSize(width: number, height: number, rotation: ImageRotation): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

/** The crop window, in pixels of the oriented image, and the size of the output it yields. */
export function cropWindow(orientedWidth: number, orientedHeight: number, crop: ImageCrop): { x: number; y: number; width: number; height: number } {
  const x = Math.round(orientedWidth * crop.left);
  const y = Math.round(orientedHeight * crop.top);
  return {
    x,
    y,
    width: Math.max(1, Math.round(orientedWidth * (1 - crop.left - crop.right))),
    height: Math.max(1, Math.round(orientedHeight * (1 - crop.top - crop.bottom))),
  };
}

/** Output pixel size of an edit applied to a `width`×`height` base. */
export function imageOutputSize(width: number, height: number, edit: ImageEdit): { width: number; height: number } {
  const oriented = orientedSize(width, height, edit.rotation);
  const window = cropWindow(oriented.width, oriented.height, edit.crop);
  return { width: window.width, height: window.height };
}

/** The annotation space for an output of this shape: always {@link IMAGE_ANNOTATION_SPAN} wide. */
export function annotationSpace(outputWidth: number, outputHeight: number): { width: number; height: number } {
  return { width: IMAGE_ANNOTATION_SPAN, height: (IMAGE_ANNOTATION_SPAN * Math.max(1, outputHeight)) / Math.max(1, outputWidth) };
}

/** A canvas-2D / CSS `filter` value, or `none` when the adjustments are neutral. */
export function imageFilter(adjust: ImageAdjustments): string {
  if (adjust.brightness === NEUTRAL.brightness && adjust.contrast === NEUTRAL.contrast && adjust.saturation === NEUTRAL.saturation) return 'none';
  return `brightness(${adjust.brightness}%) contrast(${adjust.contrast}%) saturate(${adjust.saturation}%)`;
}

export function imageExportFileName(title: string, format: ImageExportFormat): string {
  return `${slugify(title, { maxLength: 60, fallback: 'image' })}-edited.${IMAGE_EXPORT_FORMATS[format].extension}`;
}
