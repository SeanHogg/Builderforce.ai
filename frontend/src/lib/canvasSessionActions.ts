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

export type CanvasSessionActionId =
  | 'undo'
  | 'redo'
  | 'outcomes'
  | 'diagnostics'
  | 'fullscreen'
  | 'share';

/**
 * The set an action belongs to. A cluster is drawn as ONE segmented control in a shared
 * trough — the same shape the surface switcher uses — because a trough is what says
 * "these are the same kind of thing" without a caption saying it.
 */
export type CanvasSessionActionCluster = 'history' | 'inspect' | 'session';

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
  { id: 'outcomes', cluster: 'inspect', order: 2, chrome: 'icon', state: 'expanded', phone: 'menu', labelKey: 'viewOutcomeMetrics', titleKey: 'outcomeMetricsTitle' },
  { id: 'diagnostics', cluster: 'inspect', order: 3, chrome: 'icon', state: 'expanded', phone: 'menu', labelKey: 'openDiagnostics' },
  // Full screen keeps its phone slot for the reason it always had one: a small screen is
  // where trading app chrome for board is worth the most.
  { id: 'fullscreen', cluster: 'inspect', order: 4, chrome: 'icon', state: 'pressed', phone: 'bar', labelKey: 'fullScreen', activeLabelKey: 'exitFullScreen' },
  // Share is the only worded action, and now the ONLY control that opens the invite
  // panel: the collaborator roster's `+` used to open the same sheet, which is one
  // decision with two controls — the thing the surface registry exists to prevent.
  { id: 'share', cluster: 'session', order: 5, chrome: 'labelled', state: 'expanded', phone: 'menu', labelKey: 'share', titleKey: 'inviteCollaborators' },
];

const BY_ID = new Map<CanvasSessionActionId, CanvasSessionActionDef>(
  CANVAS_SESSION_ACTIONS.map((def) => [def.id, def]),
);

export function canvasSessionAction(id: CanvasSessionActionId): CanvasSessionActionDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown canvas session action: ${id}`);
  return def;
}

/** Declaration order, grouped into the troughs the bar draws. */
export function canvasSessionClusters(): readonly { cluster: CanvasSessionActionCluster; actions: readonly CanvasSessionActionDef[] }[] {
  const ordered = [...CANVAS_SESSION_ACTIONS].sort((a, b) => a.order - b.order);
  const clusters: { cluster: CanvasSessionActionCluster; actions: CanvasSessionActionDef[] }[] = [];
  for (const def of ordered) {
    const last = clusters[clusters.length - 1];
    if (last && last.cluster === def.cluster) last.actions.push(def);
    else clusters.push({ cluster: def.cluster, actions: [def] });
  }
  return clusters;
}

/** The actions that keep their own button in the session bar on a phone. */
export function phoneSessionBarActions(): readonly CanvasSessionActionDef[] {
  return CANVAS_SESSION_ACTIONS.filter((def) => def.phone === 'bar').sort((a, b) => a.order - b.order);
}

/**
 * The actions the ••• sheet has to carry on a phone. This is the complement of the bar,
 * derived rather than listed, so the two can never disagree about an action and leave it
 * on neither.
 */
export function phoneOverflowActions(): readonly CanvasSessionActionDef[] {
  return CANVAS_SESSION_ACTIONS.filter((def) => def.phone === 'menu').sort((a, b) => a.order - b.order);
}
