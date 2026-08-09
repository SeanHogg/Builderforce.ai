'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CreationCanvas } from '@/components/creation-canvas/CreationCanvas';
import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { useOptionalLiveSession } from '@/lib/live/LiveSessionContext';
import { isStageRoute, panelOpen } from '@/lib/workbenchPolicy';
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
 * Switching boards also keeps both instances mounted. This is intentionally a
 * small board-instance cache rather than a keyless prop swap: CreationCanvas has
 * substantial board-local state, and preserving an instance per identity keeps
 * that state isolated without copying board A's save baseline into board B.
 */
export function CanvasStage() {
  const t = useTranslations('canvasStage');
  const pathname = usePathname() || '';
  const canvas = useOptionalActiveCanvas();
  const scope = useOptionalProjectScope();
  const live = useOptionalLiveSession();

  const active = canvas?.active ?? null;
  const onStage = isStageRoute(pathname);
  // The board is on screen for a stage route AND behind an open panel — "the
  // panel slides OVER a board that stays mounted" (PRD 21 §0) only reads as true
  // if the board is actually visible under it. A route that keeps the whole
  // screen (the IDE, a single project) still takes it; the board waits, mounted.
  const shown = onStage || panelOpen(pathname, active != null);

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
      data-visible={shown ? 'true' : 'false'}
      // Visible is not the same as reachable: a board under an open panel is
      // seen but must be out of the tab order and out of the accessibility tree
      // while the panel owns the interaction, and a board behind a full-screen
      // route is neither seen nor reachable.
      aria-hidden={onStage ? undefined : 'true'}
      inert={onStage ? undefined : true}
    >
      {outOfScope && onStage && (
        <p className={styles.outOfScope} role="status">{t('outsideCurrentProject')}</p>
      )}
      {(canvas?.opened ?? [active]).map((board) => {
        const selected = board.sessionId === active.sessionId && board.persistence === active.persistence;
        return (
          <div
            key={`${board.persistence}:${board.sessionId}`}
            className={styles.board}
            data-active={selected ? 'true' : 'false'}
            aria-hidden={selected ? undefined : 'true'}
            inert={selected ? undefined : true}
          >
            <CreationCanvas
              sessionId={board.sessionId}
              persistence={board.persistence}
              initialFocusId={board.focusId}
              initialShareOpen={board.shareOpen}
              initialBuildOpen={board.buildOpen}
              initialPrompt={board.prompt}
              initialPresent={board.present}
              initialModelComparisonIds={board.modelComparisonIds}
              // Only the selected board answers a shell-level request — a
              // teammate joined from the footer must land on the board being
              // looked at, not on every cached instance behind it.
              stageActive={selected}
            />
          </div>
        );
      })}
    </div>
  );
}
