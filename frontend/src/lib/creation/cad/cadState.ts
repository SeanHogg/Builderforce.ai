import { resolveExportColor } from '../exportColors';
/**
 * The state of a `cad` object: a 2D technical drawing, held as vector shapes.
 *
 * Coordinates are millimetres on the sheet, origin at the TOP-LEFT with Y growing down —
 * the orientation of the screen the shapes are drawn on. The DXF and PDF writers flip Y
 * (those formats are Y-up) so a drawing exports the right way round, not mirrored.
 *
 * Selection is NOT part of this state. It is something the editor is doing, not
 * something the drawing is, and persisting it would write the object on every click.
 */

export const CAD_SCHEMA_VERSION = 1;

export type CadUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
const CAD_UNITS: readonly CadUnit[] = ['mm', 'cm', 'm', 'in', 'ft'];

export interface CadLayer {
  /** Stable name — also the key each shape names its layer by. */
  name: string;
  visible: boolean;
  /** A locked layer is drawn, but takes no new shapes and none can be selected from it. */
  locked: boolean;
  /** `#rrggbb`. Shapes with no colour of their own inherit it. */
  color: string;
}

export const DEFAULT_CAD_LAYER_NAME = '0';

export interface CadShapeBase {
  id: string;
  layer: string;
  /** `#rrggbb`; the layer's colour when absent. */
  color?: string;
  /** Stroke weight in mm; 0.25 when absent. */
  strokeWidthMm?: number;
}

export interface CadLine extends CadShapeBase { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
export interface CadRect extends CadShapeBase { kind: 'rect'; x: number; y: number; width: number; height: number; cornerRadius?: number }
export interface CadCircle extends CadShapeBase { kind: 'circle'; cx: number; cy: number; radius: number }
export interface CadPolyline extends CadShapeBase { kind: 'polyline'; points: Array<{ x: number; y: number }>; closed?: boolean }
/** A linear dimension: the distance between two points, drawn offset from the measured segment. */
export interface CadDimension extends CadShapeBase { kind: 'dimension'; x1: number; y1: number; x2: number; y2: number; offsetMm: number; label?: string }
export interface CadText extends CadShapeBase { kind: 'text'; x: number; y: number; text: string; heightMm: number; rotation?: number }

export type CadShape = CadLine | CadRect | CadCircle | CadPolyline | CadDimension | CadText;
export type CadShapeKind = CadShape['kind'];

export interface CadGrid {
  visibleSpacingMm: number;
  snapSpacingMm: number;
  showGrid: boolean;
  snapEnabled: boolean;
}

export interface CadState {
  schemaVersion: number;
  widthMm: number;
  heightMm: number;
  unit: CadUnit;
  /** Back to front: the last shape is drawn on top. */
  shapes: CadShape[];
  layers: CadLayer[];
  activeLayerName: string;
  grid: CadGrid;
}

export const DEFAULT_CAD_WIDTH_MM = 420;
export const DEFAULT_CAD_HEIGHT_MM = 297;
const MAX_SHEET_MM = 20000;
const MAX_SHAPES = 5000;

export const DEFAULT_CAD_GRID: CadGrid = { visibleSpacingMm: 10, snapSpacingMm: 1, showGrid: true, snapEnabled: true };

/** `layerInk` is the default layer's colour (export palette role `layerInk`); a UI caller passes its resolved palette, anything else gets the role's own resolution. */
export function createBlankCadState(options: { layerInk?: string; widthMm?: number; heightMm?: number; unit?: CadUnit; grid?: Partial<CadGrid> } = {}): CadState {
  return {
    schemaVersion: CAD_SCHEMA_VERSION,
    widthMm: options.widthMm ?? DEFAULT_CAD_WIDTH_MM,
    heightMm: options.heightMm ?? DEFAULT_CAD_HEIGHT_MM,
    unit: options.unit ?? 'mm',
    shapes: [],
    layers: [{ name: DEFAULT_CAD_LAYER_NAME, visible: true, locked: false, color: options.layerInk ?? resolveExportColor('layerInk') }],
    activeLayerName: DEFAULT_CAD_LAYER_NAME,
    grid: { ...DEFAULT_CAD_GRID, ...options.grid },
  };
}

/* ---------- reading what was stored ---------- */

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function hex(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function shapeFrom(value: unknown, layers: ReadonlySet<string>): CadShape | null {
  const raw = record(value);
  if (!raw) return null;
  const id = text(raw.id);
  if (!id) return null;
  const layer = layers.has(text(raw.layer)) ? text(raw.layer) : DEFAULT_CAD_LAYER_NAME;
  const stroke = num(raw.strokeWidthMm);
  const base = { id, layer, ...(hex(raw.color) ? { color: hex(raw.color)! } : {}), ...(stroke !== null && stroke > 0 ? { strokeWidthMm: stroke } : {}) };
  switch (raw.kind) {
    case 'line': {
      const [x1, y1, x2, y2] = [num(raw.x1), num(raw.y1), num(raw.x2), num(raw.y2)];
      return x1 === null || y1 === null || x2 === null || y2 === null ? null : { ...base, kind: 'line', x1, y1, x2, y2 };
    }
    case 'rect': {
      const [x, y, width, height] = [num(raw.x), num(raw.y), num(raw.width), num(raw.height)];
      if (x === null || y === null || width === null || height === null) return null;
      const radius = num(raw.cornerRadius);
      return { ...base, kind: 'rect', x, y, width, height, ...(radius !== null && radius > 0 ? { cornerRadius: radius } : {}) };
    }
    case 'circle': {
      const [cx, cy, radius] = [num(raw.cx), num(raw.cy), num(raw.radius)];
      return cx === null || cy === null || radius === null || radius <= 0 ? null : { ...base, kind: 'circle', cx, cy, radius };
    }
    case 'polyline': {
      if (!Array.isArray(raw.points)) return null;
      const points = raw.points.flatMap((point) => {
        const p = record(point);
        const [x, y] = [num(p?.x), num(p?.y)];
        return x === null || y === null ? [] : [{ x, y }];
      });
      return points.length < 2 ? null : { ...base, kind: 'polyline', points, ...(raw.closed === true ? { closed: true } : {}) };
    }
    case 'dimension': {
      const [x1, y1, x2, y2] = [num(raw.x1), num(raw.y1), num(raw.x2), num(raw.y2)];
      if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
      return { ...base, kind: 'dimension', x1, y1, x2, y2, offsetMm: num(raw.offsetMm) ?? 10, ...(text(raw.label) ? { label: text(raw.label) } : {}) };
    }
    case 'text': {
      const [x, y] = [num(raw.x), num(raw.y)];
      if (x === null || y === null || !text(raw.text)) return null;
      const rotation = num(raw.rotation);
      return { ...base, kind: 'text', x, y, text: text(raw.text), heightMm: Math.max(0.5, num(raw.heightMm) ?? 5), ...(rotation ? { rotation } : {}) };
    }
    default:
      return null;
  }
}

/**
 * A stored `cadState` read back into a drawing that is safe to render and export.
 *
 * The value arrives from Brain, from a collaborator, or from an older save, so it is
 * rebuilt rather than trusted: a shape that is not well-formed is dropped, a shape on a
 * layer that does not exist moves to the default layer, and a missing field takes its
 * default. Anything unreadable yields a blank sheet, never a throw.
 */
export function cadStateFrom(value: unknown, layerInk: string = resolveExportColor('layerInk')): CadState {
  const raw = record(value);
  const blank = createBlankCadState({ layerInk });
  if (!raw) return blank;
  const layers = (Array.isArray(raw.layers) ? raw.layers : []).flatMap((entry): CadLayer[] => {
    const layer = record(entry);
    return layer && text(layer.name) ? [{ name: text(layer.name), visible: layer.visible !== false, locked: layer.locked === true, color: hex(layer.color) ?? layerInk }] : [];
  });
  const named = new Set<string>();
  const uniqueLayers = layers.filter((layer) => !named.has(layer.name) && named.add(layer.name));
  if (!named.has(DEFAULT_CAD_LAYER_NAME)) uniqueLayers.unshift(blank.layers[0]!);
  const gridRaw = record(raw.grid);
  const sheet = (candidate: unknown, fallback: number) => { const n = num(candidate); return n !== null && n >= 10 && n <= MAX_SHEET_MM ? n : fallback; };
  const spacing = (candidate: unknown, fallback: number) => { const n = num(candidate); return n !== null && n > 0 ? n : fallback; };
  const layerNames = new Set(uniqueLayers.map((layer) => layer.name));
  const shapes = (Array.isArray(raw.shapes) ? raw.shapes : []).slice(0, MAX_SHAPES)
    .flatMap((entry) => { const shape = shapeFrom(entry, layerNames); return shape ? [shape] : []; });
  return {
    schemaVersion: CAD_SCHEMA_VERSION,
    widthMm: sheet(raw.widthMm, blank.widthMm),
    heightMm: sheet(raw.heightMm, blank.heightMm),
    unit: CAD_UNITS.includes(raw.unit as CadUnit) ? raw.unit as CadUnit : 'mm',
    shapes,
    layers: uniqueLayers,
    activeLayerName: layerNames.has(text(raw.activeLayerName)) ? text(raw.activeLayerName) : DEFAULT_CAD_LAYER_NAME,
    grid: {
      visibleSpacingMm: spacing(gridRaw?.visibleSpacingMm, blank.grid.visibleSpacingMm),
      snapSpacingMm: spacing(gridRaw?.snapSpacingMm, blank.grid.snapSpacingMm),
      showGrid: gridRaw?.showGrid !== false,
      snapEnabled: gridRaw?.snapEnabled !== false,
    },
  };
}

/* ---------- edits: each returns the next state and leaves the input alone ---------- */

export function makeShapeId(): string {
  return `cad-${Math.random().toString(36).slice(2, 10)}`;
}

export function layerOf(state: CadState, name: string): CadLayer | undefined {
  return state.layers.find((layer) => layer.name === name);
}

export function addShape(state: CadState, shape: CadShape): CadState {
  return { ...state, shapes: [...state.shapes, shape] };
}

/** Delete shapes by id; shapes on a locked layer are kept. */
export function removeShapes(state: CadState, ids: readonly string[]): CadState {
  const doomed = new Set(ids);
  return { ...state, shapes: state.shapes.filter((shape) => !doomed.has(shape.id) || layerOf(state, shape.layer)?.locked === true) };
}

/** Add a layer. A duplicate name leaves the state unchanged. */
export function addLayer(state: CadState, layer: CadLayer): CadState {
  return state.layers.some((existing) => existing.name === layer.name) ? state : { ...state, layers: [...state.layers, layer] };
}

/** Remove a layer and every shape on it. The last layer cannot be removed. */
export function removeLayer(state: CadState, name: string): CadState {
  if (state.layers.length <= 1 || !layerOf(state, name)) return state;
  const layers = state.layers.filter((layer) => layer.name !== name);
  return {
    ...state,
    layers,
    shapes: state.shapes.filter((shape) => shape.layer !== name),
    activeLayerName: state.activeLayerName === name ? layers[0]!.name : state.activeLayerName,
  };
}

export function updateLayer(state: CadState, name: string, patch: Partial<Omit<CadLayer, 'name'>>): CadState {
  return { ...state, layers: state.layers.map((layer) => (layer.name === name ? { ...layer, ...patch } : layer)) };
}

export function setActiveLayer(state: CadState, name: string): CadState {
  return layerOf(state, name) ? { ...state, activeLayerName: name } : state;
}

export function updateGrid(state: CadState, patch: Partial<CadGrid>): CadState {
  return { ...state, grid: { ...state.grid, ...patch } };
}

/** A name for a new layer that no existing layer has. */
export function nextLayerName(state: CadState, prefix = 'Layer'): string {
  let index = state.layers.length;
  while (state.layers.some((layer) => layer.name === `${prefix} ${index}`)) index += 1;
  return `${prefix} ${index}`;
}
