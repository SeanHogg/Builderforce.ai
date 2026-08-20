/**
 * The ORDERED SEQUENCE a presentation walks — the half of present mode that was missing.
 *
 * ── WHAT ALREADY EXISTED, AND WHY IT WAS NOT ENOUGH ──────────────────────────────
 * `presentMode` ships, is shared through `liveSession.setPresentMode`, is reachable from
 * a `slides` object's `present` action and the ••• menu, and follow-mode ships beside it:
 * a viewer who follows the presenter is pulled along by the presenter's own viewport,
 * which the presence channel already carries on every pan and zoom.
 *
 * What was absent is the SEQUENCE. Toggling present mode hides the chrome and then
 * leaves navigation to whoever is driving, so "walk the room through this board" is a
 * person remembering which card comes next and panning to it by hand — in front of an
 * audience, with a follower's viewport snapping along behind every mis-aimed drag. Miro
 * walks a numbered list of frames; ours had no list.
 *
 * ── WHY THE SEQUENCE IS DERIVED AND NOT STORED ───────────────────────────────────
 * The obvious design is an ordered array of node ids on the session. It is wrong for the
 * reason every stored ordering is wrong here: a frame deleted on one client leaves a
 * dangling id, a frame added by a collaborator is absent from a list nobody updated, and
 * two people reordering at once produce a list that has to be merged. The board already
 * knows what is on it.
 *
 * So the order is a FUNCTION of the board, with an authored override:
 *   1. `presentationOrder` on a frame, when somebody has said what they want.
 *   2. Reading order otherwise — top to bottom, then left to right, banded so that two
 *      frames roughly side by side are read as a row rather than by a one-pixel
 *      difference in `y`.
 *
 * That makes an added frame appear in the sequence with no bookkeeping, a deleted one
 * disappear, and a reorder a single field edit on one card rather than a shared list.
 *
 * ── WHY ONLY FRAMES ──────────────────────────────────────────────────────────────
 * A `frame` is the canvas's own "this group of things is a thing" primitive, and it is
 * already the object a person reaches for when arranging a board for somebody else to
 * read. Making every object a potential step would produce a 180-step sequence on a real
 * board, which is not a presentation. A board with NO frames has no sequence, and present
 * mode behaves exactly as it does today — the feature adds a control where a sequence
 * exists and is invisible where one does not.
 *
 * Pure and framework-free: the canvas owns the camera, this owns the order.
 */

/** The minimum a step needs to be computed. Structural, so a test needs no React Flow. */
export interface PresentationNodeInput {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  data: { kind: string; title?: unknown; presentationOrder?: unknown; hidden?: unknown };
  hidden?: boolean;
}

export interface PresentationStep {
  /** 1-based, for display. A person counts slides from one. */
  index: number;
  nodeId: string;
  title: string;
  /** The rectangle the camera frames, in flow coordinates. */
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * How far apart two frames must be VERTICALLY before the later one is a new row.
 *
 * Without a band, sorting by `y` alone makes two frames laid out side by side at 400 and
 * 404 read as two separate rows in an order nobody can predict, because which comes
 * first depends on a drag nobody meant to be significant. 160 is roughly the height of
 * the smallest card, which is the scale at which a difference in `y` starts to mean
 * something a person intended.
 */
const ROW_BAND = 160;

/**
 * An authored order, or nothing.
 *
 * The blank check is load-bearing and was missing on the first pass: `Number('')` is
 * `0`, which is finite — so every frame that had never been numbered read as
 * `presentationOrder: 0`, every frame compared equal, and the authored override did
 * nothing at all while appearing to work. A field that is absent and a field that says
 * "first" must not become the same number.
 */
const orderValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * The board's frames, in the order a presentation walks them.
 *
 * Hidden frames are excluded: a hidden object is one the author took off the board for
 * now, and walking an audience to a blank rectangle is worse than skipping it.
 */
export function presentationSequence(nodes: readonly PresentationNodeInput[]): PresentationStep[] {
  const frames = nodes.filter((node) => node.data.kind === 'frame' && node.hidden !== true && node.data.hidden !== true);
  const ordered = [...frames].sort((left, right) => {
    const leftOrder = orderValue(left.data.presentationOrder);
    const rightOrder = orderValue(right.data.presentationOrder);
    // An AUTHORED order always wins, and an authored frame always precedes an
    // unauthored one: somebody who numbered three frames on a board of ten meant those
    // three to open, not to be interleaved wherever they happen to sit.
    if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) return leftOrder - rightOrder;
    if (leftOrder !== undefined && rightOrder === undefined) return -1;
    if (leftOrder === undefined && rightOrder !== undefined) return 1;
    const rowDelta = left.position.y - right.position.y;
    if (Math.abs(rowDelta) > ROW_BAND) return rowDelta;
    const columnDelta = left.position.x - right.position.x;
    if (columnDelta !== 0) return columnDelta;
    // Last resort, and it must be TOTAL: two frames at one point would otherwise sort
    // differently on different clients, and a presentation whose order depends on which
    // browser is driving is not a shared presentation.
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  return ordered.map((node, position) => ({
    index: position + 1,
    nodeId: node.id,
    title: typeof node.data.title === 'string' && node.data.title.trim() ? node.data.title.trim() : '',
    bounds: { x: node.position.x, y: node.position.y, width: node.width, height: node.height },
  }));
}

/**
 * The step index after moving by `delta`, CLAMPED rather than wrapped.
 *
 * Wrapping is the wrong behaviour for a presentation and it is a mistake people make
 * once: pressing → on the last slide in front of a room jumps back to the title, which
 * reads as a crash. Clamping means the last slide stays put, which is what a presenter
 * expects and what every deck tool does.
 *
 * Returns `null` when there is nothing to step through, so a caller cannot accidentally
 * point a camera at index 0 of an empty sequence.
 */
export function stepPresentation(current: number, delta: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.max(0, Math.min(total - 1, current + delta));
}

/**
 * The step a given index refers to, tolerating an index the board has outgrown.
 *
 * A collaborator deleting the frame you are standing on is not an error — the sequence
 * simply got shorter underneath you, and the honest response is to land on the last
 * remaining step rather than to blank the control.
 */
export function presentationStepAt(steps: readonly PresentationStep[], index: number): PresentationStep | null {
  if (!steps.length) return null;
  return steps[Math.max(0, Math.min(steps.length - 1, index))] ?? null;
}

/**
 * The viewport that frames one step inside a given screen.
 *
 * Computed here rather than delegated to React Flow's `fitView` for one reason: `fitView`
 * takes node ids and fits the nodes THEMSELVES, so it frames a `frame` object tightly to
 * its own rectangle — and a frame's whole purpose is to contain other cards, which then
 * sit exactly at the edge of the screen. This adds the margin a presented slide needs,
 * and returns a viewport rather than performing a fit, which is what lets the same number
 * be published to followers through the presence channel that already carries it.
 *
 * `maxZoom` exists because a small frame on a large screen would otherwise be magnified
 * until its text is comic: past about 1.6 a presented card looks broken rather than
 * close.
 */
export function presentationViewport(
  bounds: { x: number; y: number; width: number; height: number },
  screen: { width: number; height: number },
  options: { padding?: number; maxZoom?: number } = {},
): { x: number; y: number; zoom: number } {
  const padding = options.padding ?? 0.12;
  const maxZoom = options.maxZoom ?? 1.6;
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const usableWidth = Math.max(1, screen.width) * (1 - padding * 2);
  const usableHeight = Math.max(1, screen.height) * (1 - padding * 2);
  const zoom = Math.min(maxZoom, Math.max(0.05, Math.min(usableWidth / width, usableHeight / height)));
  return {
    x: screen.width / 2 - (bounds.x + width / 2) * zoom,
    y: screen.height / 2 - (bounds.y + height / 2) * zoom,
    zoom,
  };
}
