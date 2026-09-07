// No 'use client' directive: these are only ever rendered by `CreationCanvas`, which is
// already a client component, so the boundary is inherited and a second declaration here
// would only add another file to the architecture ratchet's client-component tally — the
// same reason `CanvasSessionActions` omits it.
import { useTranslations } from 'next-intl';
import { AddObjectIcon, ChatSurfaceIcon, ClosePaletteIcon, CollapseBarIcon, ExpandBarIcon, RunCanvasIcon } from '@/components/canvas/CanvasCommands';
import { canvasChromeShows } from '@/lib/canvasChrome';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { CanvasSessionActionId } from '@/lib/canvasSessionActions';
import { mergeRefs } from '@/lib/mergeRefs';
import type { CreationObjectGroup } from './creationObjectRegistry';
import { CanvasSessionActions, type CanvasBarGroupSlots, type CanvasSessionActionHandler } from './CanvasSessionActions';
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
 * ── THE BAR IS THE ARC ───────────────────────────────────────────────────────────
 * Its groups are `Idea · Make · Run · Measure · Reach`, in that order, in the same hues
 * the left rail's stage dots use, plus one `Board` group for what acts on the board
 * rather than on the work. That is not a re-skin: it is the answer to the only question a
 * caption can be asked, which is WHAT IS THIS SET OF GLYPHS FOR. The previous eight
 * captions — Workflow, History, Tools, Live, Share, View, Add, People — each named the
 * implementation, and the two worst of them (`Tools`, `Live`) were shelves holding
 * unrelated things.
 *
 * Order is therefore owned by `CANVAS_BAR_GROUP_ORDER` and not by a column of JSX here.
 * This component contributes NODES into named groups (`CanvasBarGroupSlots`) and
 * `CanvasSessionActions` draws them beside whatever the action registry filed under the
 * same stage. Four things that used to be groups of their own are contributions now:
 *
 *   Add     → leads **Idea**.  The palette's door stays here because the picker has to
 *             open above this button's own screen rect, which only the button knows.
 *   Prompt  → leads **Make**.  It sat in `View` beside nine zoom glyphs, which said it
 *             was chrome; it is the main input to the canvas.
 *   Roster  → leads **Reach**. Who is here, who works here, and the Share chip that adds
 *             to both.
 *   Doors   → close **Reach**. One worded button — *Make it real* — with Publish and the
 *             rest as rows under it, instead of two worded buttons side by side.
 *
 * ── WHAT IS NOT ON THE BAR AT ALL ────────────────────────────────────────────────
 * The view commands. Zoom, fit, arrange, the mini map and the outline are not a stage of
 * anything — they move the viewport, they do not advance the work — and giving them a
 * sixth caption was what forced the bar to invent one. They are a section of the •••
 * sheet now, which the host owns; a floating second panel in the corner was considered
 * and rejected for the reason the left rail was: two toolbars over one canvas.
 */

export interface CanvasCommandBarProps {
  surface: CanvasSurfaceId;
  collapsed: boolean;
  onToggleCollapse: () => void;
  handlers: Record<CanvasSessionActionId, CanvasSessionActionHandler>;
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
   * Take this board to the surface that RUNS it — a different act from the registry's
   * `run`, which runs the board's own flow where it stands. Both are in the Run group and
   * that is the honest place for both: the stage is "run it", and these are the two ways
   * to. Absent when the surface contributes its own Run (two Run buttons that can
   * disagree about whether something is running is worse than none) and absent when there
   * is nothing on the board to run — a Run button over an empty canvas is a promise with
   * nothing behind it.
   */
  onRun?: () => void;
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
   */
  team?: React.ReactNode;
  /**
   * The invite sheet Share opens — built by the host (it owns the session's member
   * list and the guest-room state) and handed down so it can render right beside the
   * roster's own trailing chip. It has to arrive as a prop rather than inside the
   * doors group: the panel anchors `right:0` against the nearest positioned ancestor,
   * and that has to be the button that opened it.
   */
  inviteMenu?: React.ReactNode;
  /**
   * The one worded control on the bar — *Make it real* and the menu of doors under it.
   * Closes the Reach group, because putting the result in front of people is what Reach
   * means and a door out is the last thing you do in it.
   */
  makeItReal?: React.ReactNode;
  /**
   * The ••• sheet's trigger and the sheet itself — the board's own errands, including
   * the view commands. Drawn in the `Board` group, the one group that names no stage.
   */
  boardMenu?: React.ReactNode;
  /** Host contributions that act on the board — an editor's capture actions, a vendor
   *  setup prompt. They join the `Board` group for the same reason `boardMenu` does. */
  extras?: React.ReactNode;
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
  onQuickAdd,
  quickAddOpen,
  onRun,
  roster,
  team,
  onTogglePrompt,
  promptOpen = true,
  makeItReal,
  boardMenu,
  extras,
  inviteMenu,
  hostRef,
}: CanvasCommandBarProps) {
  const t = useTranslations('creationCanvas');
  const showsActions = canvasChromeShows('actions', collapsed);
  // The button adds OBJECTS, so it belongs to a surface that has objects to add them to.
  // Asked of the surface rather than listed here, for the same reason the session actions
  // ask it: a surface added later answers correctly without this file changing.
  const showsQuickAdd = showsActions && surface === 'graph';

  /**
   * What this bar puts into each named group. Every entry is gated by the ONE collapse
   * table — `canvasChromeShows` — rather than by a rule this component remembers, which
   * is what keeps "the roster stays and the buttons go" true in the bar, in the phone
   * sheet and in whatever a surface contributed.
   */
  const groupSlots: CanvasBarGroupSlots = {
    idea: {
      lead: showsQuickAdd ? <button
        type="button"
        data-tour="creation-object-palette"
        className={styles.sessionActionButton}
        data-testid="canvas-quick-add"
        aria-pressed={quickAddOpen}
        aria-label={t('quickAdd')}
        title={t('quickAdd')}
        onClick={(event) => onQuickAdd(undefined, event.currentTarget.getBoundingClientRect())}
      >{quickAddOpen ? <ClosePaletteIcon /> : <AddObjectIcon />}</button> : undefined,
    },
    make: {
      /* The composer's own bubble, and the FIRST thing in Make.
         It used to be last in `View`, behind eight zoom-and-panel glyphs, wearing the
         spark that the prompt and the Brain object also carry — and a spark says "AI",
         not "the place you type". Nobody read it as the composer, so the one control that
         brings back a prompt somebody had just closed was both the least legible glyph on
         the bar and the last one your eye reached. A speech bubble is what a composer
         looks like everywhere else, including this canvas's own Chat surface
         (`ChatSurfaceIcon`, reused rather than redrawn — the same object gets the same
         mark), and the thing you are most likely to want back goes first.

         The prompt is a THING YOU CAN PUT AWAY, so the bar has to be able to bring it
         back — a close with no way back is the trap that keeps people from ever pressing
         it. */
      lead: showsActions && onTogglePrompt ? <button
        type="button"
        className={styles.sessionActionButton}
        data-testid="canvas-prompt-toggle"
        aria-pressed={promptOpen}
        aria-label={promptOpen ? t('hidePrompt') : t('showPrompt')}
        title={promptOpen ? t('hidePrompt') : t('showPrompt')}
        onClick={onTogglePrompt}
      ><ChatSurfaceIcon /></button> : undefined,
    },
    run: {
      /* Green rather than brand blue: it is the only control on this bar that STARTS
         something, and the board's accent is already spent on "which surface am I on".
         Its ACCESSIBLE NAME is "Run this canvas", which is not padding — a board can
         carry objects with run buttons of their own, and a bare "Run" beside them is
         ambiguous to anyone reading the page by its names rather than its layout. */
      lead: showsActions && onRun ? <button
        type="button"
        className={styles.runButton}
        data-testid="canvas-run"
        aria-label={t('runCanvasLabel')}
        title={t('runCanvasTitle')}
        onClick={onRun}
      ><RunCanvasIcon /><span>{t('runCanvas')}</span></button> : undefined,
    },
    reach: {
      /* Never folded. A collapsed roster is a team nobody can see is working, and this
         bar IS what is left after a collapse — so the avatars have to be here for that
         rule to mean anything. Who is editing this, who works here and how to bring
         somebody in are ONE named set. */
      lead: canvasChromeShows('roster', collapsed) ? <>
        {roster}
        {team}
        {/* Bring someone into THIS group — drawn as the roster's trailing chip, not a
            worded button in the corner beside it. Its own positioned box, because
            `inviteMenu` anchors `right:0` against whatever wraps this button. */}
        {showsActions && <span className={styles.rosterInviteAnchor} data-testid="canvas-roster-invite">
          <CanvasSessionActions variant="roster" surface={surface} handlers={handlers} />
          {inviteMenu}
        </span>}
      </> : undefined,
      trail: canvasChromeShows('handoff', collapsed) ? makeItReal : undefined,
    },
    board: {
      lead: showsActions ? extras : undefined,
      /* The ••• sheet, then the fold. The toggle is NEVER hidden — a collapse with no way
         back is a one-way door — and it is last so the controls it removes vanish
         leftwards rather than jumping under the cursor that just pressed it. */
      trail: <>
        {showsActions && boardMenu}
        <button
          type="button"
          className={styles.commandBarCollapse}
          data-testid="canvas-bar-collapse"
          aria-pressed={collapsed}
          aria-label={collapsed ? t('expandBar') : t('collapseBar')}
          title={collapsed ? t('expandBar') : t('collapseBar')}
          onClick={onToggleCollapse}
        >{collapsed ? <ExpandBarIcon /> : <CollapseBarIcon />}</button>
      </>,
    },
  };

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
      <CanvasSessionActions
        variant="bar"
        surface={surface}
        collapsed={collapsed}
        handlers={handlers}
        groupSlots={groupSlots}
      />
    </div>
  );
}
