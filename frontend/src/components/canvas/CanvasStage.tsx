'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CreationCanvas } from '@/components/creation-canvas/CreationCanvas';
import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { useOptionalLiveSession } from '@/lib/live/LiveSessionContext';
import { isStageRoute } from '@/lib/workbenchPolicy';
import styles from './CanvasStage.module.css';

/**
 * The stage — the board, mounted ONCE and kept.
 *
 * Navigating to a docked page hides this rather than unmounting it, so the board
 * (and the Brain turn running on it, and the presence poll, and the unsaved
 * viewport) survives the trip. Hidden with `visibility` rather than `display`
 * deliberately: `display:none` collapses the element to zero size, and React Flow
 * would have to re-measure and re-fit the viewport on every return — the person
 * would come back to a board that had quietly moved.
 *
 * ONE DELIBERATE DEVIATION from the design doc. Switching to a DIFFERENT canvas
 * remounts the board (the stage keys on the session id). The doc says the board
 * should swap inside the mounted stage with no remount; in this codebase the
 * canvas holds ~50 pieces of per-board state whose only reset path is a mount, so
 * a keyless swap would carry board A's revision counter, save baseline and room
 * hydration flag into board B — and the first debounce would push A's graph over
 * B. The remount is confined to an explicit canvas SWITCH; the thing the design
 * is actually buying — a board that survives navigation — is fully delivered.
 */
export function CanvasStage() {
  const t = useTranslations('canvasStage');
  const pathname = usePathname() || '';
  const canvas = useOptionalActiveCanvas();
  const scope = useOptionalProjectScope();
  const live = useOptionalLiveSession();

  const active = canvas?.active ?? null;
  const onStage = isStageRoute(pathname);

  // Presentation mode is shell state now, so leaving the board no longer ends the
  // presentation — but arriving at a board via `?present=1` still has to arm it.
  const present = active?.present ?? false;
  const setPresentMode = live?.setPresentMode;
  useEffect(() => {
    if (present && setPresentMode) setPresentMode(true);
  }, [present, setPresentMode]);

  if (!active) return null;

  // "Viewing outside the current project" — the chip the scope policy promises in
  // place of closing a board the person did not ask to put away.
  const currentProjectId = scope?.currentProjectId ?? null;
  const boardProjects = canvas?.projectIds ?? [];
  const outOfScope = currentProjectId != null
    && boardProjects.length > 0
    && !boardProjects.includes(currentProjectId);

  return (
    <div
      className={`stage-split__stage ${styles.stage}`}
      data-visible={onStage ? 'true' : 'false'}
      // Hidden means hidden: a board behind a docked page must be out of the tab
      // order and out of the accessibility tree, not merely invisible.
      aria-hidden={onStage ? undefined : 'true'}
      inert={onStage ? undefined : true}
    >
      {outOfScope && onStage && (
        <p className={styles.outOfScope} role="status">{t('outsideCurrentProject')}</p>
      )}
      <CreationCanvas
        key={`${active.persistence}:${active.sessionId}`}
        sessionId={active.sessionId}
        persistence={active.persistence}
        initialFocusId={active.focusId}
        initialShareOpen={active.shareOpen}
        initialPresent={active.present}
      />
    </div>
  );
}
