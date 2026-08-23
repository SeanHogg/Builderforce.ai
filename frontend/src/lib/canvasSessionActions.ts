/**
 * Canvas session actions — what the session bar lets you DO to the canvas you are on.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * `canvasSurfaces.ts` answers "what am I looking at". This answers the other half of the
 * session bar: "what can I do to it". That half was never declared anywhere — it was
 * eight hand-rolled buttons in a row in `CreationCanvas.tsx`, each spelling its own glyph
 * (`↶ ↷ ↗ ⚠ ••• ▾`), each choosing its own chrome, and each deciding on its own whether
 * a phone would ever see it. Three consequences, all of which this registry retires:
 *
 *   1. NOTHING SAID THEY WERE SETS. Undo/redo were segmented; the three view actions
 *      beside them were not, so "step back in history", "read the outcome numbers" and
 *      "fill the screen" drew at the same weight with nothing marking which belonged
 *      with which. The surface switcher had already learned this lesson — one trough per
 *      decision, one lit segment — and the rest of the bar had not.
 *   2. TWO CONTROLS, ONE DESTINATION. The collaborator roster's `+` and the `Share ▾`
 *      button both opened the same invite panel. A decision with two controls is the
 *      exact failure the surface registry was written to prevent.
 *   3. THE PHONE LOST FIVE OF THEM SILENTLY. The bar hid every unlabelled button under
 *      760px, and the ••• menu — the one thing that survived — did not list them. So on
 *      a phone there was no undo, no redo, no diagnostics, no outcome metrics, and NO
 *      WAY TO SHARE OR INVITE ANYBODY. Nothing in the code said that; it fell out of a
 *      blanket `display:none` on a class name.
 *
 * So placement is DATA. `phone` is the field that closes (3): every action is either on
 * the phone bar or in the phone's overflow menu, both rendered from THIS list by
 * `CanvasSessionActions`, so an action cannot be dropped from a small screen by omission
 * — only by declaring it, which the tests then read back.
 *
 * ── ADDING AN ACTION ─────────────────────────────────────────────────────────────
 *   1. an entry below (including where it goes on a phone),
 *   2. the existing `creationCanvas.*` label keys it names — no new copy if the string
 *      is already in the catalogs,
 *   3. a `{ run }` entry in the host's handler map.
 * The bar, the overflow menu, the clustering and the accessible names all follow.
 */

import {
  canvasSurfaceDefinition,
  DEFAULT_CANVAS_SURFACE,
  type CanvasSurfaceId,
} from './canvasSurfaces';

export type CanvasSessionActionId =
  | 'undo'
  | 'redo'
  | 'outcomes'
  | 'prove'
  | 'diagnostics'
  | 'fullscreen'
  | 'call'
  | 'talktrack'
  | 'share'
  | 'publish';

/**
 * The set an action belongs to. A cluster is drawn as ONE segmented control in a shared
 * trough — the same shape the surface switcher uses — because a trough is what says
 * "these are the same kind of thing" without a caption saying it.
 */
export type CanvasSessionActionCluster = 'history' | 'inspect' | 'live' | 'session';

/**
 * What an action NEEDS from the surface it is drawn on.
 *
 * ── WHY A REQUIREMENT AND NOT A LIST OF SURFACES ─────────────────────────────────
 * The bar used to be the same eight buttons on every surface, which put "align the
 * selected objects" and "read the outcome numbers for this board" on a conversation that
 * has no objects on it — a control whose only possible answer is nothing. The obvious fix
 * is `surfaces: ['graph', 'scene3d']` on each entry, and it is the wrong one: every future
 * surface would have to be added to every list that happens to apply to it, in a file
 * about actions, and the lists would drift the moment somebody forgot one.
 *
 * So an action declares its REQUIREMENT and the surface registry answers it. `objects`
 * reads `showsObjects`; `board` reads `showsBoard`. A new surface declares those two flags
 * once, as it already must, and the whole bar composes itself correctly for it.
 */
export type CanvasSessionActionNeed = 'objects' | 'board';

export interface CanvasSessionActionDef {
  id: CanvasSessionActionId;
  cluster: CanvasSessionActionCluster;
  /** Order within the bar. Clusters are drawn in first-appearance order. */
  order: number;
  /**
   * `icon` = a glyph inside its cluster's trough. `labelled` = its own button with a
   * word on it, which is reserved for actions that open somewhere else rather than
   * acting on the board — a glyph can say "undo", only a label can say "Share".
   */
  chrome: 'icon' | 'labelled';
  /**
   * What the button reports about itself. `pressed` is a mode you are in (full screen);
   * `expanded` is a panel this button owns (the invite sheet); `none` is a command that
   * happens and is over. The consumer reads this instead of remembering which of the six
   * needs which ARIA attribute.
   */
  state: 'none' | 'pressed' | 'expanded';
  /**
   * Where the action lives on a PHONE. `bar` keeps its own button in the session bar;
   * `menu` moves it into the ••• sheet. Both are rendered from this list, so "reachable
   * on a phone" is a property of the registry rather than of whether somebody remembered
   * to add a second copy.
   */
  phone: 'bar' | 'menu';
  /** Catalog key for the accessible name. Existing keys, not a second copy of the copy. */
  labelKey: string;
  /** Catalog key for the name while the action is active, when that differs. */
  activeLabelKey?: string;
  /** Catalog key for the hover description, when it says more than the label. */
  titleKey?: string;
  /**
   * What the surface must provide for this action to mean anything. Absent = every
   * surface, which is the honest answer for undo, share, publish and full screen.
   */
  needs?: CanvasSessionActionNeed;
}

/**
 * A phone session bar is a title, an overflow button and a save button before any of
 * these are added. Two is what fits beside them at 360px without the title collapsing to
 * an ellipsis, so two is the budget — enforced by a test rather than by good intentions,
 * because the failure mode of "just one more" is a header that no longer shows which
 * canvas you are on.
 */
export const PHONE_SESSION_BAR_LIMIT = 2;

export const CANVAS_SESSION_ACTIONS: readonly CanvasSessionActionDef[] = [
  // History first, and undo keeps its phone slot: a fat-fingered drag on a touch board is
  // the single likeliest thing a phone user needs to take back, and burying the only cure
  // two taps deep is what makes a canvas feel unsafe to touch.
  { id: 'undo', cluster: 'history', order: 0, chrome: 'icon', state: 'none', phone: 'bar', labelKey: 'undoCanvasChange' },
  { id: 'redo', cluster: 'history', order: 1, chrome: 'icon', state: 'none', phone: 'menu', labelKey: 'redoCanvasChange' },
  // Two readings of this session and one way to see more of it. They were the three that
  // read as unrelated: `↗` said "opens elsewhere" for a scorecard, and `⚠` drew a standing
  // warning triangle for a report that is usually clean — a permanent alarm on a healthy
  // board is an alarm nobody reads.
  // The outcome scorecard reads THIS BOARD'S OBJECTS — deliverables, and what they were
  // worth. Over a conversation with nothing on it that is a button whose only answer is
  // "nothing", so it asks the surface for objects rather than naming which surfaces have
  // them.
  { id: 'outcomes', cluster: 'inspect', order: 2, chrome: 'icon', state: 'expanded', phone: 'menu', labelKey: 'viewOutcomeMetrics', titleKey: 'outcomeMetricsTitle', needs: 'objects' },
  //
  // DIAGNOSTICS NEEDS NOTHING, and getting that wrong is why this comment is long.
  //
  // It was briefly given `needs: 'objects'` on the reasoning that it reports on the
  // board. It does not. Read what it actually emits: environment and versions, session
  // state, realtime and persistence, timings, the full action log, the Brain tool trace
  // with every failed call, and the raw payload. Every one of those exists on a
  // conversation with no objects and on a running app that has hidden the board — and
  // those are precisely the surfaces where something has gone wrong and the operator
  // needs the report. Scoping it to `showsObjects` took the failure report away from two
  // of the four places a failure is most likely to be looked for.
  //
  // So it is unconditional, deliberately, and the test asserts that it survives on every
  // surface the registry declares.
  { id: 'diagnostics', cluster: 'inspect', order: 3, chrome: 'icon', state: 'expanded', phone: 'menu', labelKey: 'openDiagnostics' },
  // Full screen keeps its phone slot for the reason it always had one: a small screen is
  // where trading app chrome for board is worth the most.
  { id: 'fullscreen', cluster: 'inspect', order: 4, chrome: 'icon', state: 'pressed', phone: 'bar', labelKey: 'fullScreen', activeLabelKey: 'exitFullScreen' },
  // Share is the only worded action, and now the ONLY control that opens the invite
  // panel: the collaborator roster's `+` used to open the same sheet, which is one
  // decision with two controls — the thing the surface registry exists to prevent.
  // THE CALL IS AN ACTION, NOT A STRIP OF ITS OWN.
  //
  // Starting a call used to be a dormant band across the bottom of the shell — a
  // control and a line of explanation, occupying a measured band of the window on
  // every canvas nobody was calling from, which is every canvas almost all of the
  // time. And because the band was the room's own chrome, "start a call" lived in a
  // different place from every other thing you can do to this canvas.
  //
  // So it is a registry action like the rest, which is what makes it apply to EVERY
  // modality by construction: chat, board, 3D space and a running app all draw the
  // same bar from this list, and a surface added later gets the call for free. It
  // needs nothing from the surface — a conversation is as callable as a board — so
  // it declares no requirement.
  //
  // Its own cluster: it is neither history nor a reading of the board, and the dock
  // that appears once the call is running is a whole band of chrome rather than a
  // panel, so grouping it into the inspect trough would have said the two are the
  // same kind of thing.
  //
  // The host withdraws it (`available: false`) the moment a call is running: from
  // then on the dock IS the control, and a second lit "call" button in the bar would
  // be one decision with two homes — the failure this registry exists to prevent.
  { id: 'call', cluster: 'live', order: 5, chrome: 'icon', state: 'none', phone: 'menu', labelKey: 'startCall', titleKey: 'startCallTitle' },
  //
  // TALKTRACK — the recording of this board, beside the live version of it.
  //
  // It sits in the `live` cluster with the call rather than with share/publish
  // because the decision it belongs to is "am I explaining this board to somebody
  // right now" — a call is that synchronously, a talktrack asynchronously, and the
  // second is the one that leaves something behind. Grouping it with Share would
  // have said it was a distribution control, and the recording is not distributed
  // by making it: it becomes a `video` object on the board like anything else the
  // canvas produces, and leaves by whichever door that object then takes.
  //
  // It needs nothing from the surface, deliberately. A walkthrough is a screen
  // recording of whatever is on screen, which is as true of a running app or a 3D
  // space as it is of the board — and the conversation surface is where somebody is
  // most likely to be explaining what they just asked for.
  { id: 'talktrack', cluster: 'live', order: 6, chrome: 'icon', state: 'expanded', phone: 'menu', labelKey: 'recordTalktrack', titleKey: 'recordTalktrackTitle' },
  //
  // PROVE IT — the act the whole method turns on, and the one the product had no
  // door for from a board.
  //
  // Reading an idea is cheap and building is not, so choosing WHICH proof is worth
  // running is the most consequential decision in the first month of anything. That
  // choice lived only on `/realize`, reachable from the nav and from nowhere a person
  // is actually having the idea — so a board full of an idea had no way to become a
  // proof, and the loop's outcome events had no session to attach to. Both halves of
  // that are fixed by one door: this hands the board's own idea to the proof picker
  // and names the session, which is what lets Read, Prove, Build and Measure be
  // recorded against it and the north-star metric be computed at all.
  //
  // It needs OBJECTS for the same reason the scorecard does: "make this real" over a
  // conversation with nothing on it has nothing to make real.
  { id: 'prove', cluster: 'session', order: 7, chrome: 'labelled', state: 'none', phone: 'menu', labelKey: 'proveThisIdea', titleKey: 'proveThisIdeaTitle', needs: 'objects' },
  { id: 'share', cluster: 'session', order: 8, chrome: 'labelled', state: 'expanded', phone: 'menu', labelKey: 'share', titleKey: 'inviteCollaborators' },
  // Publish sits beside Share because they are the two ways work leaves this canvas —
  // one brings a person IN, one puts the result where strangers can reach it.
  //
  // It is here from the first second of a session, before there is anything worth
  // publishing, and that is the point: it was previously reachable ONLY through
  // `SellInMarketplace` in a selected card's inspector, which made "get this to a URL"
  // three clicks deep, framed as commerce, and invisible until you had clicked the right
  // card. It opens the SAME release lifecycle that button does — one gate, two doors —
  // scoped to the whole board, which is the scope an application actually has.
  { id: 'publish', cluster: 'session', order: 9, chrome: 'labelled', state: 'expanded', phone: 'menu', labelKey: 'publishCanvas', titleKey: 'publishCanvasTitle' },
];

const BY_ID = new Map<CanvasSessionActionId, CanvasSessionActionDef>(
  CANVAS_SESSION_ACTIONS.map((def) => [def.id, def]),
);

export function canvasSessionAction(id: CanvasSessionActionId): CanvasSessionActionDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown canvas session action: ${id}`);
  return def;
}

/**
 * The actions that mean something on this surface.
 *
 * ONE filter, asked by the bar, the phone sheet and the tests alike — so "is this button
 * on screen right now" has a single answer and a cluster of one can never be drawn as an
 * empty trough. Passing no surface answers for the board, which is what a caller that has
 * not got one (a test, a story) means.
 */
export function canvasSessionActionsFor(surface: CanvasSurfaceId = DEFAULT_CANVAS_SURFACE): readonly CanvasSessionActionDef[] {
  const def = canvasSurfaceDefinition(surface);
  return CANVAS_SESSION_ACTIONS.filter((action) => {
    if (action.needs === 'objects') return def.showsObjects;
    if (action.needs === 'board') return def.showsBoard;
    return true;
  }).sort((a, b) => a.order - b.order);
}

/** Declaration order, grouped into the troughs the bar draws on THIS surface. */
export function canvasSessionClusters(surface?: CanvasSurfaceId): readonly { cluster: CanvasSessionActionCluster; actions: readonly CanvasSessionActionDef[] }[] {
  const ordered = [...canvasSessionActionsFor(surface)];
  const clusters: { cluster: CanvasSessionActionCluster; actions: CanvasSessionActionDef[] }[] = [];
  for (const def of ordered) {
    const last = clusters[clusters.length - 1];
    if (last && last.cluster === def.cluster) last.actions.push(def);
    else clusters.push({ cluster: def.cluster, actions: [def] });
  }
  return clusters;
}

/** The actions that keep their own button in the session bar on a phone. */
export function phoneSessionBarActions(surface?: CanvasSurfaceId): readonly CanvasSessionActionDef[] {
  return canvasSessionActionsFor(surface).filter((def) => def.phone === 'bar');
}

/**
 * The actions the ••• sheet has to carry on a phone. This is the complement of the bar,
 * derived rather than listed, so the two can never disagree about an action and leave it
 * on neither.
 */
export function phoneOverflowActions(surface?: CanvasSurfaceId): readonly CanvasSessionActionDef[] {
  return canvasSessionActionsFor(surface).filter((def) => def.phone === 'menu');
}
