import { memo, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { DRAWING_TOOLS } from '@/lib/canvasDrawing';
import { DEFAULT_DRAWING_PREFERENCES, writeDrawingPreferences, type DrawingPreferences } from '../drawingPreferences';
import { DRAWING_FALLBACK_HEX, DRAWING_TOOL_GLYPH } from '../canvasNodeHelpers';
import styles from '../CreationCanvas.module.css';

export interface CanvasDrawingToolbarProps {
  /** The pen in hand, or null while the pointer pans and selects. */
  drawing: DrawingPreferences | null;
  setDrawing: Dispatch<SetStateAction<DrawingPreferences | null>>;
}

/**
 * The pen tray. It exists only while drawing is on, and every choice on
 * it is made BEFORE the stroke — which is the difference between a
 * drawing tool and a colour picker you find afterwards in a side panel.
 */
export const CanvasDrawingToolbar = memo(function CanvasDrawingToolbar({ drawing, setDrawing }: CanvasDrawingToolbarProps) {
  const t = useTranslations('creationCanvas');
  if (!drawing) return null;
  /** Every choice persists, because marking up a board is twenty strokes in a row. */
  const choose = (patch: Partial<DrawingPreferences>) => setDrawing((current) => { const next = { ...(current ?? DEFAULT_DRAWING_PREFERENCES), ...patch }; writeDrawingPreferences(next); return next; });
  return <div className={styles.drawingToolbar} role="toolbar" aria-label={t('drawing.toolbar')}>
          {DRAWING_TOOLS.map((tool) => <button
            key={tool}
            type="button"
            aria-pressed={drawing.tool === tool}
            title={t(`drawing.tool.${tool}` as 'drawing.tool.pen')}
            onClick={() => choose({ tool })}
          ><span aria-hidden>{DRAWING_TOOL_GLYPH[tool]}</span><b>{t(`drawing.tool.${tool}` as 'drawing.tool.pen')}</b></button>)}
          <label className={styles.drawingColor}>{t('drawing.color')}<input
            type="color"
            value={drawing.color.startsWith('#') ? drawing.color : DRAWING_FALLBACK_HEX}
            onChange={(event) => choose({ color: event.target.value })}
          /></label>
          <label className={styles.drawingWidth}>{t('drawing.width')}<input
            type="range" min="1" max="12" value={drawing.width}
            onChange={(event) => choose({ width: Number(event.target.value) })}
          /></label>
          <button type="button" className={styles.drawingDone} onClick={() => setDrawing(null)}>{t('stopDrawing')}</button>
        </div>;
});
