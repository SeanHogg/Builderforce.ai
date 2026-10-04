import { memo } from 'react';
import { useTranslations } from 'next-intl';
import type { CreationFlowNode } from '../CreationNode';
import { useCanvasSessionFacts } from '../chrome/canvasSessionContext';
import styles from '../CreationCanvas.module.css';

export interface CanvasSelectionToolbarProps {
  presentMode: boolean;
  /** The objects are on screen and workable — see `objectsOnScreen` in the host. */
  objectsOnScreen: boolean;
  selectedIds: readonly string[];
  nodes: readonly CreationFlowNode[];
  onFocus: () => void;
  onDuplicate: () => void;
  onAlign: () => void;
  onFrame: () => void;
  onTogglePlacementLock: () => void;
  onToggleHidden: () => void;
  onDelete: () => void;
}

/**
 * Chrome ABOUT the objects on this canvas — what is selected. It gates on whether the
 * objects are on screen at all, not on which surface is drawn: the 3D space shows them
 * and keeps it, the conversation shows none and would otherwise float a toolbar for
 * things the reader cannot see.
 */
export const CanvasSelectionToolbar = memo(function CanvasSelectionToolbar({ presentMode, objectsOnScreen, selectedIds, nodes, onFocus, onDuplicate, onAlign, onFrame, onTogglePlacementLock, onToggleHidden, onDelete }: CanvasSelectionToolbarProps) {
  const t = useTranslations('creationCanvas');
  const { canEdit } = useCanvasSessionFacts();
  if (presentMode || !objectsOnScreen || selectedIds.length === 0) return null;
  return <div className={styles.selectionToolbar} aria-label={t('selectionActions')}>
          <span>{t('selectedCount', { count: selectedIds.length })}</span>
          <button onClick={onFocus}>{t('focus')}</button>
          <button onClick={onDuplicate} disabled={!canEdit}>{t('duplicate')}</button>
          {selectedIds.length > 1 && <button onClick={onAlign} disabled={!canEdit}>{t('align')}</button>}
          {selectedIds.length > 1 && <button onClick={onFrame} disabled={!canEdit}>{t('frame')}</button>}
          <button onClick={onTogglePlacementLock} disabled={!canEdit}>{selectedIds.some((id) => nodes.find((node) => node.id === id)?.data.placementLocked !== true) ? t('lock') : t('unlock')}</button>
          <button onClick={onToggleHidden} disabled={!canEdit}>{t('hide')}</button>
          {/* The one action a person reaches for that this bar did not offer. It has to
              be HERE and not only on the card, because the kinds with no header row of
              their own — a sticky, an annotation, a docked conversation — have nowhere
              to draw a trash, and a selection of twelve objects has no single card to
              press it on. Last in the row and styled apart: the destructive one should
              not be adjacent to Duplicate by accident. */}
          <button className={styles.selectionDelete} onClick={onDelete} disabled={!canEdit} data-testid="canvas-selection-delete">{t('delete')}</button>
        </div>;
});
