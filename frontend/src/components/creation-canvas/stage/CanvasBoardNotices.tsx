import { memo } from 'react';
import { useTranslations } from 'next-intl';
import type { CreationFlowNode } from '../CreationNode';
import { useCanvasSessionFacts } from '../chrome/canvasSessionContext';
import styles from '../CreationCanvas.module.css';

/** A file is being dragged over the board from outside the browser. */
export const CanvasFileDropOverlay = memo(function CanvasFileDropOverlay({ active }: { active: boolean }) {
  const t = useTranslations('creationCanvas');
  const { canEdit } = useCanvasSessionFacts();
  if (!active) return null;
  return <div className={styles.fileDropOverlay} role="status" aria-live="polite">
          <div>
            <span aria-hidden>⇩</span>
            <strong>{canEdit ? t('dropFilesTitle') : t('roleCannotEdit')}</strong>
            {canEdit && <small>{t('dropFilesHint')}</small>}
          </div>
        </div>;
});

export interface CanvasFrameFocusBarProps {
  /** The section being worked on alone, or null on the whole board. */
  frameFocus: string | null;
  nodes: readonly CreationFlowNode[];
  memberIdsOf: (frameId: string) => readonly string[];
  onExit: () => void;
}

/**
 * You are inside a section, and here is the way out. A bar rather than a
 * dialog on purpose: the board is still the board, and every control that
 * worked a moment ago still works.
 */
export const CanvasFrameFocusBar = memo(function CanvasFrameFocusBar({ frameFocus, nodes, memberIdsOf, onExit }: CanvasFrameFocusBarProps) {
  const t = useTranslations('creationCanvas');
  if (!frameFocus) return null;
  return <div className={styles.frameFocusBar} role="status" data-testid="canvas-frame-focus">
          <b>{nodes.find((node) => node.id === frameFocus)?.data.title || t('frameSection.section')}</b>
          <span>{t('frameSection.holds', { count: memberIdsOf(frameFocus).length })}</span>
          <button type="button" onClick={onExit}>{t('frameSection.exit')}</button>
        </div>;
});

export const CanvasLoadingSkeleton = memo(function CanvasLoadingSkeleton({ loading }: { loading: boolean }) {
  const t = useTranslations('creationCanvas');
  if (!loading) return null;
  return <div className={styles.canvasSkeleton} role="status" aria-live="polite"><span /><span /><span /><b>{t('loadingSession')}</b></div>;
});

/** More than this many objects on screen is a board that is slow to work on. */
const LARGE_SESSION_OBJECTS = 100;

/** How many objects there are — chrome about the objects, so it gates on them being on screen. */
export const CanvasLargeSessionNotice = memo(function CanvasLargeSessionNotice({ objectsOnScreen, count, onFrame }: { objectsOnScreen: boolean; count: number; onFrame: () => void }) {
  const t = useTranslations('creationCanvas');
  if (!objectsOnScreen || count <= LARGE_SESSION_OBJECTS) return null;
  return <div className={styles.performanceNotice} role="status"><strong>{t('largeSession', { count })}</strong><span>{t('largeSessionHint')}</span><button type="button" onClick={onFrame}>{t('frame')}</button></div>;
});
