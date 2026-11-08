import { memo, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { DRAWING_TOOLS, type DrawingPen } from '@/lib/canvasDrawing';
import { resolveExportColor } from '@/lib/creation/exportColors';
import { DRAWING_TOOL_GLYPH } from './drawingConstants';
import styles from './drawingPenTray.module.css';

export interface DrawingPenTrayProps {
  pen: DrawingPen;
  /** Merge a choice into the pen in hand. */
  onChoose: (patch: Partial<DrawingPen>) => void;
  /** Host-specific trailing controls (the canvas's "done", the block's "clear"). */
  children?: ReactNode;
  className?: string;
}

/**
 * The pen tray: tool, colour, width. The ONE implementation — the canvas stage
 * parks it over the board (`CanvasDrawingToolbar`) and the knowledge drawing
 * block shows it inline. Labels reuse the `creationCanvas.drawing.*` strings.
 */
export const DrawingPenTray = memo(function DrawingPenTray({ pen, onChoose, children, className }: DrawingPenTrayProps) {
  const t = useTranslations('creationCanvas');
  // `<input type="color">` cannot show a CSS variable, and a default pen IS one. Its swatch
  // reads the `--export-pen-fallback` role once mounted (SSR has no document to read).
  const [fallbackHex, setFallbackHex] = useState('');
  useEffect(() => setFallbackHex(resolveExportColor('penFallback')), []);
  return <div className={[styles.tray, className].filter(Boolean).join(' ')} role="toolbar" aria-label={t('drawing.toolbar')}>
    {DRAWING_TOOLS.map((tool) => <button
      key={tool}
      type="button"
      aria-pressed={pen.tool === tool}
      title={t(`drawing.tool.${tool}` as 'drawing.tool.pen')}
      aria-label={t(`drawing.tool.${tool}` as 'drawing.tool.pen')}
      onClick={() => onChoose({ tool })}
    ><span aria-hidden>{DRAWING_TOOL_GLYPH[tool]}</span><b>{t(`drawing.tool.${tool}` as 'drawing.tool.pen')}</b></button>)}
    <label className={styles.color}>{t('drawing.color')}<input
      type="color"
      value={pen.color.startsWith('#') ? pen.color : fallbackHex}
      onChange={(event) => onChoose({ color: event.target.value })}
    /></label>
    <label className={styles.width}>{t('drawing.width')}<input
      type="range" min="1" max="12" value={pen.width}
      onChange={(event) => onChoose({ width: Number(event.target.value) })}
    /></label>
    {children}
  </div>;
});
