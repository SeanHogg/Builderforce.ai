import { canvasNodeFootprint, graphLayerRanks, type CanvasGraphEdge, type CanvasGraphNode } from './canvasGraph';

/**
 * The 3D canvas view — the board as a space you can turn, travel and rearrange.
 *
 * The space is the thing. Objects hold a real place in it, the camera orbits and
 * pans around them, and anything can be picked up and moved wherever it belongs.
 *
 * The depth planes are a reading aid laid over that space, not a cage the objects
 * live in. A flat board answers "what is here"; it answers "what depends on what"
 * only by tracing arrows. Stacking the objects by dependency (or by kind) makes
 * that structure the first thing you see — but an object dragged off its plane
 * stays where the user put it, with the plane left behind as a reference.
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
  /**
   * Where the camera is pointed, in viewport pixels. Applied outside the rotation
   * and the scale, so panning stays 1:1 with the pointer at any angle or zoom —
   * without it, zooming in would trap the user at the middle of the space.
   */
  panX: number;
  panY: number;
}

/** Enough tilt to read the depth axis, little enough to still read the cards. */
export const CANVAS_3D_DEFAULT_ORBIT: Canvas3DOrbit = { yaw: -24, pitch: 14, zoom: 0.42, panX: 0, panY: 0 };
export const CANVAS_3D_MIN_ZOOM = 0.08;
export const CANVAS_3D_MAX_ZOOM = 1.6;
/** Beyond this the planes are edge-on and nothing is legible, so orbiting stops. */
export const CANVAS_3D_MAX_PITCH = 84;
/** Distance between depth planes, in board pixels. */
export const CANVAS_3D_LAYER_GAP = 340;
/**
 * A long focal length. A short one exaggerates depth so violently that the back
 * plane becomes unreadable next to the front one — the view has to show depth,
 * not caricature it.
 */
export const CANVAS_3D_PERSPECTIVE = 3400;
/** Board padding around the outermost card, so planes read as surfaces. */
const PLANE_MARGIN = 260;
const DEGREES = 180 / Math.PI;

/** How depth is assigned. Flow answers "what feeds what"; group answers "what kind of thing is this". */
export const CANVAS_3D_DEPTH_MODES = ['flow', 'group'] as const;
export type Canvas3DDepthMode = (typeof CANVAS_3D_DEPTH_MODES)[number];

/** What a canvas tells the 3D view about one of its objects. */
export interface Canvas3DDescriptor {
  label: string;
  sublabel?: string | undefined;
  /** Bucket used both as the card's badge and as the depth axis in `group` mode. */
  group: string;
  icon?: string | undefined;
  accent?: string | undefined;
  /**
   * A picture of what this object produced — a rendered mesh, a drawn profile, an
   * image. Objects that generate something are the ones worth recognising at a
   * distance, which is exactly what the depth view is for.
   */
  preview?: string | undefined;
  /**
   * The geometry this object exported, when it exported any.
   *
   * A picture of a mesh is a photograph: it keeps the angle it was taken at while
   * the camera moves past it. Handing the view the geometry itself lets the object
   * be re-drawn from wherever the camera has ended up, so turning the scene turns
   * the object in it.
   */
  geometry?: { url: string; format?: string | undefined } | undefined;
  /**
   * How far this object floats off its depth plane, in board pixels.
   *
   * The plane is where the object would sit if depth were derived from the graph
   * alone; the offset is the user's own answer, kept whichever way the scene is
   * currently stacked. Absent means "wherever the layer puts it".
   */
  depthOffset?: number | undefined;
  /** Placement is locked on the board, so the space must not move it either. */
  locked?: boolean | undefined;
}

export type Canvas3DNode = CanvasGraphNode & { position: { x: number; y: number } };

export interface Canvas3DCard extends Canvas3DPoint {
  id: string;
  label: string;
  sublabel?: string | undefined;
  group: string;
  icon?: string | undefined;
  accent?: string | undefined;
  preview?: string | undefined;
  geometry?: { url: string; format?: string | undefined } | undefined;
  width: number;
  height: number;
  /** Contiguous depth index, 0 = furthest from the viewer. */
  layer: number;
  /** Depth of that layer's plane. Equal to `z` until the user lifts the object off it. */
  layerZ: number;
  /** Placement is locked: the card reads and selects, but never moves. */
  locked: boolean;
}

export interface Canvas3DLink {
  id: string;
  source: string;
  target: string;
  from: Canvas3DPoint;
  to: Canvas3DPoint;
  /** True when the connection travels through depth as well as across the board. */
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
    const layerZ = zOf(layer);
    const offset = Number.isFinite(entry.descriptor.depthOffset) ? Number(entry.descriptor.depthOffset) : 0;
    return {
      id: entry.node.id,
      label: entry.descriptor.label,
      sublabel: entry.descriptor.sublabel,
      group: entry.descriptor.group,
      icon: entry.descriptor.icon,
      accent: entry.descriptor.accent,
      preview: entry.descriptor.preview,
      geometry: entry.descriptor.geometry,
      width: entry.size.width,
      height: entry.size.height,
      layer,
      layerZ,
      locked: entry.descriptor.locked === true,
      x: entry.node.position.x + entry.size.width / 2 - centreX,
      y: entry.node.position.y + entry.size.height / 2 - centreY,
      z: layerZ + offset,
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
      spansLayers: from.z !== to.z,
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

/**
 * The zoom that brings the whole board into view.
 *
 * A fixed default cannot serve both a three-card sketch and a hundred-object
 * board — one opens microscopic, the other opens off screen. The margin absorbs
 * the extra footprint the tilt adds, since a rotated plane projects wider than
 * it measures.
 */
export function canvas3dFitZoom(plane: { width: number; height: number }, viewport: { width: number; height: number } | null): number {
  if (!plane.width || !plane.height || !viewport?.width || !viewport?.height) return CANVAS_3D_DEFAULT_ORBIT.zoom;
  return clamp(Math.min(viewport.width / plane.width, viewport.height / plane.height) * 0.82, CANVAS_3D_MIN_ZOOM, 1);
}

/**
 * Pan after a drag of (dx, dy) pixels.
 *
 * The pan sits outside the scale in the stage transform, so a pixel of pointer
 * travel is a pixel of scene travel however far in the user has zoomed.
 */
export function canvas3dPanAfterDrag(orbit: Canvas3DOrbit, dx: number, dy: number): Canvas3DOrbit {
  return {
    ...orbit,
    panX: Number.isFinite(orbit.panX + dx) ? orbit.panX + dx : orbit.panX,
    panY: Number.isFinite(orbit.panY + dy) ? orbit.panY + dy : orbit.panY,
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
 * The transform for the camera the scene is projected through.
 *
 * Panning moves the camera, not the scene: applied here — on the element that
 * owns the perspective — it lands after the projection, so a pixel of pointer
 * travel is a pixel of travel on screen and, more importantly, the pan never
 * bends how a drag maps back onto the board.
 */
export function canvas3dCameraTransform(orbit: Canvas3DOrbit): string {
  return `translate3d(${round(orbit.panX)}px, ${round(orbit.panY)}px, 0px)`;
}

/**
 * Where each board axis points on screen under the current orbit.
 *
 * This is the stage transform written as three vectors: the images of board +X,
 * +Y and depth +Z after `scale · rotateX · rotateY`, before the perspective
 * divide. Reading a card's position is that matrix applied forwards; dragging a
 * card is the same matrix solved backwards, so both live off this one basis
 * rather than each deriving the trigonometry again.
 */
export interface Canvas3DAxes {
  /** The screen direction board +X (right on the flat board) travels in. */
  u: Canvas3DPoint;
  /** The screen direction board +Y (down on the flat board) travels in. */
  v: Canvas3DPoint;
  /** The screen direction depth travels in. +Z is toward the viewer. */
  w: Canvas3DPoint;
}

export function canvas3dAxes({ yaw, pitch, zoom }: Canvas3DOrbit): Canvas3DAxes {
  // CSS rotateY maps +X to (cos, 0, -sin) and rotateX then tips the result about
  // the horizontal, which is where every sin/cos pairing below comes from.
  const cosYaw = Math.cos(yaw / DEGREES);
  const sinYaw = Math.sin(yaw / DEGREES);
  const cosPitch = Math.cos(pitch / DEGREES);
  const sinPitch = Math.sin(pitch / DEGREES);
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    u: { x: scale * cosYaw, y: scale * sinYaw * sinPitch, z: -scale * sinYaw * cosPitch },
    v: { x: 0, y: scale * cosPitch, z: scale * sinPitch },
    w: { x: scale * sinYaw, y: -scale * cosYaw * sinPitch, z: scale * cosYaw * cosPitch },
  };
}

/** Which way a drag moves an object: across its plane, or through depth. */
export type Canvas3DDragAxis = 'plane' | 'depth';

/**
 * An axis shorter than this on screen is pointing at the camera, and a drag has
 * no direction left to follow along it.
 */
const MIN_SCREEN_AXIS = 0.05;
/**
 * Past this many board pixels from the scene an answer is the solve falling
 * apart, not a place the user meant to reach.
 */
const MAX_UNPROJECT_REACH = 1e6;

/**
 * Where the pointer is in the space, read on a chosen depth plane.
 *
 * This inverts the projection rather than approximating it: the ray under the
 * cursor is intersected with the plane the object travels on, which is what
 * keeps a card exactly under the pointer for a whole drag — however far the
 * scene is turned, panned or zoomed, and however much perspective is
 * foreshortening it. Null when the plane is edge-on to the ray, where there is
 * no meaningful answer and the object simply waits for a better angle.
 *
 * Solving means three unknowns: the board (x, y), plus how much the perspective
 * divides at the answer — which is unknown until the answer is, and is exactly
 * what a linear approximation has to guess at. Written as `1/foreshortening` it
 * enters the equations linearly, so all three fall out of one 3x3 solve.
 */
export function canvas3dUnprojectToPlane(
  orbit: Canvas3DOrbit,
  screen: { x: number; y: number },
  planeZ: number,
): { x: number; y: number } | null {
  const { u, v, w } = canvas3dAxes(orbit);
  const depth = CANVAS_3D_PERSPECTIVE;
  const toPointer = { x: screen.x - orbit.panX, y: screen.y - orbit.panY };
  const columns: Matrix3 = [
    [u.x, v.x, -toPointer.x],
    [u.y, v.y, -toPointer.y],
    [u.z, v.z, depth],
  ];
  const rhs: [number, number, number] = [-w.x * planeZ, -w.y * planeZ, depth - w.z * planeZ];
  const determinant = determinant3(columns);
  const zoom = Number.isFinite(orbit.zoom) && orbit.zoom > 0 ? orbit.zoom : 1;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-6 * zoom * zoom * depth) return null;

  const x = determinant3(withColumn(columns, 0, rhs)) / determinant;
  const y = determinant3(withColumn(columns, 1, rhs)) / determinant;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) > MAX_UNPROJECT_REACH) return null;
  return { x, y };
}

/**
 * How far through depth a drag of (dx, dy) pixels carries the object under it.
 *
 * Depth is a single direction on screen, so the drag is measured along it: how
 * much of the gesture went the way depth runs, divided by how long that
 * direction is once foreshortened. `at` is where the object is now, since the
 * same drag means more board the further away it is being read from.
 */
export function canvas3dDepthFromDrag(orbit: Canvas3DOrbit, screen: { dx: number; dy: number }, at: Canvas3DPoint): number {
  const { u, v, w } = canvas3dAxes(orbit);
  const zoom = Number.isFinite(orbit.zoom) && orbit.zoom > 0 ? orbit.zoom : 1;
  const foreshorten = canvas3dPerspectiveFactor(u.z * at.x + v.z * at.y + w.z * at.z);
  const onScreen = Math.hypot(w.x, w.y);
  // Looking straight down the depth axis it has no screen direction at all, so
  // fall back to the vertical — the direction it resolves to at every angle that
  // can see the planes at all.
  const travelled = onScreen < MIN_SCREEN_AXIS * zoom
    ? -screen.dy / (zoom * foreshorten)
    : (screen.dx * w.x + screen.dy * w.y) / (foreshorten * onScreen * onScreen);
  return Number.isFinite(travelled) ? travelled : 0;
}

type Matrix3 = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

function determinant3(m: Matrix3): number {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

/** Cramer's rule: the same matrix with one column swapped for the right-hand side. */
function withColumn(m: Matrix3, index: number, column: readonly [number, number, number]): Matrix3 {
  return [
    [index === 0 ? column[0] : m[0][0], index === 1 ? column[0] : m[0][1], index === 2 ? column[0] : m[0][2]],
    [index === 0 ? column[1] : m[1][0], index === 1 ? column[1] : m[1][1], index === 2 ? column[1] : m[1][2]],
    [index === 0 ? column[2] : m[2][0], index === 1 ? column[2] : m[2][1], index === 2 ? column[2] : m[2][2]],
  ];
}

/**
 * The pan that brings a point in the scene to the middle of the viewport — how
 * the canvas focuses on a chosen object without disturbing where anything sits.
 */
export function canvas3dPanToCentre(orbit: Canvas3DOrbit, point: Canvas3DPoint): Canvas3DOrbit {
  const { u, v, w } = canvas3dAxes(orbit);
  const foreshorten = canvas3dPerspectiveFactor(u.z * point.x + v.z * point.y + w.z * point.z);
  const panX = -foreshorten * (u.x * point.x + v.x * point.y + w.x * point.z);
  const panY = -foreshorten * (u.y * point.x + v.y * point.y + w.y * point.z);
  return {
    ...orbit,
    panX: Number.isFinite(panX) ? panX : orbit.panX,
    panY: Number.isFinite(panY) ? panY : orbit.panY,
  };
}

/**
 * CSS perspective foreshortening at a transformed depth: things nearer the eye
 * project larger. Clamped well short of the camera plane, where the projection
 * has no finite answer and a gesture would blow up rather than degrade.
 */
export function canvas3dPerspectiveFactor(depth: number): number {
  if (!Number.isFinite(depth)) return 1;
  return CANVAS_3D_PERSPECTIVE / Math.max(CANVAS_3D_PERSPECTIVE - depth, CANVAS_3D_PERSPECTIVE * 0.2);
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
