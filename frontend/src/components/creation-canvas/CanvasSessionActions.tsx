// No 'use client' directive: this is only ever rendered by `CreationCanvas`, which is
// already a client component, so the boundary is inherited and a second declaration here
// would only add another file to the architecture ratchet's client-component tally.
import { useTranslations } from 'next-intl';
import {
  DiagnosticsIcon,
  DrawIcon,
  FullscreenIcon,
  ExitFullscreenIcon,
  OutcomeMetricsIcon,
  PresentIcon,
  ProveIdeaIcon,
  PublishCanvasIcon,
  RecordTalktrackIcon,
  RedoIcon,
  RunCanvasIcon,
  ShareCanvasIcon,
  StartCallIcon,
  UndoIcon,
  WalkthroughIcon,
} from '@/components/canvas/CanvasCommands';
import {
  canvasSessionActionsFor,
  canvasSessionClusters,
  phoneOverflowActions,
  type CanvasSessionActionDef,
  type CanvasSessionActionId,
} from '@/lib/canvasSessionActions';
import { CANVAS_BAR_GROUP_ORDER, type CanvasBarGroupId } from '@/lib/canvasBarGroups';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { canvasChromeShows } from '@/lib/canvasChrome';
import { CanvasBarGroup } from './CanvasBarGroup';
import { useContributedSurfaceActions } from './canvasSurfaceActions';
import styles from './CreationCanvas.module.css';

/**
 * The ONE control set for "what can I do to this canvas".
 *
 * The registry (`lib/canvasSessionActions.ts`) says which actions exist, which STAGE OF
 * THE ARC each one serves, and where it lives on a phone; the group registry
 * (`lib/canvasBarGroups.ts`) says what each stage is called and in what order they draw.
 * This renders that, and nothing else decides any of it.
 *
 * ── THE FOUR CHROMES ─────────────────────────────────────────────────────────────
 * `bar`   — the desktop command bar: the surface's own status and controls, then the five
 *           captioned stage groups and the board group, in arc order.
 * `menu`  — the ••• sheet. It carries every action the phone bar does NOT, so a small
 *           screen loses placement and never loses the action. That used to be a blanket
 *           `display:none` on a class name, which quietly took undo, redo, diagnostics,
 *           the outcome scorecard AND every way to invite anybody off the phone.
 * `doors` — the rows inside **Make it real**: the ways work LEAVES this canvas. It
 *           replaces the old `handoff` variant, which drew each of them as its own worded
 *           button on the bar and so put *Make it real* and *Publish* side by side,
 *           reading as a fork between two things that mean the same thing.
 * `roster`— the trailing chip on the live roster: Share, drawn as a bare glyph the same
 *           size as the avatars it follows, because it answers the same question the
 *           roster does ("who is part of this") instead of opening a second place.
 *
 * ── WHY THE BAR LOOP RUNS OVER GROUPS AND NOT OVER CLUSTERS ──────────────────────
 * A group can be non-empty on the HOST's contribution alone. Idea's only control on most
 * boards is the Add button, which the bar owns because the picker has to open above the
 * button's own screen rect; Make's lead is the prompt toggle, which the host places.
 * Iterating the clusters the registry happens to produce would have drawn Idea only when
 * something was filed under it — so the loop runs over `CANVAS_BAR_GROUP_ORDER`, which is
 * the arc, and asks the registry what it has for each stage.
 */

const ACTION_ICON: Record<CanvasSessionActionId, () => React.JSX.Element> = {
  draw: DrawIcon,
  undo: UndoIcon,
  redo: RedoIcon,
  run: RunCanvasIcon,
  present: PresentIcon,
  outcomes: OutcomeMetricsIcon,
  diagnostics: DiagnosticsIcon,
  walkthrough: WalkthroughIcon,
  call: StartCallIcon,
  talktrack: RecordTalktrackIcon,
  share: ShareCanvasIcon,
  prove: ProveIdeaIcon,
  publish: PublishCanvasIcon,
  fullscreen: FullscreenIcon,
};

/** The glyph for an action that is currently ON, when leaving it needs a different one. */
const ACTIVE_ACTION_ICON: Partial<Record<CanvasSessionActionId, () => React.JSX.Element>> = {
  fullscreen: ExitFullscreenIcon,
};

export interface CanvasSessionActionHandler {
  /** What pressing it does. */
  run: () => void;
  /** Whether the mode is on / the panel this button owns is open. */
  active?: boolean;
  /** True while the session forbids it (a read-only role, a lock). */
  disabled?: boolean;
  /**
   * False while this action has no meaning in the session's CURRENT state, as opposed to
   * on this surface — so it is drawn nowhere at all rather than drawn dead.
   *
   * The registry answers "does this action mean anything on this surface" from what the
   * surface declares, which is the right question for a scorecard over a board with no
   * objects. It cannot answer "is a call already running": that is session state the
   * host holds and no surface flag can see. Absent means available, so an action only
   * ever disappears because the host said so.
   *
   * Not the same as `disabled`. Disabled says "you cannot do this right now and here is
   * the button that would"; withdrawn says "this control has moved" — which is exactly
   * the call once its dock is on screen and owns every control the room has.
   */
  available?: boolean;
}

/**
 * What the HOST puts into a named group, beside whatever the registry files there.
 *
 * A narrow, typed seam rather than four more props: the bar used to draw `view`, `add`,
 * `people` and `handoff` as groups of their own, each with its own branch, which is how
 * one bar came to carry eight captions for five ideas. Now the host says WHICH GROUP its
 * node belongs to and this decides how the group is drawn.
 *
 * `lead` opens the group and `trail` closes it, because both positions are load-bearing:
 * Add is the first thing in Idea, and *Make it real* is the last thing in Reach. A node
 * the collapse rule stands down is passed as `undefined` by the host — `canvasChrome.ts`
 * stays the one table that answers "is this on screen", and this component never
 * second-guesses it.
 */
export type CanvasBarGroupSlots = Partial<Record<CanvasBarGroupId, {
  lead?: React.ReactNode;
  trail?: React.ReactNode;
}>>;

export interface CanvasSessionActionsProps {
  handlers: Record<CanvasSessionActionId, CanvasSessionActionHandler>;
  variant: 'bar' | 'menu' | 'doors' | 'roster';
  /**
   * The surface being read. The registry decides which actions mean anything on it —
   * an outcome scorecard over a conversation with no objects is a button whose only
   * possible answer is nothing — so this is passed rather than each call site
   * remembering which buttons to hide where.
   */
  surface?: CanvasSurfaceId;
  /**
   * Whether the bar is folded away. What survives is not decided here — every slot asks
   * `canvasChromeShows`, so "the roster stays and the buttons go" is one table rather
   * than a rule each consumer remembers differently.
   */
  collapsed?: boolean;
  /** `bar` only: what the host contributes into each named group. */
  groupSlots?: CanvasBarGroupSlots;
}

export function CanvasSessionActions({
  handlers,
  variant,
  surface,
  collapsed = false,
  groupSlots,
}: CanvasSessionActionsProps) {
  const t = useTranslations('creationCanvas');
  // What the active surface has put in the bar — a runtime's Run/Stop and its readings,
  // plus what it REPORTS. Both halves are null on a surface that contributes nothing, so
  // there is no branch here about which surfaces have runtimes.
  const { controls, status } = useContributedSurfaceActions();
  const showsControls = canvasChromeShows('surfaceControls', collapsed);
  const showsActions = canvasChromeShows('actions', collapsed);

  /**
   * The actions this session is actually offering, in ONE place: the bar, the phone sheet
   * and the doors menu all ask it, so an action the host has withdrawn cannot survive in
   * the one chrome somebody forgot to filter.
   */
  const offered = (defs: readonly CanvasSessionActionDef[]) =>
    defs.filter((def) => handlers[def.id]?.available !== false);

  /** Name, hover text and ARIA state — decided once, for every chrome. */
  const describe = (def: CanvasSessionActionDef) => {
    const handler = handlers[def.id];
    const active = handler?.active === true;
    const labelKey = active && def.activeLabelKey ? def.activeLabelKey : def.labelKey;
    const label = t(labelKey as 'share');
    return {
      handler,
      active,
      label,
      title: def.titleKey ? t(def.titleKey as 'share') : label,
      // A command that is over needs neither attribute; a mode needs `pressed` and a
      // panel needs `expanded`. The registry decides which, so no call site has to
      // remember that full screen is a mode and the invite sheet is not.
      'aria-pressed': def.state === 'pressed' ? active : undefined,
      'aria-expanded': def.state === 'expanded' ? active : undefined,
    };
  };

  /** A worded row — the shape both the ••• sheet and the Make it real menu use. */
  const wordedRow = (def: CanvasSessionActionDef) => {
    const { handler, active, label, title, ...aria } = describe(def);
    const Glyph = (active && ACTIVE_ACTION_ICON[def.id]) || ACTION_ICON[def.id];
    // No class of its own: chrome comes from the sheet's own `button` rule, so a session
    // action and a session tool are the same kind of row rather than two visitors' idea
    // of one.
    return <button
      key={def.id}
      type="button"
      disabled={handler?.disabled}
      title={title}
      onClick={() => handler?.run()}
      {...aria}
    ><span aria-hidden><Glyph /></span>{label}</button>;
  };

  if (variant === 'menu') {
    // Words, always. The sheet has room for them and a phone user pressing ••• is
    // looking for a named thing, not scanning a second row of glyphs.
    return <>{offered(phoneOverflowActions(surface)).map(wordedRow)}</>;
  }

  if (variant === 'doors') {
    // The ways work leaves this canvas, as rows under the one worded button on the bar.
    // Filtering by chrome rather than by id is what keeps that true for a door added
    // later. The collapse rule still gates the group they hang under, not these rows —
    // the host asks `canvasChromeShows('handoff', …)` before it draws the trigger at all.
    return <>{offered(canvasSessionActionsFor(surface).filter((def) => def.chrome === 'door')).map(wordedRow)}</>;
  }

  if (variant === 'roster') {
    // Share, drawn the same size as the avatars it trails and with no word beside it —
    // the roster already says "who is part of this"; this glyph is how you add to it, so
    // it belongs at the group's own end rather than in a labelled button that reads as a
    // second, unrelated place to go.
    return <>
      {offered(canvasSessionActionsFor(surface).filter((def) => def.chrome === 'roster')).map((def) => {
        const { handler, active, label: _label, title, ...aria } = describe(def);
        const Glyph = (active && ACTIVE_ACTION_ICON[def.id]) || ACTION_ICON[def.id];
        return <button
          key={def.id}
          type="button"
          className={styles.rosterInvite}
          data-tour="creation-share"
          disabled={handler?.disabled}
          aria-label={title}
          title={title}
          onClick={() => handler?.run()}
          {...aria}
        ><Glyph /></button>;
      })}
    </>;
  }

  // The bar. One pass over the arc; the registry's clusters are looked up per stage
  // rather than iterated, so a stage with nothing filed under it still draws whatever the
  // host contributed to it.
  const byCluster = new Map(canvasSessionClusters(surface).map((c) => [c.cluster, c.actions]));

  return <>
    {/* What the runtime IS DOING, before what you can do to it — and it survives a
        collapse, because a folded bar that stops saying an app is running is the exact
        failure the status/control split exists to prevent. */}
    {canvasChromeShows('surfaceStatus', collapsed) && status}
    {/* The surface's own controls come FIRST among the controls: on a running app "Stop"
        is what the reader is reaching for, and burying it behind undo/redo would make the
        shared bar worse than the second toolbar it replaces. */}
    {showsControls && controls}
    {CANVAS_BAR_GROUP_ORDER.map((group) => {
      const slots = groupSlots?.[group];
      // The worded doors are drawn by the `doors` variant inside the menu the host hangs
      // off this group's `trail`. Filtering by chrome rather than by id keeps that true
      // for a door added later.
      const actions = showsActions
        ? offered((byCluster.get(group) ?? []).filter((def) => def.chrome === 'icon'))
        : [];
      const members = actions.length + (slots?.lead ? 1 : 0) + (slots?.trail ? 1 : 0);
      // A stage with nothing to draw draws nothing — not an empty captioned trough. This
      // is the honest reading of "every group is captioned": a caption over no controls
      // names an absence.
      if (!members) return null;

      const buttons = actions.map((def) => {
        const { handler, active, label, title, ...aria } = describe(def);
        const Glyph = (active && ACTIVE_ACTION_ICON[def.id]) || ACTION_ICON[def.id];
        return <button
          key={def.id}
          type="button"
          className={styles.sessionActionButton}
          // Published so the phone breakpoint stands down exactly the actions the
          // registry moved into the ••• sheet — one declaration, read by the stylesheet
          // as well as by the sheet, rather than a second list in CSS.
          data-phone={def.phone}
          disabled={handler?.disabled}
          aria-label={label}
          title={title}
          onClick={() => handler?.run()}
          {...aria}
        ><Glyph /></button>;
      });

      // ONE captioned group, whatever its size. A group of one gets no trough — a lone
      // button in a segmented shell reads as a group with a member missing — but it keeps
      // its NAME, drawn above it, which is what a lone unlabelled glyph needed most.
      return <CanvasBarGroup key={group} group={group} shell={members < 2 ? 'bare' : 'trough'}>
        {slots?.lead}
        {buttons}
        {slots?.trail}
      </CanvasBarGroup>;
    })}
  </>;
}
