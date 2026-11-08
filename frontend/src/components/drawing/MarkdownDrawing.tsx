import { useTranslations } from 'next-intl';
import { DRAWING_BLOCK_HEIGHT, DRAWING_BLOCK_WIDTH, parseDrawingPayload } from '@/domains/collab/domain/blockDocument';
import { StrokeShapes } from './StrokeShapes';

/**
 * A `bf-drawing` fenced block, drawn. The page editor stores a drawing as that fence
 * (see `blockDocument.ts`); a read-only viewer — the preview, a shared page — should see
 * the picture, not a line of JSON. A fence we cannot read falls through to a plain
 * `<pre>` so no content is hidden.
 *
 * Loaded lazily by `DocumentMarkdown` (only when a page actually holds a drawing), so the
 * drawing model and its renderer stay out of every first paint.
 */
export function ReadOnlyDrawing({ json }: { json: string }) {
  const t = useTranslations('knowledge.blocks.drawing');
  const drawing = parseDrawingPayload(json);
  if (!drawing) return <pre><code>{json}</code></pre>;
  const width = drawing.width ?? DRAWING_BLOCK_WIDTH;
  const height = drawing.height ?? DRAWING_BLOCK_HEIGHT;
  const strokes = drawing.strokes ?? [];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('surface', { count: strokes.length })} style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: `${width} / ${height}`, color: 'var(--text-primary)', background: 'var(--surface-2)', borderRadius: 'var(--radius-md)' }}>
      <StrokeShapes strokes={strokes} minTextSize={12 * Math.max(1, width / 360)} />
    </svg>
  );
}
