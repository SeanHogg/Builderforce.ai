import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { useTranslations } from 'next-intl';
import { DRAWING_BLOCK_HEIGHT, DRAWING_BLOCK_WIDTH, parseDrawingPayload } from '@/domains/collab/domain/blockDocument';
import { StrokeShapes } from './StrokeShapes';

const DRAWING_LANGUAGE = 'language-bf-drawing';

/** The text of a node react-markdown renders a code block's body as. */
function textOf(node: ReactNode): string {
  return Children.toArray(node).map((child) => (typeof child === 'string' ? child : '')).join('');
}

function ReadOnlyDrawing({ json }: { json: string }) {
  const t = useTranslations('knowledge.blocks.drawing');
  const drawing = parseDrawingPayload(json);
  if (!drawing) return null;
  const width = drawing.width ?? DRAWING_BLOCK_WIDTH;
  const height = drawing.height ?? DRAWING_BLOCK_HEIGHT;
  const strokes = drawing.strokes ?? [];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('surface', { count: strokes.length })} style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: `${width} / ${height}`, color: 'var(--text-primary)', background: 'var(--surface-2)', borderRadius: 'var(--radius-md)' }}>
      <StrokeShapes strokes={strokes} minTextSize={12 * Math.max(1, width / 360)} />
    </svg>
  );
}

/**
 * A `bf-drawing` fenced block, drawn. The page editor stores a drawing as that fence
 * (see `blockDocument.ts`); a read-only viewer — the preview, a shared page — should see
 * the picture, not a line of JSON. Anything else (including a fence we cannot read) falls
 * through to the ordinary `<pre>` so no content is hidden.
 */
export const MARKDOWN_DRAWING_COMPONENTS: Components = {
  pre({ children, node: _node, ...rest }: ComponentProps<'pre'> & { node?: unknown }) {
    const code = Children.toArray(children).find(isValidElement) as { props?: { className?: string; children?: ReactNode } } | undefined;
    if (code?.props?.className?.split(/\s+/).includes(DRAWING_LANGUAGE)) {
      const json = textOf(code.props.children).trim();
      if (parseDrawingPayload(json)) return <ReadOnlyDrawing json={json} />;
    }
    return <pre {...rest}>{children}</pre>;
  },
};
