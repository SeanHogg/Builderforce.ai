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
  | 'draw'
  | 'undo'
  | 'redo'
  | 'run'
  | 'present'
  | 'outcomes'
  | 'diagnostics'
  | 'walkthrough'
  | 'call'
  | 'standup'
  | 'talktrack'
  | 'share'
  | 'prove'
  | 'publish'
  | 'fullscreen';

/**
 * The set an action belongs to — WHICH STAGE OF THE ARC IT SERVES.
 *
 * A cluster is drawn as ONE segmented control in a shared trough, captioned by the group
 * registry, because a trough says "these are the same kind of thing" and only the caption
 * can say WHICH kind.
 *
 * ── WHY THESE FIVE WORDS AND NOT THE OLD FIVE ────────────────────────────────────
 * The clusters used to be `run · history · inspect · live · session` — names taken from
 * how the actions are implemented. They captioned the bar as `Workflow · History · Tools ·
 * Live · Share`, and every one of those is a shelf rather than a purpose: *Tools* held the
 * outcome scorecard, the diagnostics report AND full screen; *Live* held a call and a
 * screen recording; *Workflow* was a euphemism invented so the bar's Run would not read as
 * an object's Run.
 *
 * The product already teaches five words — `STAGES` in `lib/navGroups.ts`, the left rail's
 * `--stage-*` dots, the session's own phase in `lib/canvasPhases.ts` — and the bar was the
 * one surface not using them. So a cluster IS a stage now, and the bar reads
 * `Idea · Make · Run · Measure · Reach` left to right, in the same order and the same hues
 * as the rail. An action is filed under the stage whose question it answers.
 *
 * `board` is the one cluster that is not a stage, deliberately: full screen, and the ••• 
 * sheet's own contents, act on the BOARD rather than on the work. A control that answers
 * no stage's question must not be given a stage's caption — that is how `Tools` happened.
 */
export type CanvasSessionActionCluster = 'idea' | 'make' | 'run' | 'measure' | 'reach' | 'board';

/**
 * What an action NEEDS from the surface it is drawn on.
 *
 * ── WHY A REQUIREMENT AND NOT A LIST OF SURFACES ─────────────────────────────────
 * The bar used to be the same eight buttons on every surface, which put "align the
 * selected objects" and "read the outcome numbers for this board" on a conversation that
 * has no objects on it — a control whose only possible answer is nothing. The obvious fix
 * is `surfaces: ['graph', 'room']` on each entry, and it is the wrong one: every future
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
   * `icon` = a glyph inside its cluster's trough.
   * `roster` = a glyph drawn as a trailing chip on the roster itself — "bring a person
   *   into THIS group", so it belongs at the end of the avatars it grows rather than in
   *   its own worded button beside them.
   * `door` = a worded row inside the **Make it real** menu — the ways work LEAVES this
   *   canvas.
   *
   * ── WHY `labelled` IS GONE ───────────────────────────────────────────────────────
   * It meant "its own worded button on the bar", and the bar ended up with two of them
   * side by side — *Make it real* and *Publish* — which read as a fork between two things
   * that mean the same thing. A word opening somewhere else is still the rule; what
   * changed is that there is now ONE word for it, and the doors are rows under it. So the
   * chrome that used to say "give me a button" says "give me a row in that menu", and an
   * action added to it lands there without either call site being edited.
   */
  chrome: 'icon' | 'roster' | 'door';
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
  // ── IDEA · "What if?" ───────────────────────────────────────────────────────────
  // Putting something down. The palette's own door is contributed by the bar (it needs
  // the button's screen rect to open the picker above itself), so this cluster's only
  // registry action is the other way to put a mark on a board.
  //
  // Draw was a row in the ••• sheet, which filed "make a mark" alongside "export the
  // session" — one is the first thing anybody does on a canvas and the other is a
  // once-a-month errand.
  { id: 'draw', cluster: 'idea', order: 0, chrome: 'icon', state: 'pressed', phone: 'menu', labelKey: 'draw', activeLabelKey: 'stopDrawing', needs: 'board' },

  // ── MAKE · "Build it." ──────────────────────────────────────────────────────────
  // The three ways you shape what is already down. The prompt toggle is contributed by
  // the bar (the host owns the composer's placement) and leads this group: it is the main
  // input to the canvas, and it used to sit in VIEW beside nine zoom glyphs, which said
  // it was chrome.
  //
  // Undo keeps its phone slot: a fat-fingered drag on a touch board is the single
  // likeliest thing a phone user needs to take back, and burying the only cure two taps
  // deep is what makes a canvas feel unsafe to touch.
  { id: 'undo', cluster: 'make', order: 10, chrome: 'icon', state: 'none', phone: 'bar', labelKey: 'undoCanvasChange' },
  { id: 'redo', cluster: 'make', order: 11, chrome: 'icon', state: 'none', phone: 'menu', labelKey: 'redoCanvasChange' },

  // ── RUN · "Run it as a company." ────────────────────────────────────────────────
  // Start it, or show it running.
  //
  // WHY RUN IS A SESSION ACTION. It used to be a button drawn on the `workflow` card.
  // Then the card became what it always stood for: a `frame` bounding real `flowStep`
  // objects, because the board IS the workflow. There is no longer one card to hang Run
  // off — the flow is a REGION of the board — so running it is something you do to the
  // canvas, which is what this registry is for.
  //
  // Its caption used to read `Workflow`, a euphemism invented because a board can carry
  // objects with Run buttons of their own and two groups both called Run is ambiguous. A
  // stage name settles that without the euphemism: this is the RUN stage, and the
  // object's button is the object's.
  //
  // It withdraws (`available: false`) on a board with no flow on it, rather than sitting
  // lit up with nothing to run; the host decides that from the same predicate Run itself
  // resolves with (`canvasFlowTarget.ts`), so the button cannot be offered for one object
  // and then act on another.
  { id: 'run', cluster: 'run', order: 20, chrome: 'icon', state: 'none', phone: 'menu', labelKey: 'runCanvas', titleKey: 'runWorkflow', needs: 'objects' },
  // Present is showing the board running to somebody in the room. It was a ••• row under
  // "Create and view", a heading that filed "start something" with "show what you
  // started".
  { id: 'present', cluster: 'run', order: 21, chrome: 'icon', state: 'pressed', phone: 'menu', labelKey: 'present', activeLabelKey: 'exitPresentation' },

  // ── MEASURE · "Is it working?" ──────────────────────────────────────────────────
  // Three readings of this session. They shared a trough captioned `Tools`, which is a
  // shelf and not a purpose — and that shelf also held full screen, which reads nothing.
  //
  // The outcome scorecard reads THIS BOARD'S OBJECTS — deliverables, and what they were
  // worth. Over a conversation with nothing on it that is a button whose only answer is
  // "nothing", so it asks the surface for objects rather than naming which surfaces have
  // them.
  { id: 'outcomes', cluster: 'measure', order: 30, chrome: 'icon', state: 'expanded', phone: 'menu', labelKey: 'viewOutcomeMetrics', titleKey: 'outcomeMetricsTitle', needs: 'objects' },
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
  { id: 'diagnostics', cluster: 'measure', order: 31, chrome: 'icon', state: 'expanded', phone: 'menu', labelKey: 'openDiagnostics' },
  //
  // SHOW ME WHAT I WAS GIVEN.
  //
  // A generated board is the product working and, for the person who asked one question
  // and got twenty-four objects back, a wall. The canvas already had a tour and it toured
  // the CHROME — Brain dock, palette, Share — which teaches the tool and says nothing
  // about the work. This one walks the ARTIFACTS, which is a reading of the board and so
  // belongs with the other two.
  //
  // It needs OBJECTS for the reason the scorecard does, and the host withdraws it as well
  // (`available: false`) on a board too small to get lost in — three cards do not need a
  // guide, and an offer to walk somebody round them reads as the product not trusting
  // them. That threshold is the walkthrough's own (`MIN_WALKTHROUGH_OBJECTS`), asked
  // once, rather than a number repeated here.
  { id: 'walkthrough', cluster: 'measure', order: 32, chrome: 'icon', state: 'expanded', phone: 'menu', labelKey: 'walkthrough.action', titleKey: 'walkthrough.actionTitle', needs: 'objects' },

  // ── REACH · "Sell it, be found, grow it." ───────────────────────────────────────
  // Getting it in front of somebody: a collaborator, a viewer, a buyer. The roster leads
  // the group (contributed by the bar, which owns the session's member list), then the
  // two ways to talk somebody through it, then the doors out.
  //
  // Share draws as the trailing chip on the roster, not a worded button beside it: "who
  // is here" and "bring someone else in" are one group to look at, and the word was the
  // only thing telling them apart. The glyph opens the same sheet, so nothing about WHAT
  // it does changed.
  { id: 'share', cluster: 'reach', order: 40, chrome: 'roster', state: 'expanded', phone: 'menu', labelKey: 'share', titleKey: 'inviteCollaborators' },
  //
  // TALKTRACK — the recording of this board, beside the live version of it.
  //
  // It needs nothing from the surface, deliberately. A talktrack is a screen recording of
  // whatever is on screen, which is as true of a running app or a 3D space as it is of
  // the board — and the conversation surface is where somebody is most likely to be
  // explaining what they just asked for. The recording becomes a `video` object on the
  // board like anything else the canvas produces, and leaves by whichever door that
  // object then takes.
  { id: 'talktrack', cluster: 'reach', order: 41, chrome: 'icon', state: 'expanded', phone: 'menu', labelKey: 'recordTalktrack', titleKey: 'recordTalktrackTitle' },
  //
  // THE CALL IS AN ACTION, NOT A STRIP OF ITS OWN.
  //
  // Starting a call used to be a dormant band across the bottom of the shell — a control
  // and a line of explanation, occupying a measured band of the window on every canvas
  // nobody was calling from, which is every canvas almost all of the time. As a registry
  // action it applies to EVERY modality by construction: chat, board, 3D space and a
  // running app all draw the same bar from this list.
  //
  // The host withdraws it (`available: false`) the moment a call is running: from then on
  // the dock IS the control, and a second lit "call" button in the bar would be one
  // decision with two homes.
  { id: 'call', cluster: 'reach', order: 42, chrome: 'icon', state: 'none', phone: 'menu', labelKey: 'startCall', titleKey: 'startCallTitle' },
  //
  // THE STANDUP IS THE CALL'S NEIGHBOUR. It used to be a captioned group the room
  // surface published into the bar — a project picker, two steppers and a Start button
  // — which pushed the bar out under the Brain panel and hid a meeting behind one
  // surface. A standup is people agreeing to talk about this canvas, which is what a
  // call is, so it sits beside it on every surface. `pressed` while one is running:
  // pressing again finishes it. The host decides the project (`useCanvasStandupAction`).
  { id: 'standup', cluster: 'reach', order: 43, chrome: 'icon', state: 'pressed', phone: 'menu', labelKey: 'startStandup', activeLabelKey: 'finishStandup', titleKey: 'startStandupTitle' },
  //
  // ── THE DOORS OUT, behind ONE word ──────────────────────────────────────────────
  //
  // These two used to be two worded buttons side by side on the bar — Make it real and
  // Publish — which reads as a fork between two things that both mean "ship it". They are
  // rows under one trigger now (`chrome: 'door'`), and the trigger keeps the verb the
  // methodology already uses.
  //
  // PROVE IT is the act the whole method turns on. Reading an idea is cheap and building
  // is not, so choosing WHICH proof is worth running is the most consequential decision
  // in the first month of anything. That choice lived only on `/realize`, reachable from
  // the nav and from nowhere a person is actually having the idea — so a board full of an
  // idea had no way to become a proof, and the loop's outcome events had no session to
  // attach to. Both halves are fixed by this door: it hands the board's own idea to the
  // proof picker and names the session, which is what lets Read, Prove, Build and Measure
  // be recorded against it and the north-star metric be computed at all.
  //
  // Its label is `proveIt` and NOT `proveThisIdea`: that key reads "Make it real", which
  // is now the word on the trigger these rows hang under, and a menu whose first row
  // repeats the button that opened it says nothing. The hover text is unchanged, because
  // what it does is unchanged.
  //
  // It needs OBJECTS for the same reason the scorecard does: proving a conversation with
  // nothing on it has nothing to prove.
  { id: 'prove', cluster: 'reach', order: 43, chrome: 'door', state: 'none', phone: 'menu', labelKey: 'proveIt', titleKey: 'proveThisIdeaTitle', needs: 'objects' },
  // PUBLISH puts the result where strangers can reach it. It is here from the first
  // second of a session, before there is anything worth publishing, and that is the
  // point: it was previously reachable ONLY through `SellInMarketplace` in a selected
  // card's inspector, which made "get this to a URL" three clicks deep, framed as
  // commerce, and invisible until you had clicked the right card. It opens the SAME
  // release lifecycle that button does — one gate, two doors — scoped to the whole board,
  // which is the scope an application actually has.
  { id: 'publish', cluster: 'reach', order: 44, chrome: 'door', state: 'expanded', phone: 'menu', labelKey: 'publishCanvas', titleKey: 'publishCanvasTitle' },

  // ── BOARD · not a stage, and that is the point ──────────────────────────────────
  // Full screen answers no stage's question — it is done to the board, not to the work —
  // so it sits in the one group with no stage name rather than being filed under a stage
  // it does not serve. It used to live in `Tools` beside the diagnostics report, which is
  // how a shelf forms.
  //
  // It keeps its phone slot for the reason it always had one: a small screen is where
  // trading app chrome for board is worth the most.
  { id: 'fullscreen', cluster: 'board', order: 50, chrome: 'icon', state: 'pressed', phone: 'bar', labelKey: 'fullScreen', activeLabelKey: 'exitFullScreen' },
];

const BY_ID = new Map<CanvasSessionActionId, CanvasSessionActionDef>(
  CANVAS_SESSION_ACTIONS.map((def) => [def.id, def]),
);

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
