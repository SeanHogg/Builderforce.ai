import { canvasGridColumns, canvasLayoutViewport, DEFAULT_CANVAS_LAYOUT_WIDTH, MAX_CANVAS_GRID_COLUMNS, type CanvasLayoutViewport } from '@/lib/canvasGridFit';
import type { CreationFlowNode } from './CreationNode';

export type CanvasArrangement = 'grid' | 'row' | 'column';

type CreationObjectKind = CreationFlowNode['data']['kind'];

const DEFAULT_WIDTH_BY_KIND: Partial<Record<CreationObjectKind, number>> = {
  agent: 285,
  chat: 280,
  evaluation: 650,
  diagnostics: 720,
  staff: 245,
};

const WIDE_KINDS = new Set<CreationObjectKind>([
  'workflow', 'website', 'prototype', 'dashboard', 'chart', 'report', 'roadmap',
  'slides', 'document', 'diagram', 'prd', 'code', 'table', 'spreadsheet', 'featureSummary',
  'mockupSet', 'evermind', 'projectComparison', 'frame',
  'pitch', 'pitchScorecard', 'pitchQa', 'pitchApplication',
]);

/** The breathing room between two objects that must not touch. */
export const CANVAS_OBJECT_GAP = 40;

/**
 * Where an object with no requested coordinates starts. Historic values, kept
 * because they are what a fresh board's first card has always been placed at;
 * named here so the packer and its tests stop repeating the literals.
 */
const DEFAULT_AUTHORED_X = 520;
const DEFAULT_AUTHORED_Y = 280;

/**
 * Room kept to the right of the last card in a row. A row allowed to run to the
 * exact edge of the board puts its final card half under the inspector panel.
 */
const CANVAS_BOARD_MARGIN = 120;

/**
 * The footprint an object of this kind takes before anything has measured it.
 *
 * Used both for a card React Flow has not rendered yet and for one that is about
 * to be authored, so a brand-new object is placed against a realistic rectangle
 * rather than a generic one — an evaluation is 650px wide and would otherwise be
 * dropped straight on top of its neighbour.
 */
export function canvasKindFootprint(kind: CreationObjectKind): { width: number; height: number } {
  return {
    width: DEFAULT_WIDTH_BY_KIND[kind] ?? (WIDE_KINDS.has(kind) ? 455 : 260),
    height: kind === 'chat' || kind === 'frame' ? 300 : 180,
  };
}

/** Return the actual rendered footprint when React Flow has measured it. */
export function canvasNodeDimensions(node: CreationFlowNode): { width: number; height: number } {
  const styledWidth = typeof node.style?.width === 'number' ? node.style.width : undefined;
  const styledHeight = typeof node.style?.height === 'number' ? node.style.height : undefined;
  const fallback = canvasKindFootprint(node.data.kind);
  return {
    width: node.measured?.width ?? node.width ?? styledWidth ?? fallback.width,
    height: node.measured?.height ?? node.height ?? styledHeight ?? fallback.height,
  };
}

/**
 * Whether this object may be repositioned at all.
 *
 * A locked placement is locked in every view — arranging, aligning, nudging with
 * the arrow keys, dragging through the 3D space. One predicate, so a new way to
 * move an object cannot quietly forget to honour the lock.
 */
export function canvasPlacementUnlocked(node: CreationFlowNode): boolean {
  return node.data.placementLocked !== true;
}

/** Arrangement is canvas-wide by default, even when the prompt composer is scoped to one selected object. */
export function canvasArrangementTargets(nodes: CreationFlowNode[], requestedIds?: ReadonlySet<string> | null): CreationFlowNode[] {
  return nodes.filter((node) => (
    (!requestedIds || requestedIds.has(node.id))
    && node.hidden !== true
    && node.data.placementHidden !== true
    && canvasPlacementUnlocked(node)
  ));
}

interface PlacedRect { x: number; y: number; width: number; height: number }

function canvasNodeRect(node: CreationFlowNode): PlacedRect {
  return { x: node.position.x, y: node.position.y, ...canvasNodeDimensions(node) };
}

function rectsCollide(a: PlacedRect, b: PlacedRect, gap: number): boolean {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap
    && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
}

/**
 * The nearest point at or beside `anchor` where a card of `size` touches nothing.
 *
 * Objects authored by Brain arrive with coordinates it chose (or with none at
 * all, which used to mean every one of them landed on the same default point),
 * so the board routinely ended up with cards stacked on top of each other.
 *
 * ── WHY THIS WALKS SIDEWAYS FIRST ────────────────────────────────────────────
 * It used to walk only DOWNWARD — the anchor's column was kept and only the
 * depth moved, on the reasoning that depth is the axis a board can always grow
 * along. That is true and it was the wrong axis to prefer. A generated board is
 * a BATCH: ten objects authored in one turn, none of them carrying coordinates,
 * each one placed against the nine before it. Preferring depth turned every such
 * batch into a single column running off the bottom of the window — on a 3440px
 * screen, one narrow ribbon of cards with two thirds of the board empty beside
 * it, which is exactly the "I cannot see what I was given" complaint this fixes.
 *
 * So a row fills to `wrapWidth` first and only then starts a new row, which is
 * how anything else that lays out a set of cards behaves. `wrapWidth` is measured
 * from the ANCHOR, not from the board origin: the caller's anchor is its intent
 * ("next to this object"), and the row grows to the right of it.
 *
 * Termination: a sideways step always lands strictly right of the card it
 * collided with and is bounded by `wrapWidth`; a wrap always lands strictly
 * below the current row, because a colliding rect's bottom edge is by definition
 * past the candidate's top edge. The guard only bounds pathological boards.
 */
export function freeCanvasSlot(
  nodes: readonly CreationFlowNode[],
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  options: { gap?: number; wrapWidth?: number } = {},
): { x: number; y: number } {
  const gap = options.gap ?? CANVAS_OBJECT_GAP;
  const occupied = nodes
    .filter((node) => node.hidden !== true && node.data.placementHidden !== true && node.data.kind !== 'frame')
    .map(canvasNodeRect);
  // A row at least one card wide, however little room the caller reported.
  const rowRight = anchor.x + Math.max(size.width, options.wrapWidth ?? size.width);
  let candidate = { ...anchor };
  const limit = (occupied.length + 1) * (occupied.length + 1) + 1;
  for (let guard = 0; guard < limit; guard += 1) {
    const clash = occupied.find((rect) => rectsCollide({ ...candidate, ...size }, rect, gap));
    if (!clash) return candidate;
    const beside = clash.x + clash.width + gap;
    if (beside + size.width <= rowRight) { candidate = { x: beside, y: candidate.y }; continue; }
    // Down to the tightest next row, back at the anchor's column. Every bottom
    // edge considered is strictly below the candidate, so `y` only ever grows.
    const below = occupied
      .map((rect) => rect.y + rect.height + gap)
      .filter((edge) => edge > candidate.y);
    candidate = { x: anchor.x, y: below.length ? Math.min(...below) : clash.y + clash.height + gap };
  }
  return candidate;
}

/**
 * Where a brand-new authored object goes.
 *
 * On a stacking screen: below the current stack, in the column the board already
 * occupies. Everywhere else: at the requested point, packed ACROSS the board's
 * measured width before it grows downward — see `freeCanvasSlot` for why that
 * order is the whole point. Either way it never lands on top of something else.
 *
 * The viewport arrives as a measurement rather than as a `narrow` boolean because
 * "how wide is the board" and "is this a phone" are two different questions and
 * the packer needs both; see `lib/canvasGridFit.ts`.
 */
export function nextCanvasObjectPosition(
  nodes: readonly CreationFlowNode[],
  requested: { x?: number; y?: number },
  viewport: CanvasLayoutViewport = canvasLayoutViewport(),
  kind: CreationObjectKind = 'note',
): { x: number; y: number } {
  const explicitX = Number.isFinite(requested.x);
  const explicitY = Number.isFinite(requested.y);
  const size = canvasKindFootprint(kind);
  const visible = nodes.filter((node) => node.hidden !== true && node.data.placementHidden !== true);
  if (!viewport.narrow || (explicitX && explicitY)) {
    const anchor = {
      x: explicitX ? Number(requested.x) : DEFAULT_AUTHORED_X,
      y: explicitY ? Number(requested.y) : DEFAULT_AUTHORED_Y,
    };
    // The row runs from the anchor to the right-hand edge of the board, less the
    // margin that keeps the last card off the edge. On a phone this collapses to
    // one card wide inside `freeCanvasSlot`, which is the stacking behaviour.
    return freeCanvasSlot(nodes, anchor, size, { wrapWidth: viewport.width - CANVAS_BOARD_MARGIN });
  }
  const anchor = {
    x: explicitX ? Number(requested.x) : (visible.length ? Math.min(...visible.map((node) => node.position.x)) : 80),
    y: explicitY ? Number(requested.y) : (visible.length ? Math.max(...visible.map((node) => node.position.y + canvasNodeDimensions(node).height)) : 32) + 48,
  };
  return freeCanvasSlot(nodes, anchor, size, { wrapWidth: size.width });
}

/**
 * Place a batch of objects that is about to be appended to the board.
 *
 * ── THE PILE THIS ENDS ───────────────────────────────────────────────────────
 * `newNode(kind, position)` takes its position verbatim, and 28 call sites in
 * the canvas host appended straight onto `current` with whatever point they had
 * computed. Most of them computed the SAME point — the viewport centre — so a
 * turn that seated five @-mentioned agents put five cards on one coordinate and
 * a board that looked like it had one agent on it. A real session's diagnostics
 * showed six `agent` objects all at `{ x: 312.57, y: 182.01 }`, exactly.
 *
 * Batching is why placing at the call site could not fix it: five `setNodes`
 * updaters queued in one tick each saw the board as it was BEFORE any of them
 * applied. So placement happens HERE, inside the updater, against `current` plus
 * everything this same batch has already placed.
 *
 * It only ever MOVES A COLLISION. An addition whose requested point is clear —
 * a template that laid its own steps out, a frame preset, a card dropped on an
 * empty patch of board — is returned exactly where it asked to be, which is what
 * keeps an authored layout authored.
 */
export function placeAppendedCanvasNodes(
  current: readonly CreationFlowNode[],
  additions: readonly CreationFlowNode[],
  viewport: CanvasLayoutViewport = canvasLayoutViewport(),
): CreationFlowNode[] {
  if (!additions.length) return [];
  const placed: CreationFlowNode[] = [];
  const wrapWidth = viewport.narrow ? 0 : viewport.width - CANVAS_BOARD_MARGIN;
  for (const node of additions) {
    const size = canvasNodeDimensions(node);
    const position = freeCanvasSlot([...current, ...placed], node.position, size, { wrapWidth });
    placed.push(position.x === node.position.x && position.y === node.position.y ? node : { ...node, position });
  }
  return placed;
}

/**
 * Left-align a selection into a tidy column instead of a pile.
 *
 * Aligning used to set one x on every selected object and leave y alone, which
 * turns any row of objects — the usual thing to select — into a stack of cards
 * sitting on top of each other. Alignment on this board means "line these up so
 * I can read them", so the column is also spaced: same left edge, existing top-
 * to-bottom order, nothing overlapping.
 *
 * Locked objects still set where the column starts but are never moved.
 */
export function alignCanvasNodesLeft(
  nodes: readonly CreationFlowNode[],
  ids: ReadonlySet<string>,
  gap = CANVAS_OBJECT_GAP,
): Map<string, { x: number; y: number }> {
  const selected = nodes.filter((node) => ids.has(node.id));
  const movable = selected.filter(canvasPlacementUnlocked);
  if (movable.length < 2) return new Map();
  const left = Math.min(...selected.map((node) => node.position.x));
  const ordered = [...movable].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id));
  let y = Math.min(...ordered.map((node) => node.position.y));
  return new Map(ordered.map((node) => {
    const placement = { x: left, y };
    y += canvasNodeDimensions(node).height + gap;
    return [node.id, placement] as const;
  }));
}

/**
 * Lay out nodes from their real footprints. Row/column maxima make the returned
 * rectangles non-overlapping even when cards have very different dimensions.
 *
 * The default column count is FITTED to the board rather than derived from the
 * object count. It used to be `ceil(sqrt(n))` capped at eight — a number that
 * cannot tell a phone from an ultrawide, so twelve objects were four columns on
 * both and "arrange" on a wide screen handed back a tall block with most of the
 * board empty beside it. An explicit `requestedColumns` still wins: a person who
 * asked for three columns wants three.
 */
export function arrangeCanvasNodes(
  nodes: CreationFlowNode[],
  arrangement: CanvasArrangement = 'grid',
  requestedGap = 48,
  requestedColumns?: number,
  availableWidth = DEFAULT_CANVAS_LAYOUT_WIDTH,
): Map<string, { x: number; y: number }> {
  if (!nodes.length) return new Map();
  const ordered = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id));
  const gap = Math.max(16, Math.min(Number.isFinite(requestedGap) ? requestedGap : 48, 320));
  const fitted = canvasGridColumns({
    available: availableWidth,
    // The grid sizes every column to the widest card in it, so that is the width
    // to fit by — an average would hang the last column off the board.
    columnWidth: Math.max(...ordered.map((node) => canvasNodeDimensions(node).width)),
    gap,
    count: ordered.length,
  });
  const columns = arrangement === 'column'
    ? 1
    : arrangement === 'row'
      ? ordered.length
      : Math.max(1, Math.min(Math.round(requestedColumns || fitted), ordered.length, MAX_CANVAS_GRID_COLUMNS));
  const rows = Math.ceil(ordered.length / columns);
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: rows }, () => 0);
  ordered.forEach((node, index) => {
    const { width, height } = canvasNodeDimensions(node);
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column]!, width);
    rowHeights[row] = Math.max(rowHeights[row]!, height);
  });
  const columnX = columnWidths.map((_, index) => columnWidths.slice(0, index).reduce((sum, width) => sum + width + gap, 0));
  const rowY = rowHeights.map((_, index) => rowHeights.slice(0, index).reduce((sum, height) => sum + height + gap, 0));
  const originX = Math.min(...ordered.map((node) => node.position.x));
  const originY = Math.min(...ordered.map((node) => node.position.y));
  return new Map(ordered.map((node, index) => [node.id, {
    x: originX + columnX[index % columns]!,
    y: originY + rowY[Math.floor(index / columns)]!,
  }]));
}
