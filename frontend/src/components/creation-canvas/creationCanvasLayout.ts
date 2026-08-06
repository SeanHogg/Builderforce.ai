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
]);

/** The breathing room between two objects that must not touch. */
export const CANVAS_OBJECT_GAP = 40;

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
 * The nearest point at or below `anchor` where a card of `size` touches nothing.
 *
 * Objects authored by Brain arrive with coordinates it chose (or with none at
 * all, which used to mean every one of them landed on the same default point),
 * so the board routinely ended up with cards stacked on top of each other. The
 * anchor's column is kept — that is the caller's intent, "next to this object" —
 * and only the depth moves, which is the axis a board can always grow along.
 *
 * Each step lands strictly below the card it collided with, so the walk always
 * terminates; the guard only bounds pathological boards.
 */
export function freeCanvasSlot(
  nodes: readonly CreationFlowNode[],
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  gap = CANVAS_OBJECT_GAP,
): { x: number; y: number } {
  const occupied = nodes
    .filter((node) => node.hidden !== true && node.data.placementHidden !== true && node.data.kind !== 'frame')
    .map(canvasNodeRect);
  let candidate = { ...anchor };
  for (let guard = 0; guard <= occupied.length; guard += 1) {
    const clash = occupied.find((rect) => rectsCollide({ ...candidate, ...size }, rect, gap));
    if (!clash) return candidate;
    candidate = { x: candidate.x, y: clash.y + clash.height + gap };
  }
  return candidate;
}

/**
 * Place an authored object: below the current stack on narrow screens, at the
 * requested point otherwise — and, either way, never on top of something else.
 */
export function nextCanvasObjectPosition(
  nodes: readonly CreationFlowNode[],
  requested: { x?: number; y?: number },
  narrow: boolean,
  kind: CreationObjectKind = 'note',
): { x: number; y: number } {
  const explicitX = Number.isFinite(requested.x);
  const explicitY = Number.isFinite(requested.y);
  const visible = nodes.filter((node) => node.hidden !== true && node.data.placementHidden !== true);
  const anchor = !narrow || (explicitX && explicitY)
    ? { x: explicitX ? Number(requested.x) : 520, y: explicitY ? Number(requested.y) : 280 }
    : {
      x: explicitX ? Number(requested.x) : (visible.length ? Math.min(...visible.map((node) => node.position.x)) : 80),
      y: explicitY ? Number(requested.y) : (visible.length ? Math.max(...visible.map((node) => node.position.y + canvasNodeDimensions(node).height)) : 32) + 48,
    };
  return freeCanvasSlot(nodes, anchor, canvasKindFootprint(kind));
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
 */
export function arrangeCanvasNodes(
  nodes: CreationFlowNode[],
  arrangement: CanvasArrangement = 'grid',
  requestedGap = 48,
  requestedColumns?: number,
): Map<string, { x: number; y: number }> {
  if (!nodes.length) return new Map();
  const ordered = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id));
  const gap = Math.max(16, Math.min(Number.isFinite(requestedGap) ? requestedGap : 48, 320));
  const columns = arrangement === 'column'
    ? 1
    : arrangement === 'row'
      ? ordered.length
      : Math.max(1, Math.min(Math.round(requestedColumns || Math.ceil(Math.sqrt(ordered.length))), ordered.length, 8));
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
