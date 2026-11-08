import { useState } from 'react';
import { DRAWING_BLOCK_HEIGHT, DRAWING_BLOCK_WIDTH } from '@/domains/collab/domain/blockDocument';
import { canvasStrokes, clampDrawingDimension, drawingHasRoom, MAX_STROKES, type DrawingPen } from '@/lib/canvasDrawing';
import { DrawingPenTray } from '@/components/drawing/DrawingPenTray';
import { DrawingSurface } from '@/components/drawing/DrawingSurface';
import { useConfirm } from '@/components/ConfirmProvider';
import type { BlockRendererProps } from './blockRenderers';
import { gutterButtonStyle } from './blockStyles';

/** `currentColor` reads on the light and the dark surface alike. */
const DEFAULT_PEN: DrawingPen = { tool: 'pen', color: 'currentColor', width: 3 };

/**
 * A drawing inside a document. Strokes are the canvas's own stroke shape, drawn
 * and erased by `DrawingSurface` (which shares the canvas stage's stroke capture);
 * the pen tray is the canvas's `DrawingPenTray`. The pen in hand is local state;
 * the marks live on the block and are edited as individual stroke operations
 * (`strokeOps`), so two people drawing at once both keep their strokes.
 *
 * Strings come through the editor's `t` (the `knowledge` namespace), exactly as
 * `MediaBlockCard` receives it — `blocks.drawing.*`.
 */
export function DrawingBlock({ block, readOnly, onFocus, strokeOps, t }: BlockRendererProps) {
  const confirm = useConfirm();
  const [pen, setPen] = useState<DrawingPen>(DEFAULT_PEN);
  const strokes = canvasStrokes({ strokes: block.attrs.strokes ?? [] });
  const width = clampDrawingDimension(block.attrs.width, DRAWING_BLOCK_WIDTH);
  const height = clampDrawingDimension(block.attrs.height, DRAWING_BLOCK_HEIGHT);
  const full = !drawingHasRoom(strokes);
  const texts = strokes.filter((stroke) => stroke.tool === 'text' && stroke.id);

  const clear = async () => {
    if (!(await confirm({ message: t('blocks.drawing.clearConfirm'), confirmLabel: t('blocks.drawing.clear'), destructive: true }))) return;
    strokeOps.clear();
  };

  return (
    <div onClick={onFocus} onFocus={onFocus} style={{ flex: 1, minWidth: 0, display: 'grid', gap: 8 }}>
      {!readOnly && (
        <DrawingPenTray pen={pen} onChoose={(patch) => setPen((current) => ({ ...current, ...patch }))}>
          {strokes.length > 0 && (
            <button type="button" style={{ ...gutterButtonStyle, width: 'auto', height: 'auto', minHeight: 44, padding: '4px 10px', marginLeft: 'auto' }} onClick={() => void clear()}>
              {t('blocks.drawing.clear')}
            </button>
          )}
        </DrawingPenTray>
      )}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <DrawingSurface
          strokes={strokes}
          pen={pen}
          width={width}
          height={height}
          onStrokeAdded={(stroke) => { if (!full) strokeOps.append([stroke]); }}
          onStrokesErased={strokeOps.remove}
          readOnly={readOnly}
          ariaLabel={t('blocks.drawing.surface', { count: strokes.length })}
          emptyHint={readOnly ? t('blocks.drawing.empty') : t('blocks.drawing.emptyHint')}
        />
      </div>
      {!readOnly && full && (
        <div role="status" style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('blocks.drawing.limit', { max: MAX_STROKES })}</div>
      )}
      {!readOnly && texts.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          {texts.map((stroke) => (
            <input
              key={stroke.id}
              value={stroke.text ?? ''}
              maxLength={500}
              aria-label={t('blocks.drawing.textLabel')}
              placeholder={t('blocks.drawing.textPlaceholder')}
              onChange={(event) => strokeOps.update(stroke.id!, { text: event.target.value })}
              // A tap that was never typed into leaves no mark (and no slot against the cap).
              onBlur={(event) => { if (!event.target.value.trim()) strokeOps.remove([stroke.id!]); }}
              style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'inherit', fontSize: 'var(--font-size-small)' }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
