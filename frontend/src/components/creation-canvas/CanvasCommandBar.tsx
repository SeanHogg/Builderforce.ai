'use client';

import { useTranslations } from 'next-intl';
import { CollapseBarIcon, ExpandBarIcon, RunCanvasIcon } from '@/components/canvas/CanvasCommands';
import { canvasChromeShows } from '@/lib/canvasChrome';
import { CANVAS_QUICK_ADD } from '@/lib/canvasQuickAdd';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { CanvasSessionActionId } from '@/lib/canvasSessionActions';
import type { CreationObjectGroup } from './creationObjectRegistry';
import { CanvasSessionActions, type CanvasSessionActionHandler } from './CanvasSessionActions';
import styles from './CreationCanvas.module.css';

/**
 * THE bar. One floating card at the bottom of the canvas, holding everything you can do
 * to what you are looking at.
 *
 * ── WHY ONE BAR, AT THE BOTTOM ───────────────────────────────────────────────────
 * Because the canvas is the product and chrome across the top of it is rent. This board
 * used to spend a 54px session band plus a floating rail plus a phone action column on
 * controls, so a 900px-tall window gave the artefact about two thirds of itself and split
 * "what can I do" across three places that could each be scrolled, collapsed or hidden
 * independently. The scenario editors that people find easy to use all converged on the
 * same shape — the artefact takes the window, one bar floats over it — and they converged
 * on the bottom because that is where a hand rests and where a card can grow without
 * pushing the artefact down.
 *
 * ── WHAT DECIDES ITS CONTENTS ────────────────────────────────────────────────────
 * Not this component. Four registries do, and every one of them already existed:
 *
 *   `canvasSessionActions.ts` — which actions exist, which are a set, which reach a phone
 *   `canvasSurfaces.ts`       — which surface is being read, and what that surface has
 *   `canvasSurfaceActions`    — what the RUNTIME contributed (an app's Run, its readings,
 *                               the address it is running at)
 *   `canvasQuickAdd.ts`       — the six circles that open the palette
 *
 * So "the bar changes with the surface" is not a switch statement here: the App surface
 * publishes Run / Preview·Code·Console / the viewport switcher into the contribution seam
 * and this bar draws whatever it finds. A surface added next year gets a bar for free, and
 * cannot get a SECOND bar, which is the failure this replaced.
 *
 * ── RUN ──────────────────────────────────────────────────────────────────────────
 * Run is the first control on the bar and it is the one thing here that is not
 * contributed. On a surface that runs itself (App) the runtime publishes its own Run and
 * this one stands down — two Run buttons that can disagree about whether something is
 * running is worse than none. On the board, Run means "open the App surface and start
 * it", which is the honest answer to the question this whole redesign started from: a
 * canvas that could build a website but had no button that ran it.
 */

export interface CanvasCommandBarProps {
  surface: CanvasSurfaceId;
  collapsed: boolean;
  onToggleCollapse: () => void;
  handlers: Record<CanvasSessionActionId, CanvasSessionActionHandler>;
  /**
   * Take this board to the surface that runs it. Absent when the surface contributes its
   * own Run, and absent when there is nothing on the board to run — a Run button over an
   * empty canvas is a promise with nothing behind it.
   */
  onRun?: () => void;
  /** Opens the object palette focused on a group; no group means the palette whole. */
  onQuickAdd: (group?: CreationObjectGroup) => void;
  /** Whether the palette is open, so the circles can report it. */
  quickAddOpen: boolean;
  /** Who is in this session. Status, so it survives the collapse. */
  roster: React.ReactNode;
  /** The ••• sheet's trigger and whatever else the host keeps beside the actions. */
  extras?: React.ReactNode;
}

export function CanvasCommandBar({
  surface,
  collapsed,
  onToggleCollapse,
  handlers,
  onRun,
  onQuickAdd,
  quickAddOpen,
  roster,
  extras,
}: CanvasCommandBarProps) {
  const t = useTranslations('creationCanvas');
  const tQuick = useTranslations('creationCanvas.quickAdd');
  const showsActions = canvasChromeShows('actions', collapsed);
  // The circles add OBJECTS, so they belong to a surface that has objects to add them to.
  // Asked of the registry rather than listed here, for the same reason the session actions
  // ask it: a surface added later answers correctly without this file changing.
  const showsQuickAdd = showsActions && surface === 'graph';

  return (
    <div
      className={`${styles.floatCard} ${styles.commandBar}`}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-surface={surface}
      data-testid="canvas-command-bar"
      role="toolbar"
      aria-label={t('commandBar')}
    >
      {/* Run, when the surface does not run itself. Green rather than brand blue: it is
          the only control on this bar that STARTS something, and the board's accent is
          already spent on "which surface am I on". */}
      {onRun && showsActions && <button
        type="button"
        className={styles.runButton}
        data-testid="canvas-run"
        title={t('runCanvasTitle')}
        onClick={onRun}
      ><RunCanvasIcon /><span>{t('runCanvas')}</span></button>}

      {/* The surface's own report and controls, then the glyph clusters. One component,
          because which of those survive a collapse is one table and not three. */}
      <CanvasSessionActions variant="bar" surface={surface} collapsed={collapsed} handlers={handlers} />

      {extras}

      {/* Never folded. A collapsed roster is a team nobody can see is working, and this
          bar IS what is left after a collapse — so if the avatars were anywhere else the
          rule that keeps them would be a statement about an element that never folds. */}
      {canvasChromeShows('roster', collapsed) && <>
        <span className={styles.commandBarDivider} aria-hidden />
        {roster}
      </>}

      {showsQuickAdd && <>
        <span className={styles.commandBarDivider} aria-hidden />
        {/* Six circles, identified by colour because a glyph at 26px next to five other
            glyphs at 26px is a texture rather than a menu. The last one opens the palette
            whole, so the shortlist can never become the only way in. */}
        <div className={styles.quickAdd} role="group" aria-label={t('quickAddGroup')}>
          {CANVAS_QUICK_ADD.map((entry) => {
            const label = tQuick(entry.labelKey as 'build');
            return <button
              key={entry.id}
              type="button"
              data-testid={`canvas-quick-add-${entry.id}`}
              style={{ background: `var(${entry.tokenVar})` }}
              aria-pressed={quickAddOpen}
              aria-label={label}
              title={label}
              onClick={() => onQuickAdd(entry.group)}
            >{entry.group ? null : <span aria-hidden>+</span>}</button>;
          })}
        </div>
      </>}

      {/* The toggle is never hidden — a collapse with no way back is a one-way door — and
          it is last so the controls it removes vanish leftwards rather than jumping under
          the cursor that just pressed it. */}
      <button
        type="button"
        className={styles.commandBarCollapse}
        data-testid="canvas-bar-collapse"
        aria-pressed={collapsed}
        aria-label={collapsed ? t('expandBar') : t('collapseBar')}
        title={collapsed ? t('expandBar') : t('collapseBar')}
        onClick={onToggleCollapse}
      >{collapsed ? <ExpandBarIcon /> : <CollapseBarIcon />}</button>
    </div>
  );
}
