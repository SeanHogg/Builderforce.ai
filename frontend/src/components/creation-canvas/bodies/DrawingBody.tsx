import { useTranslations } from 'next-intl';
import type { CreationNodeData } from '../types';
import styles from '../CreationCanvas.module.css';
import { canvasStrokes, HIGHLIGHTER_OPACITY, HIGHLIGHTER_WIDTH_FACTOR, strokePathD, strokeRect } from '@/lib/canvasDrawing';
import type { CreationBodyProps } from './types';
import { useCreationNodeActions } from './nodeActions';

/**
 * A drawing: every stroke that was made on it, in the tool that made it.
 *
 * It renders as live SVG rather than an image because the marks are data now —
 * a highlighter is a wide translucent pen, a shape is a shape, and a text
 * annotation is text that can still be corrected without redrawing it.
 */
export function DrawingBody({ data }: CreationBodyProps) {
  const { edit: onEdit } = useCreationNodeActions();
  const t = useTranslations('creationCanvas.node');
  const strokes = canvasStrokes(data);
  const width = Number(data.drawingWidth) || 240;
  const height = Number(data.drawingHeight) || 120;
  const annotating = typeof data.annotatesId === 'string' && data.annotatesId.length > 0;
  const texts = strokes.map((stroke, index) => ({ stroke, index })).filter((entry) => entry.stroke.tool === 'text');
  const editText = (index: number, text: string) => onEdit?.({ strokes: strokes.map((stroke, at) => at === index ? { ...stroke, text } : stroke) } as Partial<CreationNodeData>);

  return <div className={styles.drawingBody} data-annotation={annotating || undefined}>
    {!annotating && <div className={styles.widgetContext}><span><small>{t('stroke')}</small><b>{t('strokeCount', { count: strokes.length })}</b></span></div>}
    <svg className={styles.drawingSurface} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={data.title} preserveAspectRatio="xMidYMid meet">
      {strokes.length ? strokes.map((stroke, index) => {
        const key = `${stroke.tool}-${index}`;
        const common = {
          stroke: stroke.stroke,
          strokeWidth: stroke.tool === 'highlighter' ? stroke.strokeWidth * HIGHLIGHTER_WIDTH_FACTOR : stroke.strokeWidth,
          strokeLinecap: 'round' as const,
          strokeLinejoin: 'round' as const,
          fill: 'none',
          ...(stroke.tool === 'highlighter' ? { opacity: HIGHLIGHTER_OPACITY } : {}),
        };
        if (stroke.tool === 'text') return <text key={key} x={stroke.points[0]!.x} y={stroke.points[0]!.y} fill={stroke.stroke} fontSize={Math.max(12, stroke.strokeWidth * 5)}>{stroke.text || ''}</text>;
        if (stroke.tool === 'rect') { const box = strokeRect(stroke); return <rect key={key} x={box.x} y={box.y} width={box.width} height={box.height} {...common} />; }
        if (stroke.tool === 'ellipse') { const box = strokeRect(stroke); return <ellipse key={key} cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} {...common} />; }
        return <path key={key} d={strokePathD(stroke)} {...common} />;
      }) : <text x="12" y="28" fill="currentColor">{t('drawHint')}</text>}
    </svg>
    {/* Text annotations are corrected here rather than by redrawing them. The
        row exists only when there is text AND the board is editable. */}
    {!!texts.length && onEdit && <div className={`${styles.drawingTexts} nodrag nowheel`} onClick={(event) => event.stopPropagation()}>
      {texts.map((entry) => <input
        key={`text-${entry.index}`}
        value={entry.stroke.text || ''}
        aria-label={t('annotationText')}
        placeholder={t('annotationPlaceholder')}
        onChange={(event) => editText(entry.index, event.target.value)}
      />)}
    </div>}
  </div>;
}
