import { canvasNodeFootprint, graphLayerRanks, type CanvasGraphEdge, type CanvasGraphNode } from './canvasGraph';

/**
 * The 3D canvas view — a spatial reading of the same objects and connections.
 *
 * A flat board answers "what is here"; it answers "what depends on what" only by
 * tracing arrows. Lifting each object onto a depth plane makes that structure the
 * first thing you see: sources at the back, everything they feed one plane closer,
 * and the whole stack turnable so a dense board can be read from an angle instead
 * of untangled by hand.
 *
 * Everything here is pure geometry over the node/edge arrays already on screen —
 * no renderer, no WebGL, no second copy of the graph. The scene is projected by
 * CSS 3D transforms, so the cards stay real DOM (focusable, selectable, readable
 * by assistive tech) and every number below is deterministic and testable.
 */

export interface Canvas3DPoint {
  x: number;
  y: number;
  z: number;
}

export interface Canvas3DOrbit {
  /** Turntable rotation about the vertical axis, degrees, wrapped to (-180, 180]. */
  yaw: number;
  /** Camera elevation, degrees. Positive looks down onto the stack. */
  pitch: number;
  /** Uniform scale applied to the whole scene. */
  zoom: number;
}

/** Enough tilt to read the depth axis, little enough to still read the cards. */
export const CANVAS_3D_DEFAULT_ORBIT: Canvas3DOrbit = { yaw: -26, pitch: 16, zoom: 0.42 };
export const CANVAS_3D_MIN_ZOOM = 0.08;
export const CANVAS_3D_MAX_ZOOM = 1.6;
/** Beyond this the planes are edge-on and nothing is legible, so orbiting stops. */
export const CANVAS_3D_MAX_PITCH = 84;
/** Distance between depth planes, in board pixels. */
export const CANVAS_3D_LAYER_GAP = 460;
export const CANVAS_3D_PERSPECTIVE = 2200;
/** Board padding around the outermost card, so planes read as surfaces. */
const PLANE_MARGIN = 260;
const DEGREES = 180 / Math.PI;

/** How depth is assigned. Flow answers "what feeds what"; group answers "what kind of thing is this". */
export const CANVAS_3D_DEPTH_MODES = ['flow', 'group'] as const;
export type Canvas3DDepthMode = (typeof CANVAS_3D_DEPTH_MODES)[number];

export function isCanvas3DDepthMode(value: unknown): value is Canvas3DDepthMode {
  return CANVAS_3D_DEPTH_MODES.includes(value as Canvas3DDepthMode);
}

/** What a canvas tells the 3D view about one of its objects. */
export interface Canvas3DDescriptor {
  label: string;
  sublabel?: string | undefined;
  /** Bucket used both as the card's badge and as the depth axis in `group` mode. */
  group: string;
  icon?: string | undefined;
  accent?: string | undefined;
}

export type Canvas3DNode = CanvasGraphNode & { position: { x: number; y: number } };

export interface Canvas3DCard extends Canvas3DPoint {
  id: string;
  label: string;
  sublabel?: string | undefined;
  group: string;
  icon?: string | undefined;
  accent?: string | undefined;
  width: number;
  height: number;
  /** Contiguous depth index, 0 = furthest from the viewer. */
  layer: number;
}

export interface Canvas3DLink {
  id: string;
  source: string;
  target: string;
  from: Canvas3DPoint;
  to: Canvas3DPoint;
  /** True when the connection also crosses a depth plane. */
  spansLayers: boolean;
}

export interface Canvas3DLayer {
  index: number;
  z: number;
  count: number;
  /** Present only in `group` mode — flow layers are numbered by the view instead. */
  label?: string | undefined;
}

export interface Canvas3DScene {
  cards: readonly Canvas3DCard[];
  links: readonly Canvas3DLink[];
  layers: readonly Canvas3DLayer[];
  /** Footprint of every depth plane, centred on the scene origin. */
  plane: { width: number; height: number };
  depthMode: Canvas3DDepthMode;
}

export interface Canvas3DSceneInput<T extends Canvas3DNode> {
  nodes: readonly T[];
  edges: readonly CanvasGraphEdge[];
  describe: (node: T) => Canvas3DDescriptor;
  depthMode?: Canvas3DDepthMode;
  /** Canvas-specific footprint, when a canvas knows more than the measured box. */
  measure?: (node: T) => { width: number; height: number };
}

/**
 * Project the board onto stacked depth planes.
 *
 * Positions keep their board coordinates so the 3D view and the flat canvas agree
 * on where things are; only the origin moves, to the centre of the bounding box,
 * so the scene turns about its own middle rather than swinging off screen. Depth
 * is centred the same way, which keeps the tilt balanced for one plane or ten.
 */
export function canvas3dScene<T extends Canvas3DNode>({
  nodes,
  edges,
  describe,
  depthMode = 'flow',
  measure = canvasNodeFootprint,
}: Canvas3DSceneInput<T>): Canvas3DScene {
  if (!nodes.length) return { cards: [], links: [], layers: [], plane: { width: 0, height: 0 }, depthMode };

  const described = nodes.map((node) => ({ node, descriptor: describe(node), size: measure(node) }));

  // Depth index per node: dependency depth, or the object's own bucket. Both are
  // normalised to a contiguous 0..n-1 so a gap in the ranking never shows as an
  // empty plane floating in the middle of the stack.
  const groupLabels = [...new Set(described.map((entry) => entry.descriptor.group))].sort((a, b) => a.localeCompare(b));
  const layering = graphLayerRanks(nodes, edges);
  const usedRanks = [...new Set(nodes.map((node) => layering.ranks.get(node.id) ?? 0))].sort((a, b) => a - b);
  const flowLayerByRank = new Map(usedRanks.map((rank, index) => [rank, index]));
  const layerOf = (entry: (typeof described)[number]): number => depthMode === 'group'
    ? Math.max(0, groupLabels.indexOf(entry.descriptor.group))
    : flowLayerByRank.get(layering.ranks.get(entry.node.id) ?? 0) ?? 0;

  const layerCount = depthMode === 'group' ? groupLabels.length : usedRanks.length;
  const centreLayer = (layerCount - 1) / 2;
  const zOf = (layer: number) => (layer - centreLayer) * CANVAS_3D_LAYER_GAP;

  const minX = Math.min(...described.map((entry) => entry.node.position.x));
  const minY = Math.min(...described.map((entry) => entry.node.position.y));
  const maxX = Math.max(...described.map((entry) => entry.node.position.x + entry.size.width));
  const maxY = Math.max(...described.map((entry) => entry.node.position.y + entry.size.height));
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;

  const cards: Canvas3DCard[] = described.map((entry) => {
    const layer = layerOf(entry);
    return {
      id: entry.node.id,
      label: entry.descriptor.label,
      sublabel: entry.descriptor.sublabel,
      group: entry.descriptor.group,
      icon: entry.descriptor.icon,
      accent: entry.descriptor.accent,
      width: entry.size.width,
      height: entry.size.height,
      layer,
      x: entry.node.position.x + entry.size.width / 2 - centreX,
      y: entry.node.position.y + entry.size.height / 2 - centreY,
      z: zOf(layer),
    };
  });

  const cardById = new Map(cards.map((card) => [card.id, card]));
  const links: Canvas3DLink[] = edges.flatMap((edge, index) => {
    const from = cardById.get(edge.source);
    const to = cardById.get(edge.target);
    if (!from || !to || from.id === to.id) return [];
    return [{
      id: `${edge.source}->${edge.target}:${index}`,
      source: edge.source,
      target: edge.target,
      from: { x: from.x, y: from.y, z: from.z },
      to: { x: to.x, y: to.y, z: to.z },
      spansLayers: from.layer !== to.layer,
    }];
  });

  const counts = cards.reduce((totals, card) => totals.set(card.layer, (totals.get(card.layer) ?? 0) + 1), new Map<number, number>());
  const layers: Canvas3DLayer[] = Array.from({ length: layerCount }, (_, index) => ({
    index,
    z: zOf(index),
    count: counts.get(index) ?? 0,
    ...(depthMode === 'group' ? { label: groupLabels[index] } : {}),
  }));

  return {
    cards,
    links,
    layers,
    plane: { width: maxX - minX + PLANE_MARGIN * 2, height: maxY - minY + PLANE_MARGIN * 2 },
    depthMode,
  };
}

/** Keep yaw in (-180, 180] so the readout never drifts to "720°" after a few spins. */
export function wrapDegrees(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Orbit after a pointer or keyboard drag of (dx, dy) pixels.
 *
 * Dragging right turns the stack like a turntable; dragging up raises the camera.
 * Pitch is clamped rather than wrapped — passing over the pole would flip the
 * scene upside down mid-gesture, which is disorienting and never intended.
 */
export function canvas3dOrbitAfterDrag(orbit: Canvas3DOrbit, dx: number, dy: number, sensitivity = 0.3): Canvas3DOrbit {
  return {
    ...orbit,
    yaw: wrapDegrees(orbit.yaw + dx * sensitivity),
    pitch: clamp(orbit.pitch - dy * sensitivity, -CANVAS_3D_MAX_PITCH, CANVAS_3D_MAX_PITCH),
  };
}

/** Multiplicative zoom, so each step feels the same at any distance. */
export function canvas3dOrbitAfterZoom(orbit: Canvas3DOrbit, factor: number): Canvas3DOrbit {
  const safe = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return { ...orbit, zoom: clamp(orbit.zoom * safe, CANVAS_3D_MIN_ZOOM, CANVAS_3D_MAX_ZOOM) };
}

/** Wheel deltas differ wildly per device, so convert to a bounded zoom factor. */
export function canvas3dZoomFactorFromWheel(deltaY: number): number {
  return Math.exp(-clamp(deltaY, -240, 240) / 420);
}

/** The transform for the scene root. Scale first so perspective stays constant. */
export function canvas3dStageTransform(orbit: Canvas3DOrbit): string {
  return `scale(${round(orbit.zoom)}) rotateX(${round(orbit.pitch)}deg) rotateY(${round(orbit.yaw)}deg)`;
}

/**
 * A connection as a single rotated bar.
 *
 * SVG cannot cross depth planes, so each link is a DOM bar of length |to - from|
 * whose left edge sits at `from`. Rotating +X onto the connection vector needs
 * `rotateZ(atan2(dy, dx)) rotateY(-asin(dz / length))`: CSS rotateY maps +X to
 * (cos, 0, -sin), so the Z component is picked up by a negative Y rotation, and
 * rotateZ then swings the remaining XY component into place.
 */
export function canvas3dLinkTransform(from: Canvas3DPoint, to: Canvas3DPoint): { transform: string; length: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  const translate = `translate3d(${round(from.x)}px, ${round(from.y)}px, ${round(from.z)}px)`;
  if (length < 0.001) return { transform: translate, length: 0 };
  const yaw = Math.atan2(dy, dx) * DEGREES;
  const pitch = -Math.asin(clamp(dz / length, -1, 1)) * DEGREES;
  return { transform: `${translate} rotateZ(${round(yaw)}deg) rotateY(${round(pitch)}deg)`, length };
}

/** Cards and planes are positioned from the scene centre, so they share one helper. */
export function canvas3dTranslate(point: Canvas3DPoint): string {
  return `translate3d(${round(point.x)}px, ${round(point.y)}px, ${round(point.z)}px) translate(-50%, -50%)`;
}

function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}
