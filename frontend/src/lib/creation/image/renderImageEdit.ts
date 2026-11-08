/**
 * Paint an {@link ImageEdit} onto an offscreen canvas — the one renderer the live
 * preview and the PNG/WebP export both call, so what is shown is what is saved.
 *
 * Browser-only (it needs a canvas). The decisions it makes — sizes, filter string, crop
 * window — all come from `imageEdit.ts`, which is where they are tested.
 */
import { resolveExportColor } from '@/lib/creation/exportColors';
import { HIGHLIGHTER_OPACITY, HIGHLIGHTER_WIDTH_FACTOR, strokeRect, type CanvasStroke } from '@/lib/canvasDrawing';
import {
  IMAGE_ANNOTATION_SPAN,
  cropWindow,
  imageFilter,
  orientedSize,
  type ImageEdit,
} from './imageEdit';

/**
 * A stroke colour the 2-D canvas can paint. A board pen may hold a theme token
 * (`var(--indigo-bright)`), which a canvas cannot resolve — so it is read from the live
 * theme here, at render time, rather than baked in as a literal. A chosen swatch is
 * already a concrete colour and passes through.
 */
function paintableColor(color: string): string {
  return resolveExportColor(color);
}

export interface ImageSourceSize { width: number; height: number }

function paintStroke(ctx: CanvasRenderingContext2D, stroke: CanvasStroke): void {
  const color = paintableColor(stroke.stroke);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.tool === 'highlighter' ? stroke.strokeWidth * HIGHLIGHTER_WIDTH_FACTOR : stroke.strokeWidth;
  if (stroke.tool === 'highlighter') ctx.globalAlpha = HIGHLIGHTER_OPACITY;
  if (stroke.tool === 'text') {
    ctx.font = `${Math.max(12, stroke.strokeWidth * 5)}px system-ui, sans-serif`;
    ctx.fillText(stroke.text ?? '', stroke.points[0]!.x, stroke.points[0]!.y);
  } else if (stroke.tool === 'rect') {
    const box = strokeRect(stroke);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
  } else if (stroke.tool === 'ellipse') {
    const box = strokeRect(stroke);
    ctx.beginPath();
    ctx.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const path = stroke.tool === 'line' ? [stroke.points[0]!, stroke.points[stroke.points.length - 1]!] : stroke.points;
    ctx.beginPath();
    path.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * @param image    a decoded image (or any canvas image source)
 * @param natural  its natural size
 * @param maxEdge  longest edge of the result in pixels — omit for full resolution
 */
export function renderImageEdit(image: CanvasImageSource, natural: ImageSourceSize, edit: ImageEdit, maxEdge?: number): HTMLCanvasElement {
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(natural.width, natural.height)) : 1;
  const width = Math.max(1, Math.round(natural.width * scale));
  const height = Math.max(1, Math.round(natural.height * scale));
  const oriented = orientedSize(width, height, edit.rotation);

  const stage = document.createElement('canvas');
  stage.width = oriented.width;
  stage.height = oriented.height;
  const stageContext = stage.getContext('2d');
  if (!stageContext) throw new Error('Canvas 2D is unavailable');
  stageContext.filter = imageFilter(edit.adjust);
  stageContext.translate(oriented.width / 2, oriented.height / 2);
  stageContext.rotate((edit.rotation * Math.PI) / 180);
  stageContext.scale(edit.flipX ? -1 : 1, edit.flipY ? -1 : 1);
  stageContext.drawImage(image, -width / 2, -height / 2, width, height);

  const window = cropWindow(oriented.width, oriented.height, edit.crop);
  const output = document.createElement('canvas');
  output.width = window.width;
  output.height = window.height;
  const context = output.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  context.drawImage(stage, window.x, window.y, window.width, window.height, 0, 0, window.width, window.height);

  if (edit.strokes.length) {
    context.scale(window.width / IMAGE_ANNOTATION_SPAN, window.width / IMAGE_ANNOTATION_SPAN);
    edit.strokes.forEach((stroke) => paintStroke(context, stroke));
  }
  return output;
}

export function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded'))), mimeType, quality);
  });
}
