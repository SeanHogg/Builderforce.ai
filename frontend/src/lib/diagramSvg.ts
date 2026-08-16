/**
 * SVG reader — the shapes inside a vector picture, recovered as a diagram.
 *
 * ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────────────
 * An `.svg` dropped on the board becomes an Image, which is correct: an SVG of
 * a logo is a picture. But an SVG EXPORTED FROM A DIAGRAM TOOL is not a
 * picture — it is boxes, arrows and labels that someone drew, flattened. Almost
 * every tool that will not give you its native file will give you an SVG, so
 * "export as SVG" is the universal escape hatch out of Lucidchart, Figma,
 * Whimsical, Sketch, Visio's web viewer and anything else with a licence you no
 * longer have. Reading the shapes back turns that dead end into an import path.
 *
 * ── READ-ONLY, AND WHY ───────────────────────────────────────────────────────
 * There is already ONE SVG writer: `renderedSvg.ts`, which serializes the
 * diagram the card actually drew. That one is correct for every notation
 * including Mermaid, whose renderer is not ours to reimplement. A second
 * graph-to-SVG writer here would be the same picture derived twice, kept in
 * step by hand — so SVG is a source, never a conversion target.
 */

import {
  DIAGRAM_DEFAULT_FONT_SIZE, MAX_DIAGRAM_CELLS, diagramGraph,
  type DiagramEdge, type DiagramGraph, type DiagramPoint, type DiagramShape, type DiagramVertex,
} from './diagramGraph';

const SAFE_COLOR = /^(?:#[0-9a-f]{3}|#[0-9a-f]{6})$/i;
/** An edge drawn as a path may have curves; only straight runs are read, and
 * only short ones — a 400-segment path is artwork, not a connector. */
const MAX_EDGE_POINTS = 12;

export function isSvgSource(source: string): boolean {
  return /<svg[\s>]/i.test(source.slice(0, 4_000));
}

function numeric(value: string | null | undefined, fallback = 0): number {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeColor(value: string | null): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && SAFE_COLOR.test(trimmed) ? trimmed : undefined;
}

interface Transform { dx: number; dy: number; sx: number; sy: number }

const IDENTITY: Transform = { dx: 0, dy: 0, sx: 1, sy: 1 };

/** Translation and scale only. Rotation and skew change what a BOX means, and a
 * rotated rectangle read as an axis-aligned one is worse than not reading it. */
function composeTransform(parent: Transform, attribute: string | null): Transform {
  if (!attribute) return parent;
  let next = parent;
  const pattern = /(translate|scale|matrix)\s*\(([^)]*)\)/gi;
  let match = pattern.exec(attribute);
  while (match) {
    const numbers = match[2]!.split(/[\s,]+/).map(Number).filter(Number.isFinite);
    if (match[1]!.toLowerCase() === 'translate') {
      next = { ...next, dx: next.dx + (numbers[0] ?? 0) * next.sx, dy: next.dy + (numbers[1] ?? 0) * next.sy };
    } else if (match[1]!.toLowerCase() === 'scale') {
      const sx = numbers[0] ?? 1;
      next = { ...next, sx: next.sx * sx, sy: next.sy * (numbers[1] ?? sx) };
    } else {
      const [a, , , d, e, f] = numbers;
      next = { dx: next.dx + (e ?? 0) * next.sx, dy: next.dy + (f ?? 0) * next.sy, sx: next.sx * (a ?? 1), sy: next.sy * (d ?? 1) };
    }
    match = pattern.exec(attribute);
  }
  return next;
}

const apply = (transform: Transform, x: number, y: number): DiagramPoint => ({ x: x * transform.sx + transform.dx, y: y * transform.sy + transform.dy });

function parsePoints(raw: string | null, transform: Transform): DiagramPoint[] {
  const numbers = (raw ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const points: DiagramPoint[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) points.push(apply(transform, numbers[index]!, numbers[index + 1]!));
  return points;
}

function boxOf(points: readonly DiagramPoint[]): { x: number; y: number; width: number; height: number } {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(Math.max(...xs) - x, 1), height: Math.max(Math.max(...ys) - y, 1) };
}

/** A polygon's shape, read from how many corners it has and where they sit. A
 * four-point polygon whose corners are all at box mid-edges is a decision
 * diamond; one whose corners are at the box corners is a rectangle. */
function polygonShape(points: readonly DiagramPoint[]): DiagramShape {
  if (points.length === 3) return 'triangle';
  if (points.length === 6) return 'hexagon';
  if (points.length === 4) {
    const box = boxOf(points);
    const midX = box.x + box.width / 2;
    const midY = box.y + box.height / 2;
    const tolerance = Math.max(2, Math.min(box.width, box.height) * 0.08);
    const atMidEdge = points.filter((point) => Math.abs(point.x - midX) < tolerance || Math.abs(point.y - midY) < tolerance).length;
    return atMidEdge >= 4 ? 'rhombus' : 'rect';
  }
  return 'rect';
}

/** Straight-run path points. `M`/`L` only, absolute or relative; a path with
 * curves or a close command is artwork and is skipped. */
function straightPathPoints(d: string, transform: Transform): DiagramPoint[] | null {
  if (/[csqtaz]/i.test(d.replace(/[Mm Ll Hh Vv]/g, ''))) return null;
  const points: DiagramPoint[] = [];
  let x = 0;
  let y = 0;
  const pattern = /([MmLlHhVv])\s*((?:-?[\d.]+[\s,]*)*)/g;
  let match = pattern.exec(d);
  while (match) {
    const command = match[1]!;
    const numbers = match[2]!.trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
    const relative = command === command.toLowerCase();
    if (command.toLowerCase() === 'h') {
      for (const value of numbers) { x = relative ? x + value : value; points.push(apply(transform, x, y)); }
    } else if (command.toLowerCase() === 'v') {
      for (const value of numbers) { y = relative ? y + value : value; points.push(apply(transform, x, y)); }
    } else {
      for (let index = 0; index + 1 < numbers.length; index += 2) {
        x = relative ? x + numbers[index]! : numbers[index]!;
        y = relative ? y + numbers[index + 1]! : numbers[index + 1]!;
        points.push(apply(transform, x, y));
      }
    }
    match = pattern.exec(d);
  }
  return points.length >= 2 && points.length <= MAX_EDGE_POINTS ? points : null;
}

interface Collected {
  vertices: DiagramVertex[];
  edges: DiagramEdge[];
  labels: Array<{ point: DiagramPoint; text: string; fontSize: number; color?: string }>;
}

function collect(root: Element): Collected {
  const out: Collected = { vertices: [], edges: [], labels: [] };
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`;

  const walk = (element: Element, inherited: Transform): void => {
    if (out.vertices.length + out.edges.length >= MAX_DIAGRAM_CELLS) return;
    const transform = composeTransform(inherited, element.getAttribute('transform'));
    const tag = (element.localName || element.tagName).toLowerCase();
    const fill = safeColor(element.getAttribute('fill'));
    const stroke = safeColor(element.getAttribute('stroke'));
    const dashed = Boolean(element.getAttribute('stroke-dasharray'));
    const vertex = (box: { x: number; y: number; width: number; height: number }, shape: DiagramShape): void => {
      out.vertices.push({
        id: element.getAttribute('id') || nextId('shape'),
        label: '',
        ...box,
        shape,
        // The author's own fill, carried across as they set it. Second-guessing
        // it — dropping white, say — would silently redraw their diagram.
        ...(fill ? { fill } : {}),
        ...(stroke ? { stroke } : {}),
        fontSize: DIAGRAM_DEFAULT_FONT_SIZE,
        dashed,
      });
    };

    if (tag === 'rect') {
      const origin = apply(transform, numeric(element.getAttribute('x')), numeric(element.getAttribute('y')));
      const width = numeric(element.getAttribute('width')) * transform.sx;
      const height = numeric(element.getAttribute('height')) * transform.sy;
      if (width > 2 && height > 2) vertex({ ...origin, width, height }, numeric(element.getAttribute('rx')) > 1 ? 'rounded' : 'rect');
    } else if (tag === 'circle' || tag === 'ellipse') {
      const rx = numeric(element.getAttribute(tag === 'circle' ? 'r' : 'rx')) * transform.sx;
      const ry = numeric(element.getAttribute(tag === 'circle' ? 'r' : 'ry')) * transform.sy;
      const center = apply(transform, numeric(element.getAttribute('cx')), numeric(element.getAttribute('cy')));
      if (rx > 1 && ry > 1) vertex({ x: center.x - rx, y: center.y - ry, width: rx * 2, height: ry * 2 }, 'ellipse');
    } else if (tag === 'polygon') {
      const points = parsePoints(element.getAttribute('points'), transform);
      if (points.length >= 3) vertex(boxOf(points), polygonShape(points));
    } else if (tag === 'line') {
      const from = apply(transform, numeric(element.getAttribute('x1')), numeric(element.getAttribute('y1')));
      const to = apply(transform, numeric(element.getAttribute('x2')), numeric(element.getAttribute('y2')));
      out.edges.push({ id: element.getAttribute('id') || nextId('edge'), label: '', points: [from, to], ...(stroke ? { stroke } : {}), dashed, arrow: true });
    } else if (tag === 'polyline') {
      const points = parsePoints(element.getAttribute('points'), transform);
      if (points.length >= 2 && points.length <= MAX_EDGE_POINTS) {
        out.edges.push({ id: element.getAttribute('id') || nextId('edge'), label: '', points, ...(stroke ? { stroke } : {}), dashed, arrow: true });
      }
    } else if (tag === 'path') {
      const d = element.getAttribute('d') ?? '';
      const points = straightPathPoints(d, transform);
      // A filled path is a shape someone drew (an arrow head, a badge); only an
      // unfilled run of straight segments reads as a connector.
      if (points && (!fill || fill === 'none') && element.getAttribute('fill') !== 'currentColor') {
        out.edges.push({ id: element.getAttribute('id') || nextId('edge'), label: '', points, ...(stroke ? { stroke } : {}), dashed, arrow: true });
      }
    } else if (tag === 'text') {
      const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) {
        out.labels.push({
          point: apply(transform, numeric(element.getAttribute('x')), numeric(element.getAttribute('y'))),
          text,
          fontSize: Math.min(Math.max(numeric(element.getAttribute('font-size'), DIAGRAM_DEFAULT_FONT_SIZE), 6), 48),
          ...(safeColor(element.getAttribute('fill')) ? { color: safeColor(element.getAttribute('fill'))! } : {}),
        });
      }
      return;
    }
    for (const child of Array.from(element.children)) walk(child, transform);
  };

  for (const child of Array.from(root.children)) walk(child, IDENTITY);
  return out;
}

/**
 * Read the shapes out of an SVG.
 *
 * Returns `null` when the picture holds no shape a diagram is made of, so a
 * logo or an icon stays the image it is rather than becoming a diagram with one
 * mysterious rectangle in it.
 */
export function readSvgShapes(source: string): DiagramGraph | null {
  if (typeof DOMParser === 'undefined' || !isSvgSource(source)) return null;
  let document: Document;
  try {
    document = new DOMParser().parseFromString(source, 'image/svg+xml');
  } catch {
    return null;
  }
  const root = document.documentElement;
  if (!root || document.getElementsByTagName('parsererror').length) return null;

  const { vertices, edges, labels } = collect(root);
  if (!vertices.length) return null;

  // A label inside a shape IS that shape's name. Assigned smallest-box-first so
  // a word inside a box that sits inside a container lands on the box.
  const ordered = [...vertices].sort((left, right) => left.width * left.height - right.width * right.height);
  const spare: typeof labels = [];
  for (const label of labels) {
    const owner = ordered.find((vertex) =>
      label.point.x >= vertex.x && label.point.x <= vertex.x + vertex.width
      && label.point.y >= vertex.y - label.fontSize && label.point.y <= vertex.y + vertex.height + label.fontSize);
    if (!owner) { spare.push(label); continue; }
    owner.label = owner.label ? `${owner.label}\n${label.text}` : label.text;
  }

  // Text that belongs to no shape is still content — a title, a legend, a note
  // — so it becomes a borderless text vertex rather than being discarded.
  const loose: DiagramVertex[] = spare.slice(0, 40).map((label, index) => ({
    id: `text-${index + 1}`,
    label: label.text,
    x: label.point.x,
    y: label.point.y - label.fontSize,
    width: Math.max(label.text.length * label.fontSize * 0.56, 24),
    height: label.fontSize * 1.6,
    shape: 'text' as const,
    ...(label.color ? { fontColor: label.color } : {}),
    fontSize: label.fontSize,
    dashed: false,
  }));

  return diagramGraph([...vertices, ...loose], edges);
}
