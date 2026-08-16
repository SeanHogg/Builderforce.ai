/*
 * No `'use client'` here on purpose. This is imported only by `CreationCanvas.tsx`, which
 * already declares the boundary, so a directive would mark a second entry point that does
 * not exist — and `check-frontend-architecture` counts directives, not components. Its own
 * header says it: the directive is sometimes the bug.
 */
import { useTranslations } from 'next-intl';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { creationObjectSurface } from './creationObjectSurfaces';
import { canvasSurfaceGlyph } from './canvasSurfaceIcons';
import type { CreationNodeData } from './types';

/**
 * "Open this at full size" — the one way into an object-scoped surface.
 *
 * It decides its own visibility from the registry rather than taking a `canOpen` boolean:
 * whether a kind has a surface is a fact about the kind (`creationObjectSurface`), and a
 * consumer that had to compute it would be a second place for the answer to live. A note,
 * a task and a metric get nothing here because a card IS the whole object.
 *
 * It is deliberately ONE control rather than three ("Open page" / "Play" / "Open
 * timeline"): every one of them means "give this object the canvas", and the surface's own
 * name is what changes. Three buttons would be three places to add a fourth runtime to.
 *
 * ── WHY IT IS A GLYPH AND NOT A WORD ─────────────────────────────────────────────
 * It renders into `.inspectorHeaderActions`, which is a row of 25×25 icon slots beside
 * the expand and close buttons. It used to draw its LABEL there — "Open the site" in a
 * 25px box — which overflowed the slot in every direction and printed itself across the
 * panel title, the close button and the tab strip underneath. It is a glyph now, from the
 * shared surface icon table, and the words survive as its accessible name and its
 * tooltip, so nothing is lost to a screen reader or to a hover.
 */

export interface CanvasObjectSurfaceButtonProps {
  data: CreationNodeData;
  onOpen: (surface: CanvasSurfaceId) => void;
  /** No class of its own by default: the chrome comes from `.inspectorHeaderActions
   *  button`, so this and the expand/close buttons beside it read as one row of slots.
   *  The card header — its OTHER caller — has no such ancestor rule and passes its own
   *  icon-slot class instead. */
  className?: string;
}

export function CanvasObjectSurfaceButton({ data, onOpen, className }: CanvasObjectSurfaceButtonProps) {
  const t = useTranslations('creationCanvas');
  const surface = creationObjectSurface(data.kind);
  if (!surface) return null;

  const label = t(`surface.${surface}.open` as 'surface.page.open');
  return (
    <button
      type="button"
      {...(className ? { className } : {})}
      onClick={(event) => { event.stopPropagation(); onOpen(surface); }}
      aria-label={label}
      title={label}
      data-testid={`open-${surface}-surface`}
    >{canvasSurfaceGlyph(surface, label)}</button>
  );
}
