import { withStrokeId, type CanvasStroke, type DrawingPen } from '@/lib/canvasDrawing';
import { DrawingSurface } from '@/components/drawing/DrawingSurface';
import styles from './ImageEditor.module.css';

export interface ImageAnnotateLayerProps {
  /** The annotation space of the current output (see `annotationSpace`); it is the surface's viewBox. */
  space: { width: number; height: number };
  strokes: readonly CanvasStroke[];
  pen: DrawingPen;
  label: string;
  onChange: (strokes: CanvasStroke[]) => void;
}

/**
 * The pen over the picture: the shared {@link DrawingSurface} laid transparently over the
 * preview, in the 1000-unit crop space the renderer paints annotations in. While it is
 * up it draws the strokes itself, so the preview canvas leaves them out (see
 * `useImageEditor`'s `annotating`).
 *
 * The surface emits stroke EVENTS; the image editor keeps its strokes in plain object
 * data, so this layer applies them as array updates. Strokes saved before ids existed
 * get a positional id for the surface (and for erasing) here.
 */
export function ImageAnnotateLayer({ space, strokes, pen, label, onChange }: ImageAnnotateLayerProps) {
  const identified = strokes.map((stroke, index) => (stroke.id ? stroke : { ...stroke, id: `s${index}` }));
  return <div className={styles.annotateLayer}>
    <DrawingSurface
      strokes={identified}
      pen={pen}
      width={space.width}
      height={space.height}
      ariaLabel={label}
      onStrokeAdded={(stroke) => onChange([...identified, withStrokeId(stroke)])}
      onStrokesErased={(ids) => onChange(identified.filter((stroke) => !ids.includes(stroke.id!)))}
    />
  </div>;
}
