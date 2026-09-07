/**
 * The NAMED GROUPS of the one canvas command bar.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * `canvasSessionActions.ts` says which actions exist and which of them belong together;
 * `canvasChrome.ts` says where each region of the bar goes. Neither answered the question
 * the bar was actually failing on screen: WHAT IS THIS SET OF GLYPHS FOR.
 *
 * A trough says "these three are the same kind of thing" and it stops exactly there. It
 * cannot say WHICH kind, so a bar carrying five troughs — history, tools, live, view,
 * add — reads as five anonymous huddles of icons whose only explanation is a tooltip you
 * have to hover one at a time to collect. The ••• sheet already knew better: it captions
 * its sections (`.moreMenuHeading` — "This canvas", "Create and view"), and the bar, which
 * is the surface people actually work from, had nothing.
 *
 * So a group's NAME is data, in one table, and `CanvasBarGroup` draws it. Two consequences
 * worth stating:
 *
 *   1. THE CAPTION AND THE ACCESSIBLE NAME ARE ONE DECISION. They used to be one string
 *      doing one job — a `role="group"` with an `aria-label` a sighted reader never saw.
 *      Each entry now carries the short word that goes ABOVE the group and the fuller name
 *      screen readers get, so the two cannot drift into saying different things.
 *   2. A GROUP THAT ALREADY CARRIES WORDS GETS NO CAPTION. `handoff` is Publish and the
 *      ••• overflow — both already worded — and a "Publish" caption over a button that
 *      says Publish is chrome explaining itself. `captionKey` is therefore optional: the
 *      group is still NAMED for assistive tech, it simply has nothing to add on screen.
 *
 * ── ADDING A GROUP ───────────────────────────────────────────────────────────────
 * An entry below plus the `creationCanvas.barGroup.*` copy it names, and
 * `<CanvasBarGroup group="…">` around the controls. Nothing else decides either half.
 *
 * Surfaces that contribute their own controls (`canvasSurfaceActions.tsx`) pass their own
 * caption and label strings instead of an id — an app runtime owns its vocabulary, and a
 * host registry naming a surface's controls would be this file learning what an app is.
 */

import type { CanvasSessionActionCluster } from './canvasSessionActions';

/**
 * Every named group the HOST draws in the bar.
 *
 * The session-action clusters are included by their own type rather than re-listed, so a
 * cluster added to `canvasSessionActions.ts` fails to compile here until it is named —
 * which is the whole point: an unnamed trough is the state this registry replaced.
 */
export type CanvasBarGroupId =
  | CanvasSessionActionCluster
  /** Move around the board — zoom, fit, arrange, mini map, and the panels it can open. */
  | 'view'
  /** The one door onto the object palette. */
  | 'add'
  /** Who is here, who works here, and how to bring someone in. */
  | 'people'
  /** The doors OUT — Publish, and the ••• sheet beside it. */
  | 'handoff';

export interface CanvasBarGroupDef {
  /**
   * The short word drawn ABOVE the group. One or two words, because it sits over a
   * 60-200px trough and a sentence there is a second toolbar made of text.
   *
   * Absent when the group's own controls are already worded — see the header.
   */
  captionKey?: string;
  /**
   * The group's accessible name. Reuses the copy that already named the group where
   * there is some — a registry that invented a second wording for "Canvas history" would
   * put two strings behind one set of buttons.
   */
  labelKey: string;
}

const CANVAS_BAR_GROUPS: Readonly<Record<CanvasBarGroupId, CanvasBarGroupDef>> = {
  // "Workflow", not "Run": the bar can carry a SECOND Run — the green button that opens
  // the app this board builds — and two groups both called Run is the ambiguity the
  // caption was added to remove. The cluster runs the board's FLOW, so it says so.
  run: { captionKey: 'barGroup.run', labelKey: 'sessionActionCluster.run' },
  history: { captionKey: 'barGroup.history', labelKey: 'sessionActionCluster.history' },
  inspect: { captionKey: 'barGroup.inspect', labelKey: 'sessionActionCluster.inspect' },
  live: { captionKey: 'barGroup.live', labelKey: 'sessionActionCluster.live' },
  session: { captionKey: 'barGroup.session', labelKey: 'sessionActionCluster.session' },
  view: { captionKey: 'barGroup.view', labelKey: 'canvasViewControls' },
  add: { captionKey: 'barGroup.add', labelKey: 'quickAdd' },
  people: { captionKey: 'barGroup.people', labelKey: 'barGroup.peopleLabel' },
  // No caption: Publish is a word and ••• is universal. See the header.
  handoff: { labelKey: 'barGroup.handoffLabel' },
};

/** How this group is named, on screen and to assistive tech. */
export function canvasBarGroup(id: CanvasBarGroupId): CanvasBarGroupDef {
  return CANVAS_BAR_GROUPS[id];
}

/** Every named group, for the tests that read the copy back. */
export function canvasBarGroupIds(): readonly CanvasBarGroupId[] {
  return Object.keys(CANVAS_BAR_GROUPS) as CanvasBarGroupId[];
}
