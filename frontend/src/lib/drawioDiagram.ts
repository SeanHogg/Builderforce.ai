/**
 * Draw.io (mxGraph) reader for the Creation Canvas.
 *
 * A `.drawio` file is an XML scene graph, not a picture — pointing an `<img>` at
 * one only ever renders a broken tile. This reads the scene into plain geometry
 * the canvas draws itself, so a diagram an agent produced is VISIBLE on the board
 * with no external editor, no CDN script, and no network round-trip.
 *
 * Only the parts a generated diagram actually uses are modelled: vertices with a
 * shape, a fill, a stroke and a label; edges with waypoints and an arrow head.
 * Anything unrecognised degrades to a labelled rectangle rather than vanishing.
 */

export type DrawioShape = 'rect' | 'rounded' | 'ellipse' | 'rhombus' | 'triangle' | 'hexagon' | 'cylinder' | 'note' | 'text';

export interface DrawioPoint { x: number; y: number }

export interface DrawioVertex {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: DrawioShape;
  fill?: string;
  stroke?: string;
  fontColor?: string;
  fontSize: number;
  dashed: boolean;
}

export interface DrawioEdge {
  id: string;
  label: string;
  points: DrawioPoint[];
  stroke?: string;
  dashed: boolean;
  arrow: boolean;
}

export interface DrawioGraph {
  vertices: DrawioVertex[];
  edges: DrawioEdge[];
  /** Content bounds, already padded, ready to become a `viewBox`. */
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_CELLS = 600;
const DEFAULT_FONT_SIZE = 12;
const CONTENT_PADDING = 16;
const SAFE_COLOR = /^(?:#[0-9a-f]{3}|#[0-9a-f]{6}|none)$/i;

function numeric(value: string | null | undefined, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeColor(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && SAFE_COLOR.test(trimmed) ? trimmed : undefined;
}

/** `rounded=1;fillColor=#dae8fc;ellipse` → a flat lookup, keyless tokens included. */
export function parseDrawioStyle(style: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const token of style.split(';')) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) entries[trimmed.toLowerCase()] = '1';
    else entries[trimmed.slice(0, separator).trim().toLowerCase()] = trimmed.slice(separator + 1).trim();
  }
  return entries;
}

function shapeFromStyle(style: Record<string, string>): DrawioShape {
  const named = (style.shape ?? '').toLowerCase();
  if (style.ellipse === '1' || named === 'ellipse') return 'ellipse';
  if (style.rhombus === '1' || named === 'rhombus') return 'rhombus';
  if (style.triangle === '1' || named === 'triangle') return 'triangle';
  if (named === 'hexagon') return 'hexagon';
  if (named.startsWith('cylinder')) return 'cylinder';
  if (named === 'note') return 'note';
  if (style.text === '1' || named === 'text') return 'text';
  return style.rounded === '1' ? 'rounded' : 'rect';
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Draw.io labels carry inline HTML. Read them back as the text a person sees. */
export function drawioLabelText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#?\w+);/g, (match, entity: string) => ENTITIES[entity.toLowerCase()] ?? (entity.startsWith('#') ? String.fromCharCode(Number(entity.slice(1))) : match))
    .split('\n').map((line) => line.trim()).filter(Boolean).join('\n')
    .slice(0, 400);
}

/** Where a straight run from `from` toward `to` leaves the box around `from`. */
function clipToBox(from: DrawioPoint, to: DrawioPoint, box: { x: number; y: number; width: number; height: number }): DrawioPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (!dx && !dy) return from;
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const scale = Math.min(dx ? halfWidth / Math.abs(dx) : Number.POSITIVE_INFINITY, dy ? halfHeight / Math.abs(dy) : Number.POSITIVE_INFINITY);
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

type RawCell = { element: Element; label: string };

function collectCells(model: Element): RawCell[] {
  const cells: RawCell[] = [];
  for (const element of Array.from(model.getElementsByTagName('*'))) {
    if (element.tagName !== 'mxCell') continue;
    const wrapper = element.parentElement;
    const wrapped = wrapper && (wrapper.tagName === 'object' || wrapper.tagName === 'UserObject');
    const label = wrapped ? (wrapper.getAttribute('label') ?? '') : (element.getAttribute('value') ?? '');
    cells.push({ element, label: drawioLabelText(label) });
    if (cells.length >= MAX_CELLS) break;
  }
  return cells;
}

function cellId(cell: RawCell): string {
  const wrapper = cell.element.parentElement;
  const wrapped = wrapper && (wrapper.tagName === 'object' || wrapper.tagName === 'UserObject');
  return (wrapped ? wrapper.getAttribute('id') : null) ?? cell.element.getAttribute('id') ?? '';
}

function geometryOf(element: Element): Element | null {
  return Array.from(element.children).find((child) => child.tagName === 'mxGeometry') ?? null;
}

/**
 * Read a draw.io scene into geometry. Returns `null` when the payload is not a
 * parseable mxGraph model, so callers can fall back to showing the source.
 */
export function parseDrawioXml(xml: string): DrawioGraph | null {
  if (typeof DOMParser === 'undefined') return null;
  let document: Document;
  try {
    document = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return null;
  }
  if (document.getElementsByTagName('parsererror').length) return null;
  const model = document.getElementsByTagName('mxGraphModel')[0] ?? document.getElementsByTagName('root')[0];
  if (!model) return null;

  const cells = collectCells(model);
  const parentById = new Map<string, string>();
  const vertexById = new Map<string, DrawioVertex>();
  const edgeCells: RawCell[] = [];
  const edgeLabels = new Map<string, string>();

  for (const cell of cells) {
    const id = cellId(cell);
    if (!id) continue;
    parentById.set(id, cell.element.getAttribute('parent') ?? '');
    if (cell.element.getAttribute('edge') === '1') edgeCells.push(cell);
  }

  for (const cell of cells) {
    if (cell.element.getAttribute('vertex') !== '1') continue;
    const id = cellId(cell);
    const parent = parentById.get(id) ?? '';
    const geometry = geometryOf(cell.element);
    if (!geometry) continue;
    // A vertex parented to an edge is that edge's floating label, not a shape.
    if (edgeCells.some((edge) => cellId(edge) === parent)) {
      if (cell.label) edgeLabels.set(parent, cell.label);
      continue;
    }
    const style = parseDrawioStyle(cell.element.getAttribute('style') ?? '');
    const container = vertexById.get(parent);
    const width = numeric(geometry.getAttribute('width'), 120);
    const height = numeric(geometry.getAttribute('height'), 60);
    vertexById.set(id, {
      id,
      label: cell.label,
      x: numeric(geometry.getAttribute('x')) + (container?.x ?? 0),
      y: numeric(geometry.getAttribute('y')) + (container?.y ?? 0),
      width: Math.max(width, 1),
      height: Math.max(height, 1),
      shape: shapeFromStyle(style),
      ...(safeColor(style.fillcolor) ? { fill: safeColor(style.fillcolor) } : {}),
      ...(safeColor(style.strokecolor) ? { stroke: safeColor(style.strokecolor) } : {}),
      ...(safeColor(style.fontcolor) ? { fontColor: safeColor(style.fontcolor) } : {}),
      fontSize: Math.min(Math.max(numeric(style.fontsize, DEFAULT_FONT_SIZE), 6), 48),
      dashed: style.dashed === '1',
    });
  }

  const edges: DrawioEdge[] = [];
  for (const cell of edgeCells) {
    const id = cellId(cell);
    const style = parseDrawioStyle(cell.element.getAttribute('style') ?? '');
    const geometry = geometryOf(cell.element);
    const waypoints = geometry
      ? Array.from(geometry.children).filter((child) => child.tagName === 'Array' && child.getAttribute('as') === 'points')
        .flatMap((array) => Array.from(array.children).filter((point) => point.tagName === 'mxPoint'))
        .map((point) => ({ x: numeric(point.getAttribute('x')), y: numeric(point.getAttribute('y')) }))
      : [];
    const fixedPoint = (as: string): DrawioPoint | null => {
      const point = geometry ? Array.from(geometry.children).find((child) => child.tagName === 'mxPoint' && child.getAttribute('as') === as) : null;
      return point ? { x: numeric(point.getAttribute('x')), y: numeric(point.getAttribute('y')) } : null;
    };
    const source = vertexById.get(cell.element.getAttribute('source') ?? '');
    const target = vertexById.get(cell.element.getAttribute('target') ?? '');
    const sourceCenter = source ? { x: source.x + source.width / 2, y: source.y + source.height / 2 } : fixedPoint('sourcePoint');
    const targetCenter = target ? { x: target.x + target.width / 2, y: target.y + target.height / 2 } : fixedPoint('targetPoint');
    if (!sourceCenter || !targetCenter) continue;
    const start = source ? clipToBox(sourceCenter, waypoints[0] ?? targetCenter, source) : sourceCenter;
    const end = target ? clipToBox(targetCenter, waypoints[waypoints.length - 1] ?? sourceCenter, target) : targetCenter;
    edges.push({
      id,
      label: cell.label || edgeLabels.get(id) || '',
      points: [start, ...waypoints, end],
      ...(safeColor(style.strokecolor) ? { stroke: safeColor(style.strokecolor) } : {}),
      dashed: style.dashed === '1',
      arrow: style.endarrow !== 'none',
    });
  }

  const vertices = [...vertexById.values()];
  if (!vertices.length && !edges.length) return null;
  const xs = [...vertices.flatMap((vertex) => [vertex.x, vertex.x + vertex.width]), ...edges.flatMap((edge) => edge.points.map((point) => point.x))];
  const ys = [...vertices.flatMap((vertex) => [vertex.y, vertex.y + vertex.height]), ...edges.flatMap((edge) => edge.points.map((point) => point.y))];
  const minX = Math.min(...xs) - CONTENT_PADDING;
  const minY = Math.min(...ys) - CONTENT_PADDING;
  return {
    vertices,
    edges,
    x: minX,
    y: minY,
    width: Math.max(Math.max(...xs) + CONTENT_PADDING - minX, 1),
    height: Math.max(Math.max(...ys) + CONTENT_PADDING - minY, 1),
  };
}

/** The polygon points for a shape drawn inside its box. Rect-like shapes return
 * `null` and are drawn as a `<rect>` instead. */
export function drawioShapePolygon(vertex: DrawioVertex): string | null {
  const { x, y, width, height, shape } = vertex;
  if (shape === 'rhombus') return `${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`;
  if (shape === 'triangle') return `${x},${y} ${x + width},${y + height / 2} ${x},${y + height}`;
  if (shape === 'hexagon') return `${x + width * 0.25},${y} ${x + width * 0.75},${y} ${x + width},${y + height / 2} ${x + width * 0.75},${y + height} ${x + width * 0.25},${y + height} ${x},${y + height / 2}`;
  if (shape === 'note') return `${x},${y} ${x + width - 14},${y} ${x + width},${y + 14} ${x + width},${y + height} ${x},${y + height}`;
  return null;
}

/** Greedy wrap for a shape label, so long text stays inside its box. */
export function drawioLabelLines(label: string, width: number, fontSize: number, maxLines = 4): string[] {
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

const DIAGRAM_TAG = /<diagram\b[^>]*>([\s\S]*?)<\/diagram>/i;

function base64Bytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value.replace(/\s+/g, ''));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Draw.io writes either plain XML or a deflate-compressed, URI-encoded payload
 * inside `<diagram>`. Both arrive here; the caller only ever sees mxGraph XML.
 */
export async function resolveDrawioXml(source: string): Promise<string | null> {
  const value = source.trim();
  if (!value) return null;
  if (/<mxGraphModel\b/i.test(value)) return value;
  const payload = DIAGRAM_TAG.exec(value)?.[1]?.trim();
  if (!payload) return null;
  if (/<mxGraphModel\b/i.test(payload)) return payload;
  const bytes = base64Bytes(payload);
  if (!bytes || typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const inflated = await new Response(stream).text();
    return decodeURIComponent(inflated);
  } catch {
    return null;
  }
}
