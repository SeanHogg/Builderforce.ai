// No 'use client' directive: rendered only inside `CreationCanvas`, which already
// declares the boundary — the same reason `CanvasSessionActions` states at its top.
import { useTranslations } from 'next-intl';
import type { CanvasSessionActionId } from '@/lib/canvasSessionActions';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { CanvasMenuSheet } from './CanvasMenuSheet';
import {
  CanvasSessionActions,
  type CanvasBarGroupSlots,
  type CanvasSessionActionHandler,
} from './CanvasSessionActions';
import styles from './CreationCanvas.module.css';

/**
 * THE PHONE'S COMMAND BAR, as one sheet.
 *
 * ── WHAT IT REPLACES ─────────────────────────────────────────────────────────────
 * A 360px screen used to get the desktop bar with most of it standing down: the
 * captions hidden, the troughs flattened, every action the registry marked
 * `phone: 'menu'` set to `display:none`, and the survivors scrolling sideways in a
 * strip 40px tall pinned above a composer pinned above a persistent bottom nav. Three
 * layers of chrome competing for the space left over the work, and a set of commands
 * you could only find by dragging a row horizontally with no indication that there was
 * anything to the right of it.
 *
 * So on a phone the "+" in the composer IS the command bar. One sheet, opened
 * deliberately, holding the SAME arc groups under the SAME captions — Idea, Make, Run,
 * Measure, Reach, Board — as 44px worded tiles. Every action in the registry is in it.
 * Nothing scrolls sideways; the sheet scrolls down, which is the direction a thumb
 * already expects on a phone.
 *
 * ── WHY IT IS NOT A SECOND RENDERING OF THE BAR ──────────────────────────────────
 * It is `CanvasSessionActions` in its `tiles` chrome, which is the same loop over
 * `CANVAS_BAR_GROUP_ORDER` the bar runs and the same `CanvasBarGroup` drawing the same
 * caption from the same registry row. That is the whole reason the phone's captions
 * cannot drift from the desktop's: there is one caption resolution, in one component,
 * and both chromes go through it.
 *
 * ── WHY THE HOST'S SLOTS COME IN ─────────────────────────────────────────────────
 * Some doors are not registry actions — the object palette's own door needs the
 * button's screen rect to open above itself, so the chrome that draws the button owns
 * it. The host contributes those through `CanvasBarGroupSlots`, the SAME seam the
 * command bar uses, so a contribution cannot reach one chrome and miss the other.
 */
export interface CanvasActionsSheetProps {
  /** The surface being read — the registry drops the actions it cannot answer. */
  surface: CanvasSurfaceId;
  handlers: Record<CanvasSessionActionId, CanvasSessionActionHandler>;
  /** What the host puts into each named group, beside what the registry files there. */
  slots?: CanvasBarGroupSlots;
  onClose: () => void;
}

export function CanvasActionsSheet({ surface, handlers, slots, onClose }: CanvasActionsSheetProps) {
  const t = useTranslations('creationCanvas');

  return (
    <>
      {/* The veil, stopping at the canvas app bar: the bar and the surface strip stay
          LIVE underneath it, so a reader who opened the actions can still leave the
          canvas or change surface without dismissing them first. Tapping it closes,
          which is the gesture a bottom sheet already teaches. Shared with the Brain
          sheet (`.canvasSheetVeil`), because one sheet's veil and another's are the
          same statement about the same surface. */}
      <button
        type="button"
        className={styles.canvasSheetVeil}
        data-testid="canvas-actions-veil"
        aria-label={t('closeActions')}
        onClick={onClose}
      />
      <CanvasMenuSheet title={t('actions')} testId="canvas-actions-sheet" placement="sheet" onClose={onClose}>
      <div className={styles.actionsSheetBody}>
        <CanvasSessionActions
          variant="tiles"
          surface={surface}
          handlers={handlers}
          {...(slots ? { groupSlots: slots } : {})}
        />
      </div>
      </CanvasMenuSheet>
    </>
  );
}
