/*
 * No `'use client'` here on purpose. This is imported only by `CreationCanvas.tsx`, which
 * already declares the boundary, so a directive would mark a second entry point that does
 * not exist — and `check-frontend-architecture` counts directives, not components. Its own
 * header says it: the directive is sometimes the bug.
 */
import { useTranslations } from 'next-intl';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import styles from './CreationCanvas.module.css';
import { creationObjectSurface } from './creationObjectSurfaces';
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
 */

export interface CanvasObjectSurfaceButtonProps {
  data: CreationNodeData;
  onOpen: (surface: CanvasSurfaceId) => void;
}

export function CanvasObjectSurfaceButton({ data, onOpen }: CanvasObjectSurfaceButtonProps) {
  const t = useTranslations('creationCanvas');
  const surface = creationObjectSurface(data.kind);
  if (!surface) return null;

  const label = t(`surface.${surface}.open` as 'surface.page.open');
  return (
    <button
      type="button"
      className={styles.objectSurfaceOpen}
      onClick={() => onOpen(surface)}
      aria-label={label}
      title={label}
      data-testid={`open-${surface}-surface`}
    >{label}</button>
  );
}
