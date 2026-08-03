import type { CreationFlowNode } from './CreationNode';

export type CanvasArrangement = 'grid' | 'row' | 'column';

const DEFAULT_WIDTH_BY_KIND: Partial<Record<CreationFlowNode['data']['kind'], number>> = {
  agent: 285,
  chat: 280,
  evaluation: 650,
  staff: 245,
};

const WIDE_KINDS = new Set<CreationFlowNode['data']['kind']>([
  'workflow', 'website', 'prototype', 'dashboard', 'chart', 'report', 'roadmap',
  'slides', 'document', 'prd', 'code', 'table', 'spreadsheet', 'featureSummary',
  'mockupSet', 'evermind', 'projectComparison', 'frame',
]);

/** Return the actual rendered footprint when React Flow has measured it. */
export function canvasNodeDimensions(node: CreationFlowNode): { width: number; height: number } {
  const measuredWidth = node.measured?.width;
  const measuredHeight = node.measured?.height;
  const styledWidth = typeof node.style?.width === 'number' ? node.style.width : undefined;
  const styledHeight = typeof node.style?.height === 'number' ? node.style.height : undefined;
  return {
    width: measuredWidth ?? node.width ?? styledWidth ?? DEFAULT_WIDTH_BY_KIND[node.data.kind] ?? (WIDE_KINDS.has(node.data.kind) ? 455 : 260),
    height: measuredHeight ?? node.height ?? styledHeight ?? (node.data.kind === 'chat' ? 300 : node.data.kind === 'frame' ? 300 : 180),
  };
}

/** Arrangement is canvas-wide by default, even when the prompt composer is scoped to one selected object. */
export function canvasArrangementTargets(nodes: CreationFlowNode[], requestedIds?: ReadonlySet<string> | null): CreationFlowNode[] {
  return nodes.filter((node) => (
    (!requestedIds || requestedIds.has(node.id))
    && node.hidden !== true
    && node.data.placementHidden !== true
    && node.data.placementLocked !== true
  ));
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
