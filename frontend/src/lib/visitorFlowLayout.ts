/**
 * Where the flow graph's nodes and edges GO on screen — pure geometry.
 *
 * Kept out of the component for the reason every layout eventually needs it to
 * be: the arithmetic that decides a node's row, its band height and the control
 * points of the curve into it is the part that is worth asserting, and none of
 * it needs React to be true. The component receives coordinates and draws them.
 *
 * The layout is a LAYERED left-to-right flow, not a force-directed graph. A
 * visitor journey has a direction — earlier steps on the left, later on the
 * right — and a force layout would throw that away in exchange for a prettier
 * blob. Columns come from each node's median position in the visit, so the
 * horizontal axis reads as "how deep into the visit".
 */

export type VisitorFlowNodeKind = 'prompt' | 'page' | 'error' | 'exit' | 'converted';

export interface FlowNodeInput {
  id: string;
  kind: VisitorFlowNodeKind;
  label: string;
  visitors: number;
  events: number;
  exits: number;
  medianStepIndex: number;
}

export interface FlowEdgeInput {
  from: string;
  to: string;
  visitors: number;
  events: number;
}

export interface LaidOutNode extends FlowNodeInput {
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
  /** Share of this node's visitors whose visit ended here, 0–1. The drop-off. */
  exitRate: number;
}

export interface LaidOutEdge extends FlowEdgeInput {
  /** SVG cubic path from the right edge of `from` to the left edge of `to`. */
  path: string;
  strokeWidth: number;
  /** True when the edge runs backwards (a return to an earlier step). */
  backward: boolean;
}

export interface FlowLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

const NODE_WIDTH = 168;
const NODE_MIN_HEIGHT = 34;
const NODE_MAX_HEIGHT = 92;
const COLUMN_GAP = 96;
const ROW_GAP = 14;
const PADDING = 16;
const EDGE_MIN_WIDTH = 1.5;
const EDGE_MAX_WIDTH = 18;

/**
 * Lay the graph out.
 *
 * Node HEIGHT encodes visitor volume, which is the one quantity the reader is
 * comparing between steps, and it is encoded as a length on a common baseline
 * rather than an area — the perceptual reason bar charts beat bubble charts.
 * Edge WIDTH encodes the volume moving along it, on the same principle.
 *
 * Both are scaled against the busiest node/edge rather than an absolute count,
 * because the graph has to stay readable at ten visitors and at ten thousand.
 */
export function layoutVisitorFlow(
  nodes: FlowNodeInput[],
  edges: FlowEdgeInput[],
): FlowLayout {
  if (nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  const columns = assignColumns(nodes);
  const maxVisitors = Math.max(...nodes.map((n) => n.visitors), 1);
  const maxEdge = Math.max(...edges.map((e) => e.visitors), 1);

  const laidOut: LaidOutNode[] = [];
  let tallestColumn = 0;

  for (const [column, members] of columns) {
    let y = PADDING;
    for (const node of members) {
      const height = NODE_MIN_HEIGHT
        + (NODE_MAX_HEIGHT - NODE_MIN_HEIGHT) * Math.sqrt(node.visitors / maxVisitors);
      laidOut.push({
        ...node,
        column,
        x: PADDING + column * (NODE_WIDTH + COLUMN_GAP),
        y,
        width: NODE_WIDTH,
        height,
        exitRate: node.visitors > 0 ? Math.min(1, node.exits / node.visitors) : 0,
      });
      y += height + ROW_GAP;
    }
    tallestColumn = Math.max(tallestColumn, y);
  }

  const byId = new Map(laidOut.map((n) => [n.id, n]));
  const laidOutEdges: LaidOutEdge[] = [];
  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to || from === to) continue;
    laidOutEdges.push({
      ...edge,
      path: curveBetween(from, to),
      strokeWidth: EDGE_MIN_WIDTH
        + (EDGE_MAX_WIDTH - EDGE_MIN_WIDTH) * Math.sqrt(edge.visitors / maxEdge),
      backward: to.column <= from.column,
    });
  }

  const columnCount = Math.max(...laidOut.map((n) => n.column)) + 1;
  return {
    nodes: laidOut,
    edges: laidOutEdges,
    width: PADDING * 2 + columnCount * NODE_WIDTH + (columnCount - 1) * COLUMN_GAP,
    height: tallestColumn + PADDING,
  };
}

/**
 * Bucket nodes into columns by how deep into a visit they sit.
 *
 * `prompt` is pinned to column 0 and the terminal states to the last column
 * regardless of their median, because they are the frame the reader is looking
 * for: a funnel that drew "converted" in the middle because a few visitors
 * signed up quickly would be technically accurate and unreadable.
 */
function assignColumns(nodes: FlowNodeInput[]): Map<number, FlowNodeInput[]> {
  const terminal = (kind: VisitorFlowNodeKind) => kind === 'exit' || kind === 'converted';
  const middle = nodes.filter((n) => n.kind !== 'prompt' && !terminal(n.kind));

  const sorted = [...middle].sort((a, b) => a.medianStepIndex - b.medianStepIndex);
  // At most four middle columns: past that the nodes get too narrow to label,
  // and "step 6 vs step 7 of a visit" is not a distinction anyone acts on.
  const middleColumns = Math.min(4, Math.max(1, Math.ceil(sorted.length / 4)));
  const perColumn = Math.ceil(sorted.length / middleColumns) || 1;

  const columns = new Map<number, FlowNodeInput[]>();
  const push = (column: number, node: FlowNodeInput) => {
    const bucket = columns.get(column) ?? [];
    bucket.push(node);
    columns.set(column, bucket);
  };

  for (const node of nodes.filter((n) => n.kind === 'prompt')) push(0, node);
  sorted.forEach((node, index) => push(1 + Math.floor(index / perColumn), node));
  for (const node of nodes.filter((n) => terminal(n.kind))) push(1 + middleColumns, node);

  // A graph with no prompts at all should not open on an empty first column.
  return new Map(
    [...columns.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, members], index) => [index, members] as [number, FlowNodeInput[]]),
  );
}

/**
 * A cubic from the right edge of one node to the left edge of the next.
 *
 * A backward edge (a visitor returning to an earlier step) bows BELOW both
 * nodes instead of cutting straight back through the columns between them,
 * which is the difference between a readable graph and a scribble.
 */
function curveBetween(from: LaidOutNode, to: LaidOutNode): string {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;

  if (to.column <= from.column) {
    const dip = Math.max(from.y + from.height, to.y + to.height) + 44;
    return `M ${x1} ${y1} C ${x1 + 40} ${dip}, ${x2 - 40} ${dip}, ${x2} ${y2}`;
  }
  const control = (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${x1 + control} ${y1}, ${x2 - control} ${y2}, ${x2} ${y2}`;
}
