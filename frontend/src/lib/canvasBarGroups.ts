/**
 * The NAMED GROUPS of the one canvas command bar — which are the ARC.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * `canvasSessionActions.ts` says which actions exist and which of them belong together;
 * `canvasChrome.ts` says where each region of the bar goes. Neither answered the question
 * the bar was actually failing on screen: WHAT IS THIS SET OF GLYPHS FOR.
 *
 * A trough says "these three are the same kind of thing" and it stops exactly there. It
 * cannot say WHICH kind, so a bar carrying five troughs reads as five anonymous huddles
 * of icons whose only explanation is a tooltip you have to hover one at a time to
 * collect. So a group's NAME is data, in one table, and `CanvasBarGroup` draws it.
 *
 * ── WHY THE NAMES ARE THE FIVE STAGES ────────────────────────────────────────────
 * They used to be `Workflow · History · Tools · Live · Share · View · Add · People` —
 * eight captions, every one of them named after how the controls are implemented rather
 * than after what a person is doing. *Tools* held the outcome scorecard, the diagnostics
 * report and full screen. *Live* held a call and a screen recording. *Workflow* was a
 * euphemism invented so the bar's Run would not read as an object's Run.
 *
 * Meanwhile the product teaches five words everywhere else — `STAGES` in `navGroups.ts`,
 * the left rail's `--stage-*` dots, the session's own phase in `canvasPhases.ts` — and
 * the bar was the one surface not using them. It now reads
 * `Idea · Make · Run · Measure · Reach`, left to right, in that order, in those hues. A
 * person who has read the rail once can find a control on the bar without reading it, and
 * the arc gets taught twice from one vocabulary instead of competing with a second.
 *
 * Two consequences worth stating:
 *
 *   1. A STAGE GROUP DOES NOT OWN ITS OWN CAPTION COPY. It names a `Stage`, and the
 *      caption is `nav.stage.<id>` — the SAME five strings the rail renders, already
 *      translated in all five catalogs. A second set of words for the same five ideas is
 *      exactly how a vocabulary drifts, and this file is where that would have started.
 *   2. `board` IS NOT A STAGE, DELIBERATELY. Full screen and the ••• sheet act on the
 *      BOARD rather than on the work, so they get the one group with a caption of its
 *      own. A control that answers no stage's question must not be given a stage's
 *      caption — that is how `Tools` happened.
 *
 * ── ADDING A GROUP ───────────────────────────────────────────────────────────────
 * You almost certainly should not. The arc has five stages and this bar has those five
 * plus the board; a sixth caption is a claim that the methodology has grown a sixth act,
 * which is a decision for `STAGES`, not for a toolbar. If `STAGES` does grow one, add its
 * cluster to `CanvasSessionActionCluster` and its row here, and the caption comes free.
 *
 * Surfaces that contribute their own controls (`canvasSurfaceActions.tsx`) pass their own
 * caption and label strings instead of an id — an app runtime owns its vocabulary, and a
 * host registry naming a surface's controls would be this file learning what an app is.
 */

import type { Stage } from './navGroups';
import type { CanvasSessionActionCluster } from './canvasSessionActions';

/**
 * Every named group the HOST draws in the bar.
 *
 * It IS the cluster union, with nothing added. The bar used to carry four groups the
 * action registry knew nothing about — `view`, `add`, `people`, `handoff` — each drawn by
 * its own branch in `CanvasCommandBar`, which is why the bar had eight captions for five
 * ideas. Those four are gone as groups: Add leads Idea, the prompt leads Make, the roster
 * leads Reach, and the doors out are rows under Reach's one worded button. What a group
 * contains can therefore still come from two places (the registry, and the host's own
 * contributions), but what a group IS comes from one.
 */
export type CanvasBarGroupId = CanvasSessionActionCluster;

export interface CanvasBarGroupDef {
  /**
   * The stage this group names. Its caption is `nav.stage.<stage>` — the rail's own copy,
   * not a second translation of it — and its hue is `--stage-<stage>`.
   *
   * Absent for the one group that names no stage. See the header.
   */
  stage?: Stage;
  /**
   * Caption key under `creationCanvas`, for a group that names no stage. Ignored when
   * `stage` is set, so a group cannot be captioned twice.
   */
  captionKey?: string;
  /**
   * The group's accessible name, under `creationCanvas`. Fuller than the caption on
   * purpose: the caption is one word over a 60–200px trough, and "Idea" alone tells a
   * screen-reader user nothing about which of the page's five Ideas this is.
   */
  labelKey: string;
}

const CANVAS_BAR_GROUPS: Readonly<Record<CanvasBarGroupId, CanvasBarGroupDef>> = {
  idea: { stage: 'idea', labelKey: 'barGroup.ideaLabel' },
  make: { stage: 'make', labelKey: 'barGroup.makeLabel' },
  run: { stage: 'run', labelKey: 'barGroup.runLabel' },
  measure: { stage: 'measure', labelKey: 'barGroup.measureLabel' },
  reach: { stage: 'reach', labelKey: 'barGroup.reachLabel' },
  board: { captionKey: 'barGroup.board', labelKey: 'barGroup.boardLabel' },
};

/**
 * Declaration order is DRAW order, and the order is the arc.
 *
 * The bar iterates this rather than the clusters the registry happens to produce, because
 * a group can be non-empty on contributions alone: Idea's only control on most boards is
 * the Add button, which the bar owns (it needs the button's own screen rect to open the
 * picker above itself). Deriving the order from `canvasSessionClusters` would have put
 * Idea on the bar only when something happened to be filed under it.
 */
export const CANVAS_BAR_GROUP_ORDER = Object.keys(CANVAS_BAR_GROUPS) as readonly CanvasBarGroupId[];

/** How this group is named, on screen and to assistive tech. */
export function canvasBarGroup(id: CanvasBarGroupId): CanvasBarGroupDef {
  return CANVAS_BAR_GROUPS[id];
}

/** Every named group, for the tests that read the copy back. */
export function canvasBarGroupIds(): readonly CanvasBarGroupId[] {
  return CANVAS_BAR_GROUP_ORDER;
}
