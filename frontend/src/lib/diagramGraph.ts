/**
 * The ONE geometry a diagram becomes, whatever notation it was authored in.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The canvas used to know exactly one diagram notation end-to-end: draw.io was
 * parsed into `DrawioGraph`, drawn from that geometry, and converted to from an
 * image. Every other notation a person actually has — a Mermaid file from a
 * repo, a Visio drawing from a colleague, a BPMN process from the workflow
 * tool, an Excalidraw sketch — landed as an attachment icon, and "convert" had
 * a single hard-wired destination.
 *
 * Adding notations pairwise is N×M readers-and-writers: nine notations would be
 * seventy-two conversions to write and keep honest. So every notation reads
 * into THIS shape and writes back out of it, which makes it N + M — a reader
 * and (where the notation can express one) a writer, each in its own module,
 * and any source converts to any target through the graph in the middle.
 *
 * It is deliberately the geometry the canvas already drew: vertices with a
 * shape, a fill, a stroke and a label; edges with waypoints and an arrow head.
 * `source`/`target` were ADDED to the edge, because a picture only needs the
 * points an edge passes through, but a TEXT notation (`A --> B`) cannot be
 * written at all without knowing which two shapes an edge joins.
 */

export type DiagramShape = 'rect' | 'rounded' | 'ellipse' | 'rhombus' | 'triangle' | 'hexagon' | 'cylinder' | 'note' | 'text';

export interface DiagramPoint { x: number; y: number }

export interface DiagramVertex {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: DiagramShape;
  fill?: string;
  stroke?: string;
  fontColor?: string;
  fontSize: number;
  dashed: boolean;
  /** Embedded artwork carried by an image cell. Only data:image URLs are
   * rendered; remote URLs never become an implicit network request. */
  imageUrl?: string;
}

export interface DiagramEdge {
  id: string;
  label: string;
  points: DiagramPoint[];
  stroke?: string;
  dashed: boolean;
  arrow: boolean;
  /** The vertices this edge joins, when the source notation said so. Geometry
   * notations may only give waypoints; a text notation cannot be written from
   * waypoints, so a reader that knows its endpoints MUST record them. */
  source?: string;
  target?: string;
}

export interface DiagramGraph {
  vertices: DiagramVertex[];
  edges: DiagramEdge[];
  /** Content bounds, already padded, ready to become a `viewBox`. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DIAGRAM_CONTENT_PADDING = 16;
export const DIAGRAM_DEFAULT_FONT_SIZE = 12;

/** Ceiling on the shapes any one reader will take from a file. Past this a
 * board stops being legible and the parse stops being worth its cost — the same
 * bound the draw.io reader has always applied, now applied to every notation so
 * a 12MB Visio drawing cannot behave differently from a 12MB `.drawio`. */
export const MAX_DIAGRAM_CELLS = 600;

/** Compose vertices and edges into a graph, deriving the bounds every renderer
 * and writer needs. Returns `null` for an empty scene so a caller can fall back
 * to showing the source rather than drawing an empty box. */
export function diagramGraph(vertices: DiagramVertex[], edges: DiagramEdge[]): DiagramGraph | null {
  if (!vertices.length && !edges.length) return null;
  const xs = [...vertices.flatMap((vertex) => [vertex.x, vertex.x + vertex.width]), ...edges.flatMap((edge) => edge.points.map((point) => point.x))];
  const ys = [...vertices.flatMap((vertex) => [vertex.y, vertex.y + vertex.height]), ...edges.flatMap((edge) => edge.points.map((point) => point.y))];
  if (!xs.length || !ys.length) return null;
  const minX = Math.min(...xs) - DIAGRAM_CONTENT_PADDING;
  const minY = Math.min(...ys) - DIAGRAM_CONTENT_PADDING;
  return {
    vertices,
    edges,
    x: minX,
    y: minY,
    width: Math.max(Math.max(...xs) + DIAGRAM_CONTENT_PADDING - minX, 1),
    height: Math.max(Math.max(...ys) + DIAGRAM_CONTENT_PADDING - minY, 1),
  };
}

/** What a card can honestly say a diagram holds, in one place so the import
 * notice, the object subtitle and the conversion result all count the same. */
export function diagramGraphStats(graph: DiagramGraph): { shapes: number; connections: number } {
  return { shapes: graph.vertices.length, connections: graph.edges.length };
}

/** The polygon points for a shape drawn inside its box. Rect-like shapes return
 * `null` and are drawn as a `<rect>` instead. */
export function diagramShapePolygon(vertex: DiagramVertex): string | null {
  const { x, y, width, height, shape } = vertex;
  if (shape === 'rhombus') return `${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`;
  if (shape === 'triangle') return `${x},${y} ${x + width},${y + height / 2} ${x},${y + height}`;
  if (shape === 'hexagon') return `${x + width * 0.25},${y} ${x + width * 0.75},${y} ${x + width},${y + height / 2} ${x + width * 0.75},${y + height} ${x + width * 0.25},${y + height} ${x},${y + height / 2}`;
  if (shape === 'note') return `${x},${y} ${x + width - 14},${y} ${x + width},${y + 14} ${x + width},${y + height} ${x},${y + height}`;
  return null;
}

/** Greedy wrap for a shape label, so long text stays inside its box. */
export function diagramLabelLines(label: string, width: number, fontSize: number, maxLines = 4): string[] {
  const perLine = Math.max(4, Math.floor((width - 8) / (fontSize * 0.56)));
  const lines: string[] = [];
  for (const paragraph of label.split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= perLine) { current = candidate; continue; }
      if (current) lines.push(current);
      current = word.length > perLine ? `${word.slice(0, perLine - 1)}…` : word;
    }
    if (current) lines.push(current);
    if (lines.length >= maxLines) break;
  }
  return lines.slice(0, maxLines);
}

/** Where a straight run from `from` toward `to` leaves the box around `from`. */
export function clipToBox(from: DiagramPoint, to: DiagramPoint, box: { x: number; y: number; width: number; height: number }): DiagramPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (!dx && !dy) return from;
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const scale = Math.min(dx ? halfWidth / Math.abs(dx) : Number.POSITIVE_INFINITY, dy ? halfHeight / Math.abs(dy) : Number.POSITIVE_INFINITY);
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

/* ------------------------------------------------------------- layout --- */

const LAYOUT_MIN_WIDTH = 130;
const LAYOUT_MAX_WIDTH = 260;
const LAYOUT_LINE_HEIGHT = 18;
const LAYOUT_BASE_HEIGHT = 44;
const LAYOUT_H_GAP = 44;
const LAYOUT_V_GAP = 70;
const LAYOUT_CHAR_WIDTH = 7.2;
/** A cycle has no longest path, so ranking must stop somewhere. Past this depth
 * the remaining nodes are placed on the last rank rather than looping forever. */
const LAYOUT_MAX_RANK = 60;

/** The box a label needs. Shared so a node laid out from Mermaid and the same
 * node laid out from DOT come out the same size. */
export function layoutNodeSize(label: string): { width: number; height: number } {
  const lines = label.split('\n');
  const longest = Math.max(1, ...lines.map((line) => line.length));
  const width = Math.round(Math.max(LAYOUT_MIN_WIDTH, Math.min(longest * LAYOUT_CHAR_WIDTH + 28, LAYOUT_MAX_WIDTH)));
  const wrapped = Math.max(lines.length, Math.ceil((longest * LAYOUT_CHAR_WIDTH) / (width - 28)));
  return { width, height: Math.round(LAYOUT_BASE_HEIGHT + Math.max(0, wrapped - 1) * LAYOUT_LINE_HEIGHT) };
}

export interface LayoutNode {
  id: string;
  label: string;
  shape: DiagramShape;
  fill?: string;
  stroke?: string;
}

export interface LayoutLink {
  source: string;
  target: string;
  label?: string;
  dashed?: boolean;
  arrow?: boolean;
}

/**
 * Give a graph that has no geometry one.
 *
 * A text notation states relationships and says nothing about position, so
 * every text reader would otherwise need its own placement code — three
 * near-identical layout passes drifting apart. Nodes are ranked by their
 * longest path from a root and laid out in rows, which is the reading order
 * `flowchart TD`, `digraph` and PlantUML all already imply.
 */
export function layoutDiagramGraph(nodes: readonly LayoutNode[], links: readonly LayoutLink[]): DiagramGraph | null {
  if (!nodes.length) return null;
  const capped = nodes.slice(0, MAX_DIAGRAM_CELLS);
  const known = new Set(capped.map((node) => node.id));
  const usable = links.filter((link) => known.has(link.source) && known.has(link.target)).slice(0, MAX_DIAGRAM_CELLS);

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const link of usable) {
    outgoing.set(link.source, [...(outgoing.get(link.source) ?? []), link.target]);
    incoming.set(link.target, [...(incoming.get(link.target) ?? []), link.source]);
  }

  // Longest path from a root. Nodes inside a cycle are never reached from a
  // root, so they are seeded at the depth already assigned to whatever pointed
  // at them — which keeps a loop readable instead of collapsing it onto rank 0.
  const rank = new Map<string, number>();
  const roots = capped.filter((node) => !(incoming.get(node.id)?.length));
  const queue: Array<{ id: string; depth: number }> = (roots.length ? roots : [capped[0]!]).map((node) => ({ id: node.id, depth: 0 }));
  while (queue.length) {
    const { id, depth } = queue.shift()!;
    if (depth > LAYOUT_MAX_RANK) continue;
    if ((rank.get(id) ?? -1) >= depth) continue;
    rank.set(id, depth);
    for (const next of outgoing.get(id) ?? []) queue.push({ id: next, depth: depth + 1 });
  }
  for (const node of capped) if (!rank.has(node.id)) rank.set(node.id, 0);

  const byRank = new Map<number, LayoutNode[]>();
  for (const node of capped) {
    const depth = rank.get(node.id) ?? 0;
    byRank.set(depth, [...(byRank.get(depth) ?? []), node]);
  }

  const sized = new Map(capped.map((node) => [node.id, layoutNodeSize(node.label)] as const));
  const ranks = [...byRank.keys()].sort((left, right) => left - right);
  const rowWidth = (row: LayoutNode[]) => row.reduce((total, node) => total + sized.get(node.id)!.width, 0) + Math.max(0, row.length - 1) * LAYOUT_H_GAP;
  const widest = Math.max(...ranks.map((depth) => rowWidth(byRank.get(depth)!)));

  const placed = new Map<string, DiagramVertex>();
  let y = 40;
  for (const depth of ranks) {
    const row = byRank.get(depth)!;
    const tallest = Math.max(...row.map((node) => sized.get(node.id)!.height));
    let x = 40 + (widest - rowWidth(row)) / 2;
    for (const node of row) {
      const size = sized.get(node.id)!;
      placed.set(node.id, {
        id: node.id,
        label: node.label,
        x: Math.round(x),
        y: Math.round(y + (tallest - size.height) / 2),
        width: size.width,
        height: size.height,
        shape: node.shape,
        ...(node.fill ? { fill: node.fill } : {}),
        ...(node.stroke ? { stroke: node.stroke } : {}),
        fontSize: DIAGRAM_DEFAULT_FONT_SIZE,
        dashed: false,
      });
      x += size.width + LAYOUT_H_GAP;
    }
    y += tallest + LAYOUT_V_GAP;
  }

  const edges: DiagramEdge[] = usable.map((link, index) => {
    const from = placed.get(link.source)!;
    const to = placed.get(link.target)!;
    const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    return {
      id: `edge-${index + 1}`,
      label: link.label ?? '',
      points: [clipToBox(fromCenter, toCenter, from), clipToBox(toCenter, fromCenter, to)],
      dashed: link.dashed ?? false,
      arrow: link.arrow ?? true,
      source: link.source,
      target: link.target,
    };
  });

  return diagramGraph([...placed.values()], edges);
}

/**
 * The endpoints a text writer needs, derived from geometry when the reader
 * could not supply them.
 *
 * A Visio connector or a bare `.drawio` edge often carries only waypoints. An
 * edge whose ends land inside two shapes IS a relationship between them, and
 * recovering that here is what lets a Visio drawing become Mermaid at all —
 * rather than silently dropping every connector on the way out.
 */
export function resolveEdgeEndpoints(graph: DiagramGraph): DiagramEdge[] {
  const contains = (vertex: DiagramVertex, point: DiagramPoint, slack: number): boolean =>
    point.x >= vertex.x - slack && point.x <= vertex.x + vertex.width + slack
    && point.y >= vertex.y - slack && point.y <= vertex.y + vertex.height + slack;
  const nearest = (point: DiagramPoint): string | undefined => {
    for (const slack of [2, 12, 28]) {
      const hit = graph.vertices.find((vertex) => contains(vertex, point, slack));
      if (hit) return hit.id;
    }
    return undefined;
  };
  return graph.edges.map((edge) => {
    if (edge.source && edge.target) return edge;
    const first = edge.points[0];
    const last = edge.points[edge.points.length - 1];
    const source = edge.source ?? (first ? nearest(first) : undefined);
    const target = edge.target ?? (last ? nearest(last) : undefined);
    return { ...edge, ...(source ? { source } : {}), ...(target ? { target } : {}) };
  });
}
