import { memo, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { DrawingPenTray } from '@/components/drawing/DrawingPenTray';
import { DEFAULT_DRAWING_PREFERENCES, writeDrawingPreferences, type DrawingPreferences } from '../drawingPreferences';
import styles from '../styles/stage.module.css';

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
  return <DrawingPenTray className={styles.drawingToolbar} pen={drawing} onChoose={choose}>
    <button type="button" className={styles.drawingDone} onClick={() => setDrawing(null)}>{t('stopDrawing')}</button>
  </DrawingPenTray>;
});
