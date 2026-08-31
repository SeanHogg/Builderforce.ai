// No 'use client' directive: these are only ever rendered by `CreationCanvas`, which is
// already a client component, so the boundary is inherited and a second declaration here
// would only add another file to the architecture ratchet's client-component tally — the
// same reason `CanvasSessionActions` omits it.
import { useTranslations } from 'next-intl';
import { AddObjectIcon, ClosePaletteIcon, CollapseBarIcon, ExpandBarIcon, PromptIcon, RunCanvasIcon } from '@/components/canvas/CanvasCommands';
import { canvasChromeShows } from '@/lib/canvasChrome';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { CanvasSessionActionId } from '@/lib/canvasSessionActions';
import { mergeRefs } from '@/lib/mergeRefs';
import type { CreationObjectGroup } from './creationObjectRegistry';
import { CanvasSessionActions, type CanvasSessionActionHandler } from './CanvasSessionActions';
import { PanelDragHandle } from './PanelDragHandle';
import { usePanelDragOffset } from './usePanelDragOffset';
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
  /**
   * Opens the object picker. Always called with no group — the bar used to offer five
   * more circles that each pre-filtered a group, but a circle identified by colour alone
   * told nobody what pressing it did, so the shortlist collapsed into the one door it
   * always had for "show me everything". The button's own screen rect goes with the
   * call so the picker can open ABOVE the button that summoned it — this bar is at the
   * bottom of the window, so a popover placed below it is off-screen.
   */
  onQuickAdd: (group: CreationObjectGroup | undefined, anchor: DOMRect) => void;
  /** Whether the picker is open, so the button can report it. */
  quickAddOpen: boolean;
  /**
   * Move around the board — zoom, fit, arrange. Contributed by the host because React
   * Flow owns the viewport; drawn HERE because a second floating rail down the left edge
   * of the canvas was the last toolbar competing with this one.
   */
  view?: React.ReactNode;
  /** Show or hide the prompt. Absent while presenting, when there is nothing to ask. */
  onTogglePrompt?: () => void;
  promptOpen?: boolean;
  /**
   * Who is in this session RIGHT NOW — the live collaborators. Status, so it survives
   * the collapse.
   */
  roster: React.ReactNode;
  /**
   * Who is ALWAYS on — the hired seats and the invited team. A different fact from
   * `roster`, drawn beside it rather than merged into it: one answers "who is editing
   * this with me", the other "who works here". Both are status.
   *
   * This is the footer band the canvas used to carry as a fifth strip of chrome; the
   * component decides for itself that the band stands down on a stage route.
   */
  team?: React.ReactNode;
  /** The ••• sheet's trigger and whatever else the host keeps beside the actions. */
  extras?: React.ReactNode;
  /**
   * The door OUT of this canvas — Publish — plus the ••• overflow. Drawn behind its
   * own divider, after the roster, so it reads as a distinct GROUP rather than more
   * glyphs in the same run: a word opens somewhere else, a glyph acts here, and the
   * divider is what keeps saying so now that both live in one bar. See
   * `CreationCanvas.tsx`'s `handoffChrome` for why this moved out of the header.
   */
  handoff?: React.ReactNode;
  /**
   * The invite sheet Share opens — built by the host (it owns the session's member
   * list and the guest-room state) and handed down so it can render right beside the
   * roster's own trailing chip. It has to arrive as a prop rather than live inside
   * `handoff`: the panel anchors `right:0` against the nearest positioned ancestor,
   * and that has to be the button that opened it, not the doors-out group at the
   * other end of the bar.
   */
  inviteMenu?: React.ReactNode;
  /**
   * How tall this bar actually is, published to the shell as `--canvas-command-bar-space`
   * by whoever passes the ref — the band the prompt floats above.
   *
   * It is a MEASUREMENT and not a number this file could state, because the bar's height
   * is not this file's to know: a surface contributes Run, its readings and a width
   * switcher, the roster and the team band come and go, and the shell was carrying a
   * literal `66px` guess that the App surface's contribution overran by enough to draw
   * the bar straight over the prompt. See `useChromeSpace`.
   */
  hostRef?: (node: HTMLDivElement | null) => void;
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
  team,
  view,
  onTogglePrompt,
  promptOpen = true,
  extras,
  handoff,
  inviteMenu,
  hostRef,
}: CanvasCommandBarProps) {
  const t = useTranslations('creationCanvas');
  const showsActions = canvasChromeShows('actions', collapsed);
  // The button adds OBJECTS, so it belongs to a surface that has objects to add them to.
  // Asked of the registry rather than listed here, for the same reason the session actions
  // ask it: a surface added later answers correctly without this file changing.
  const showsQuickAdd = showsActions && surface === 'graph';
  // Own drag offset: this bar is one of the floating cards someone might want to pull
  // clear of the board, and it already owns the node `hostRef` measures, so the two
  // refs merge onto the same element rather than one hook borrowing the other's node.
  const drag = usePanelDragOffset('commandBar');

  return (
    <div
      ref={mergeRefs(hostRef, drag.elementRef)}
      className={`${styles.floatCard} ${styles.commandBar}`}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-surface={surface}
      data-testid="canvas-command-bar"
      role="toolbar"
      aria-label={t('commandBar')}
      style={drag.style}
    >
      <PanelDragHandle isMoved={drag.isMoved} {...drag.handleProps} />

      {/* Run, when the surface does not run itself. Green rather than brand blue: it is
          the only control on this bar that STARTS something, and the board's accent is
          already spent on "which surface am I on".

          The word on it is "Run" and its ACCESSIBLE NAME is "Run this canvas", which is
          not padding: a board can carry objects with run buttons of their own — a
          workflow widget offers "Run Fall campaign" — and a bare "Run" beside them is
          ambiguous to anyone reading the page by its names rather than its layout. The
          bar has the room to be specific; the button does not. */}
      {onRun && showsActions && <button
        type="button"
        className={styles.runButton}
        data-testid="canvas-run"
        aria-label={t('runCanvasLabel')}
        title={t('runCanvasTitle')}
        onClick={onRun}
      ><RunCanvasIcon /><span>{t('runCanvas')}</span></button>}

      {/* The surface's own report and controls, then the glyph clusters. One component,
          because which of those survive a collapse is one table and not three. */}
      <CanvasSessionActions variant="bar" surface={surface} collapsed={collapsed} handlers={handlers} />

      {/* Moving around the board sits with acting on it. It used to be a second floating
          rail pinned to the left edge — two toolbars over one canvas, each with its own
          idea of which commands are "view" and which are "session". */}
      {showsActions && view}

      {/* The prompt is a THING YOU CAN PUT AWAY now, so the bar has to be able to bring
          it back — a close with no way back is the trap that keeps people from ever
          pressing it. */}
      {onTogglePrompt && showsActions && <button
        type="button"
        className={styles.sessionActionButton}
        data-testid="canvas-prompt-toggle"
        aria-pressed={promptOpen}
        aria-label={promptOpen ? t('hidePrompt') : t('showPrompt')}
        title={promptOpen ? t('hidePrompt') : t('showPrompt')}
        onClick={onTogglePrompt}
      ><PromptIcon /></button>}

      {extras}

      {/* Never folded. A collapsed roster is a team nobody can see is working, and this
          bar IS what is left after a collapse — so if the avatars were anywhere else the
          rule that keeps them would be a statement about an element that never folds. */}
      {canvasChromeShows('roster', collapsed) && <>
        <span className={styles.commandBarDivider} aria-hidden />
        {roster}
        {team}
        {/* Bring someone into THIS group — drawn as its trailing chip, not a worded
            button in the corner beside it. See `chrome: 'roster'` in
            `canvasSessionActions.ts` for why Share moved here. Its own positioned
            box, because `inviteMenu` anchors `right:0` against whatever wraps this
            button — it has to be this wrapper and not the bar itself, or the sheet
            opens off the button that spawned it. */}
        {showsActions && <span className={styles.rosterInviteAnchor} data-testid="canvas-roster-invite">
          <CanvasSessionActions variant="roster" surface={surface} handlers={handlers} />
          {inviteMenu}
        </span>}
      </>}

      {/* The doors out — Invite, Publish, ••• — behind their own divider so the group
          reads apart from the roster beside it, the same way it always read apart from
          the glyphs when it had a card of its own. Folds away with the rest of the
          controls: `handoff` is `SLOT_KIND.control` in `canvasChrome.ts`, same as
          `actions`, so `showsActions` is the right gate rather than a new one. */}
      {handoff && showsActions && <>
        <span className={styles.commandBarDivider} aria-hidden />
        {handoff}
      </>}

      {showsQuickAdd && <>
        <span className={styles.commandBarDivider} aria-hidden />
        {/* ONE door onto the palette. This used to be six circles — five identified by
            colour alone, each pre-filtering a group, plus a sixth that opened the palette
            whole — but a dot with no glyph next to five other dots told nobody what
            pressing it did. The shortlist is gone; every group is still one press away,
            through the picker's own category rail rather than a menu that duplicated it. */}
        <button
          type="button"
          className={styles.sessionActionButton}
          data-testid="canvas-quick-add"
          aria-pressed={quickAddOpen}
          aria-label={t('quickAdd')}
          title={t('quickAdd')}
          onClick={(event) => onQuickAdd(undefined, event.currentTarget.getBoundingClientRect())}
        >{quickAddOpen ? <ClosePaletteIcon /> : <AddObjectIcon />}</button>
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
