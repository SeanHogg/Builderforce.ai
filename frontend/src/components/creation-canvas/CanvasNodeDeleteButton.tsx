/*
 * No `'use client'` here on purpose — same reason as `CanvasObjectSurfaceButton`: this is
 * only ever rendered by `CreationNode`, inside the boundary `CreationCanvas` already
 * declares, and `check-frontend-architecture` counts directives rather than components.
 */
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { CreationNodeData } from './types';

/**
 * "Take this object off the board" — drawn on the card itself.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────────
 * Deleting was reachable ONLY by selecting an object and pressing Delete/Backspace. A
 * keyboard-only affordance on a canvas is an undiscoverable one: nothing on the card,
 * in its header row, or in the selection toolbar said the object could be removed at
 * all, so people who wanted a card gone had no way to find out that they could. Every
 * other thing a card can do (schedule it, open its settings, minimise it, open it at
 * full size) is a visible control in the same row; removal was the one that was not.
 *
 * ── IT DECIDES ITS OWN VISIBILITY ────────────────────────────────────────────────
 * Absent `onDelete` the board cannot be edited at all — a viewer's card, or one held by
 * an editing lock — and it draws nothing, exactly as the density toggle and the insert
 * button do. A LOCKED object is different: the object is there, it is deletable, and the
 * lock is a state the person can lift. So it renders DISABLED and says why, rather than
 * disappearing and leaving "why can I delete that card and not this one" unanswered.
 *
 * ── NO CONFIRMATION ──────────────────────────────────────────────────────────────
 * Deliberate: a delete on this board is one entry deep in the canvas history and comes
 * straight back with undo, and the notice the board raises says so. A modal here would
 * also be a second answer to a question the Delete key has always answered without one.
 */

export interface CanvasNodeDeleteButtonProps {
  nodeId: string;
  data: CreationNodeData;
  /** Remove this object and every connection into or out of it. Absent on a board this
   *  person cannot edit, which is what makes the control absent rather than inert. */
  onDelete?: (nodeId: string) => void;
  /** The icon-slot class of whichever row this is drawn in — the card header and the
   *  minimised orb style their slots differently, and neither is this component's
   *  business to know. */
  className?: string;
}

export function CanvasNodeDeleteButton({ nodeId, data, onDelete, className }: CanvasNodeDeleteButtonProps) {
  const t = useTranslations('creationCanvas.node');
  if (!onDelete) return null;

  const locked = data.placementLocked === true;
  const label = locked ? t('deleteLocked', { title: data.title }) : t('deleteObject', { title: data.title });
  return (
    <button
      type="button"
      {...(className ? { className } : {})}
      data-testid={`canvas-node-delete-${nodeId}`}
      disabled={locked}
      aria-label={label}
      title={label}
      onClick={(event) => { event.stopPropagation(); onDelete(nodeId); }}
    ><Icon name="trash" size={14} /></button>
  );
}
