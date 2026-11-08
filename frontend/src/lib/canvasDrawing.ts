import type { CanvasObjectData as CreationNodeData } from '@/domains/canvas/domain/canvasObject';

/**
 * Drawing on the canvas: many strokes, more than one tool, and a mark that can
 * sit ON something.
 *
 * ── WHAT THIS REPLACES ───────────────────────────────────────────────────────
 * One pointer-drag produced one node holding one single-colour polyline, in a
 * colour and width that could only be changed AFTER the fact from the inspector.
 * There was no eraser, no way to add a second stroke to a sketch, no shapes, no
 * text, and — because a drawing was a free-floating node — no way to mark up the
 * document, image, diagram or web page sitting next to it. Which is the one
 * thing a pen is for.
 *
 * A drawing is now a LIST of strokes, each carrying the tool that made it, and
 * it may carry `annotatesId`: the object it rides on top of and moves with.
 * `points` (the old flat polyline) is still read, as one pen stroke, so every
 * drawing made before this still opens.
 */

export const DRAWING_TOOLS = ['pen', 'highlighter', 'line', 'rect', 'ellipse', 'text', 'eraser'] as const;
export type CanvasDrawingTool = (typeof DRAWING_TOOLS)[number];

/** Everything except the eraser leaves a mark; the eraser removes them. */
export type CanvasStrokeTool = Exclude<CanvasDrawingTool, 'eraser'>;

export interface CanvasStroke {
  /** Stable identity, so a collaborative store can add/remove ONE stroke without rewriting the list. */
  id?: string;
  tool: CanvasStrokeTool;
  /** Freehand: the path. Shapes: [start, end]. Text: [anchor]. */
  points: Array<{ x: number; y: number }>;
  stroke: string;
  strokeWidth: number;
  /** Text tool only. */
  text?: string;
}

export const DEFAULT_STROKE_COLOR = 'var(--indigo-bright)';
export const DEFAULT_STROKE_WIDTH = 3;
/** A highlighter is a wide, translucent pen — one tool, two numbers. */
export const HIGHLIGHTER_OPACITY = 0.35;
export const HIGHLIGHTER_WIDTH_FACTOR = 5;

/** The most strokes one drawing may hold; appends past it are refused (see `admitStrokes`). */
export const MAX_STROKES = 400;
/** The most points one stroke may hold. Capture stops growing a path at this (see `extendStrokePath`). */
export const MAX_POINTS = 2_000;
/**
 * The most points one drawing may hold IN TOTAL, across all its strokes.
 *
 * The cap that actually bounds storage: a drawing block lives in a Yjs room whose state is
 * persisted to a Durable Object (single values ~2 MB, the room chunks them and refuses a
 * merged state past a hard cap). 40 000 points at ~25 bytes each encoded is about 1 MB, so
 * one drawing cannot by itself approach the room's cap. Appends and patches that would
 * cross it are refused (see `admitStrokes`, `patchedStroke`); the UI then shows
 * `blocks.drawing.limit`.
 */
export const MAX_TOTAL_POINTS = 40_000;
/** Reading tolerates more than may be appended, so a legacy board is never silently truncated at the cap. */
const MAX_READ_STROKES = MAX_STROKES * 4;

/** Points across a stroke list: what `MAX_TOTAL_POINTS` budgets. */
export function totalPoints(strokes: readonly CanvasStroke[]): number {
  return strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
}

/** Can another stroke be added? False at either cap. */
export function drawingHasRoom(strokes: readonly CanvasStroke[]): boolean {
  return strokes.length < MAX_STROKES && totalPoints(strokes) < MAX_TOTAL_POINTS;
}

function point(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function points(value: unknown): Array<{ x: number; y: number }> {
  if (!Array.isArray(value)) return [];
  const parsed = value.flatMap((item) => { const next = point(item); return next ? [next] : []; });
  if (parsed.length <= MAX_POINTS) return parsed;
  // Over the cap: sample evenly, always keeping the first AND last point, so a long
  // stroke is thinned rather than having its tail silently cut off.
  return Array.from({ length: MAX_POINTS }, (_, index) => parsed[Math.round((index * (parsed.length - 1)) / (MAX_POINTS - 1))]!);
}

const SAFE_STROKE_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9a-z%.,\s/+-]+\)|var\(--[a-z0-9_-]+\)|currentColor)$/i;
/** A colour that is safe to put in an SVG attribute: hex, rgb(a), hsl(a), a CSS variable or currentColor. */
export function isSafeStrokeColor(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && SAFE_STROKE_COLOR.test(value);
}

/** A drawing surface dimension, clamped to something renderable. */
export function clampDrawingDimension(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(100, Math.min(value, 4000)) : fallback;
}

function strokeTool(value: unknown): CanvasStrokeTool {
  return DRAWING_TOOLS.includes(value as CanvasDrawingTool) && value !== 'eraser' ? value as CanvasStrokeTool : 'pen';
}

/**
 * The strokes on this object, whichever way it stored them.
 *
 * The legacy shape (a flat `points` array with `stroke` / `strokeWidth` beside
 * it) becomes exactly what it always was: one pen stroke.
 */
export function canvasStrokes(data: Readonly<Record<string, unknown>>): CanvasStroke[] {
  if (Array.isArray(data.strokes)) {
    // Over the ceiling, keep the NEWEST: the strokes just drawn are the ones that must not vanish.
    return data.strokes.slice(-MAX_READ_STROKES).flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const raw = entry as Record<string, unknown>;
      const tool = strokeTool(raw.tool);
      const path = points(raw.points);
      const text = typeof raw.text === 'string' ? raw.text.slice(0, 500) : '';
      if (tool === 'text' ? path.length < 1 : path.length < 2) return [];
      return [{
        tool,
        points: path,
        stroke: isSafeStrokeColor(raw.stroke) ? raw.stroke : DEFAULT_STROKE_COLOR,
        ...(typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 64 ? { id: raw.id } : {}),
        strokeWidth: typeof raw.strokeWidth === 'number' ? Math.max(1, Math.min(raw.strokeWidth, 48)) : DEFAULT_STROKE_WIDTH,
        ...(tool === 'text' ? { text } : {}),
      }];
    });
  }
  const legacy = points(data.points);
  if (legacy.length < 2) return [];
  return [{
    tool: 'pen',
    points: legacy,
    stroke: isSafeStrokeColor(data.stroke) ? data.stroke : DEFAULT_STROKE_COLOR,
    strokeWidth: typeof data.strokeWidth === 'number' ? data.strokeWidth : DEFAULT_STROKE_WIDTH,
  }];
}

/** The pen in hand: tool + colour + width. The canvas and the knowledge block share it. */
export interface DrawingPen { tool: CanvasDrawingTool; color: string; width: number }

/** How far the eraser reaches around its path. */
export function eraserRadius(width: number): number {
  return Math.max(8, width * 3);
}

/**
 * The stroke a captured pointer path becomes, or null when the gesture is not a
 * stroke (eraser, or a tap with a tool that needs a drag). The ONE place a path
 * is turned into a stroke — the canvas stage and the document drawing block both call it.
 */
export function strokeFromPath(pen: DrawingPen, path: readonly { x: number; y: number }[]): CanvasStroke | null {
  const start = path[0];
  if (!start || pen.tool === 'eraser') return null;
  // Freehand and shapes need a drag; text acts on a tap.
  if (pen.tool !== 'text' && path.length < 2) return null;
  const tool = pen.tool;
  const rounded = (point: { x: number; y: number }) => ({ x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 });
  return {
    tool,
    points: (tool === 'text' ? [start] : tool === 'pen' || tool === 'highlighter' ? path : [start, path[path.length - 1]!]).map(rounded),
    stroke: pen.color,
    strokeWidth: pen.width,
    ...(tool === 'text' ? { text: '' } : {}),
  };
}

/** A path being recorded between pointer-down and pointer-up. */
export interface StrokePathRef { current: Array<{ x: number; y: number }> }
export function beginStrokePath(ref: StrokePathRef, point: { x: number; y: number }): void { ref.current = [point]; }
/**
 * Extends only a path that was begun, so a hover never records.
 *
 * `minDistance` thins the path in the CALLER'S coordinate space: a point closer
 * than that to the last kept one is not kept. The newest point is always held as a
 * provisional tail (replaced by the next point while it is still close), so the
 * stroke always ends exactly where the pointer did.
 */
export function extendStrokePath(ref: StrokePathRef, point: { x: number; y: number }, minDistance = 0): void {
  const path = ref.current;
  const n = path.length;
  if (!n) return;
  const last = path[n - 1]!;
  // At the point cap the path stops growing but keeps following the pointer: the tail is replaced.
  if (n >= MAX_POINTS) { path[n - 1] = point; return; }
  if (n >= 2 && Math.hypot(path[n - 2]!.x - last.x, path[n - 2]!.y - last.y) < minDistance) { path[n - 1] = point; return; }
  path.push(point);
}
/** Stroke-capture thinning threshold, in the surface's own units. */
export const STROKE_MIN_POINT_DISTANCE = 0.75;
export function endStrokePath(ref: StrokePathRef): Array<{ x: number; y: number }> { return ref.current.splice(0); }

let idCounter = 0;
/** A fresh stroke id: a full UUID, with a fallback for a non-secure context where `crypto.randomUUID` is absent. */
export function mintStrokeId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return `k-${cryptoApi.randomUUID()}`;
  idCounter += 1;
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${idCounter}`;
}

/** A stroke with an identity: its own when it has one that is not `taken`, else a fresh one. */
export function withStrokeId(stroke: CanvasStroke, taken?: ReadonlySet<string>): CanvasStroke & { id: string } {
  return stroke.id && !taken?.has(stroke.id) ? (stroke as CanvasStroke & { id: string }) : { ...stroke, id: mintStrokeId() };
}

/**
 * What a store accepts from a caller that wants to ADD strokes: the input sanitised
 * through `canvasStrokes` (the same bounds a reader applies), every stroke given an id
 * unique within the target, and the lot truncated so the drawing never exceeds
 * `MAX_STROKES`. Both block stores call this, so the write path is bounded in one place.
 */
export function admitStrokes(existing: readonly CanvasStroke[], incoming: readonly CanvasStroke[]): Array<CanvasStroke & { id: string }> {
  const taken = new Set(existing.flatMap((stroke) => (stroke.id ? [stroke.id] : [])));
  const room = Math.max(0, MAX_STROKES - existing.length);
  let pointRoom = Math.max(0, MAX_TOTAL_POINTS - totalPoints(existing));
  const admitted: Array<CanvasStroke & { id: string }> = [];
  for (const stroke of canvasStrokes({ strokes: incoming })) {
    if (admitted.length >= room || stroke.points.length > pointRoom) break;
    pointRoom -= stroke.points.length;
    const next = withStrokeId(stroke, taken);
    taken.add(next.id);
    admitted.push(next);
  }
  return admitted;
}

/**
 * An EXISTING stroke list, copied as-is (seed, replace, move, rebuild): sanitised, ids unique,
 * and — over the read ceiling — the NEWEST kept. NOT `admitStrokes`: that applies the append
 * caps from empty and would keep the OLDEST strokes of a drawing that is being copied.
 */
export function retainStrokes(strokes: readonly CanvasStroke[]): Array<CanvasStroke & { id: string }> {
  const taken = new Set<string>();
  return canvasStrokes({ strokes }).map((stroke) => {
    const kept = withStrokeId(stroke, taken);
    taken.add(kept.id);
    return kept;
  });
}

/**
 * An existing stroke with a patch applied, re-sanitised; null when the result is no longer a
 * valid stroke, or (when `all` — the drawing's strokes — is given) when the patch would grow
 * the drawing past `MAX_TOTAL_POINTS`. A patch that does not add points is never refused.
 */
export function patchedStroke(stroke: CanvasStroke, patch: Partial<CanvasStroke>, all?: readonly CanvasStroke[]): CanvasStroke | null {
  const [next] = canvasStrokes({ strokes: [{ ...stroke, ...patch, id: stroke.id }] });
  if (!next) return null;
  if (all && next.points.length > stroke.points.length && totalPoints(all) - stroke.points.length + next.points.length > MAX_TOTAL_POINTS) return null;
  return next;
}

export function strokesBounds(strokes: readonly CanvasStroke[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const all = strokes.flatMap((stroke) => stroke.points);
  if (!all.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...all.map((item) => item.x)),
    minY: Math.min(...all.map((item) => item.y)),
    maxX: Math.max(...all.map((item) => item.x)),
    maxY: Math.max(...all.map((item) => item.y)),
  };
}

/** The `d` of a freehand path or a straight line. Shapes render as elements. */
export function strokePathD(stroke: CanvasStroke): string {
  const path = stroke.tool === 'line' ? [stroke.points[0]!, stroke.points[stroke.points.length - 1]!] : stroke.points;
  return path.map((item, index) => `${index ? 'L' : 'M'}${Math.round(item.x * 100) / 100} ${Math.round(item.y * 100) / 100}`).join(' ');
}

/** The box a rect/ellipse stroke describes, from its two corner points. */
export function strokeRect(stroke: CanvasStroke): { x: number; y: number; width: number; height: number } {
  const [start, end] = [stroke.points[0]!, stroke.points[stroke.points.length - 1]!];
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

function distanceToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Does the eraser passing through `path` touch this stroke? */
export function strokeHit(stroke: CanvasStroke, path: readonly { x: number; y: number }[], radius: number): boolean {
  const reach = radius + stroke.strokeWidth / 2;
  if (stroke.tool === 'text') return path.some((probe) => Math.hypot(probe.x - stroke.points[0]!.x, probe.y - stroke.points[0]!.y) <= reach + 12);
  if (stroke.tool === 'rect' || stroke.tool === 'ellipse') {
    const box = strokeRect(stroke);
    return path.some((probe) => probe.x >= box.x - reach && probe.x <= box.x + box.width + reach && probe.y >= box.y - reach && probe.y <= box.y + box.height + reach);
  }
  return path.some((probe) => stroke.points.some((item, index) => index > 0 && distanceToSegment(probe, stroke.points[index - 1]!, item) <= reach));
}

/** Whole strokes, never pixels: an eraser that leaves half a letter behind is
 *  harder to use than one that removes the mark you dragged across. */
export function eraseStrokes(strokes: readonly CanvasStroke[], path: readonly { x: number; y: number }[], radius: number): CanvasStroke[] {
  return strokes.filter((stroke) => !strokeHit(stroke, path, radius));
}

/**
 * Re-origin a stroke list at (0,0) and report the box it needs.
 *
 * A drawing node's `points` are relative to its own top-left, so every append
 * has to answer "did this grow the drawing upwards or to the left" — and if it
 * did, every existing stroke moves. Doing that in one place is what keeps a
 * sketch from drifting away from its own card as it is added to.
 */
export function normalizeStrokes(strokes: readonly CanvasStroke[], pad = 8): { strokes: CanvasStroke[]; width: number; height: number; offsetX: number; offsetY: number } {
  const bounds = strokesBounds(strokes);
  const offsetX = bounds.minX - pad;
  const offsetY = bounds.minY - pad;
  return {
    strokes: strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((item) => ({ x: item.x - offsetX, y: item.y - offsetY })) })),
    width: Math.max(1, bounds.maxX - bounds.minX + pad * 2),
    height: Math.max(1, bounds.maxY - bounds.minY + pad * 2),
    offsetX,
    offsetY,
  };
}

/**
 * The node-data patch a stroke list becomes. One writer, so the rendered card,
 * the SVG export and the draw.io conversion always read the same fields.
 *
 * `drawingOriginX/Y` are where the CARD has to sit for these (now node-relative)
 * strokes to land back on the board where they were drawn. They are part of the
 * patch rather than a second return value because every caller that writes the
 * strokes must also move the card, and splitting those apart is how a sketch
 * would drift a few pixels every time it was added to.
 */
export function drawingPatch(strokes: readonly CanvasStroke[]): Partial<CreationNodeData> {
  const normalized = normalizeStrokes(strokes);
  return {
    strokes: normalized.strokes,
    drawingWidth: normalized.width,
    drawingHeight: normalized.height,
    drawingOriginX: normalized.offsetX,
    drawingOriginY: normalized.offsetY,
    // `points` is kept in step so a board saved here still opens on a client
    // that predates strokes, and so the legacy single-path readers keep working.
    points: normalized.strokes[0]?.points ?? [],
    stroke: normalized.strokes[0]?.stroke ?? DEFAULT_STROKE_COLOR,
    strokeWidth: normalized.strokes[0]?.strokeWidth ?? DEFAULT_STROKE_WIDTH,
  } as Partial<CreationNodeData>;
}

function svgAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Standalone SVG markup — the download, and the picture draw.io embeds. */
export function strokesSvg(strokes: readonly CanvasStroke[], width: number, height: number): string | null {
  if (!strokes.length) return null;
  const body = strokes.map((stroke) => {
    const color = svgAttribute(stroke.stroke);
    const common = `stroke="${color}" stroke-width="${stroke.tool === 'highlighter' ? stroke.strokeWidth * HIGHLIGHTER_WIDTH_FACTOR : stroke.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${stroke.tool === 'highlighter' ? ` opacity="${HIGHLIGHTER_OPACITY}"` : ''}`;
    if (stroke.tool === 'text') {
      return `<text x="${stroke.points[0]!.x}" y="${stroke.points[0]!.y}" fill="${color}" font-size="${Math.max(12, stroke.strokeWidth * 5)}" font-family="system-ui, sans-serif">${svgAttribute(stroke.text ?? '')}</text>`;
    }
    if (stroke.tool === 'rect') {
      const box = strokeRect(stroke);
      return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="none" ${common} />`;
    }
    if (stroke.tool === 'ellipse') {
      const box = strokeRect(stroke);
      return `<ellipse cx="${box.x + box.width / 2}" cy="${box.y + box.height / 2}" rx="${box.width / 2}" ry="${box.height / 2}" fill="none" ${common} />`;
    }
    return `<path d="${svgAttribute(strokePathD(stroke))}" fill="none" ${common} />`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}">${body}</svg>`;
}
