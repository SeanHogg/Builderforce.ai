/*
 * No `'use client'` here on purpose. This is imported only by `CreationCanvas.tsx`, which
 * already declares the boundary, so a directive would mark a second entry point that does
 * not exist — and `check-frontend-architecture` counts directives, not components. Its own
 * header says it: the directive is sometimes the bug.
 */
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import styles from './CreationCanvas.module.css';
import { creationObjectDefinition, creationObjectName } from './creationObjectRegistry';
import type { CreationNodeData } from './types';

/**
 * The chrome every object-scoped surface wears — the frame around a page, a running build
 * and a multi-track edit alike.
 *
 * All three answer the same three questions: what object am I looking at, what medium is
 * it, and how do I get back to the board. Writing that header three times is how three
 * surfaces end up with three different ways home, so it is written once and each runtime
 * contributes only its body.
 *
 * The way back is deliberately a labelled control and not just the rail's surface
 * switcher: the switcher lists BOARD surfaces, and an object surface is not on it, so
 * without this there is a screen the user can reach and not leave.
 */

export interface CanvasObjectSurfaceProps {
  surface: CanvasSurfaceId;
  data: CreationNodeData;
  /** Hand the board back. Also what a bare Escape means on any of these surfaces. */
  onExit: () => void;
  /** Runtime-specific controls, rendered between the title and the exit. */
  actions?: ReactNode;
  children: ReactNode;
}

export function CanvasObjectSurface({ surface, data, onExit, actions, children }: CanvasObjectSurfaceProps) {
  const t = useTranslations('creationCanvas');
  const definition = creationObjectDefinition(data.kind);

  return (
    <section
      className={styles.objectSurface}
      data-surface={surface}
      aria-label={t('surface.objectLabel', { title: creationObjectName(data) })}
      data-testid={`canvas-${surface}-surface`}
      // Escape leaves, the way it leaves every other focus surface on this canvas. The
      // handler sits on the section rather than the document so it cannot steal the key
      // from a dialog opened on top of this one.
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onExit(); } }}
    >
      <header className={styles.objectSurfaceHeader}>
        <span className={styles.objectSurfaceMark} aria-hidden><Icon source={definition.icon} size="1em" /></span>
        <span className={styles.objectSurfaceTitle}>
          <strong>{creationObjectName(data)}</strong>
          <small>{t(`surface.${surface}.label` as 'surface.page.label')}</small>
        </span>
        {actions}
        <button type="button" className={styles.objectSurfaceExit} onClick={onExit}>
          {t('surface.backToBoard')}
        </button>
      </header>
      <div className={styles.objectSurfaceBody}>{children}</div>
    </section>
  );
}
