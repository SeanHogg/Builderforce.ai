/**
 * Previews for the geometry Canvas actually produces.
 *
 * A CAD drawing exports DXF and a 3D model exports STL. Neither is an image, so
 * neither can be shown by pointing an `<img>` at the exported file — that is what
 * a broken preview tile is. Rather than fall back to a placeholder, the geometry
 * is read back and drawn: the DXF as its own paths, the STL as a shaded
 * orthographic projection of its triangles. What the object shows is therefore
 * the thing it exported, not a stand-in for it.
 *
 * Everything here is pure string → string, so it runs on the server, in a test,
 * and in the browser alike, and it costs no renderer and no dependency.
 */

export interface GeometryPoint {
  x: number;
  y: number;
}

export interface GeometryPath {
  points: GeometryPoint[];
  closed: boolean;
}

export interface GeometryTriangle {
  vertices: [number, number, number][];
}

export interface GeometryPreviewOptions {
  width?: number;
  height?: number;
  /** Turntable angle in degrees. The default is the usual three-quarter read. */
  yaw?: number;
  /** Camera elevation in degrees. */
  pitch?: number;
}

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 675;
const MARGIN = 96;
/** A three-quarter view: enough turn to show depth, enough tilt to show the top. */
const DEFAULT_YAW = -32;
const DEFAULT_PITCH = 22;
/** The preview tile's own palette, so a geometry preview reads like the placeholder it replaces. */
const BACKDROP = ['#202b5f', '#7c4dff'] as const;
const SHADE_DARK = [46, 56, 120] as const;
const SHADE_LIGHT = [214, 203, 255] as const;
const LIGHT_DIRECTION = normalize([-0.35, 0.72, 0.6]);
const CIRCLE_SEGMENTS = 48;

/** One backdrop for both readers, so the two previews sit together on a board. */
function backdrop(width: number, height: number): string {
  return `<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="${BACKDROP[0]}"/><stop offset="1" stop-color="${BACKDROP[1]}"/></linearGradient></defs>`
    + `<rect width="${width}" height="${height}" fill="url(#bg)"/>`;
}

function svgDocument(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${backdrop(width, height)}${body}</svg>`;
}

/** Same encoding the rest of the browser artifacts use, so previews stay inline. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function normalize(vector: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * Fit projected geometry into the frame.
 *
 * Both readers need the same thing — an arbitrary coordinate space centred and
 * scaled into a fixed viewBox — so they share one transform rather than each
 * inventing its own idea of "fits".
 */
function fitTransform(points: readonly GeometryPoint[], width: number, height: number): (point: GeometryPoint) => GeometryPoint {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const scale = Math.min(
    spanX > 1e-6 ? (width - MARGIN * 2) / spanX : Number.POSITIVE_INFINITY,
    spanY > 1e-6 ? (height - MARGIN * 2) / spanY : Number.POSITIVE_INFINITY,
  );
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return (point) => ({
    x: width / 2 + (point.x - (minX + maxX) / 2) * safeScale,
    y: height / 2 + (point.y - (minY + maxY) / 2) * safeScale,
  });
}

/* ---------- DXF ---------- */

/**
 * Read the entities a Builderforce drawing emits: polylines, lines and circles.
 *
 * This is deliberately not a DXF implementation — it is the subset needed to draw
 * back what Canvas exports, plus the arcs a hand-authored drawing is most likely
 * to add. Anything else is skipped rather than guessed at.
 */
export function parseDxfPaths(source: string): GeometryPath[] {
  const tokens = source.split(/\r?\n/).map((line) => line.trim());
  const paths: GeometryPath[] = [];
  let entity = '';
  let points: GeometryPoint[] = [];
  let closed = false;
  let pendingX: number | null = null;
  let secondX: number | null = null;
  let centre: GeometryPoint | null = null;

  const flush = () => {
    if (points.length >= 2) paths.push({ points, closed });
    entity = '';
    points = [];
    closed = false;
    pendingX = null;
    secondX = null;
    centre = null;
  };

  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const code = Number(tokens[index]);
    const value = tokens[index + 1] ?? '';
    if (!Number.isFinite(code)) continue;
    if (code === 0) {
      flush();
      if (value === 'LWPOLYLINE' || value === 'POLYLINE' || value === 'LINE' || value === 'CIRCLE') entity = value;
      continue;
    }
    if (!entity) continue;
    if (code === 70 && (entity === 'LWPOLYLINE' || entity === 'POLYLINE')) closed = (Number(value) & 1) === 1;
    else if (code === 10) pendingX = Number(value);
    else if (code === 20 && pendingX != null) {
      const point = { x: pendingX, y: Number(value) };
      if (entity === 'CIRCLE') centre = point; else points.push(point);
      pendingX = null;
    } else if (code === 11 && entity === 'LINE') secondX = Number(value);
    else if (code === 21 && entity === 'LINE' && secondX != null) {
      points.push({ x: secondX, y: Number(value) });
      secondX = null;
    } else if (code === 40 && entity === 'CIRCLE' && centre) {
      const radius = Number(value);
      if (Number.isFinite(radius) && radius > 0) {
        points = Array.from({ length: CIRCLE_SEGMENTS }, (_, step) => {
          const angle = (step / CIRCLE_SEGMENTS) * Math.PI * 2;
          return { x: centre!.x + Math.cos(angle) * radius, y: centre!.y + Math.sin(angle) * radius };
        });
        closed = true;
      }
    }
  }
  flush();
  return paths.filter((path) => path.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
}

/** Draw a DXF back as an image. Returns null when there is nothing readable in it. */
export function dxfPreviewSvg(source: string, options: GeometryPreviewOptions = {}): string | null {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const paths = parseDxfPaths(source);
  const all = paths.flatMap((path) => path.points);
  if (all.length < 2) return null;
  // DXF measures Y upward and SVG measures it downward, so the drawing is
  // mirrored once here rather than at every point of use.
  const project = fitTransform(all.map((point) => ({ x: point.x, y: -point.y })), width, height);
  const body = paths.map((path) => {
    const drawn = path.points.map((point) => project({ x: point.x, y: -point.y }));
    const d = drawn.map((point, index) => `${index ? 'L' : 'M'}${round(point.x)} ${round(point.y)}`).join(' ') + (path.closed ? ' Z' : '');
    return `<path d="${d}" fill="${path.closed ? 'rgba(255,255,255,.14)' : 'none'}" stroke="#ffffff" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  return svgDocument(width, height, body);
}

/* ---------- STL ---------- */

/** Read the facets of an ASCII STL. Binary STL is not produced by Canvas, so it is not read here. */
export function parseAsciiStl(source: string): GeometryTriangle[] {
  const triangles: GeometryTriangle[] = [];
  let vertices: [number, number, number][] = [];
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/.exec(line);
    if (!match) {
      if (/^\s*endfacet/.test(line)) vertices = [];
      continue;
    }
    const vertex: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (vertex.some((component) => !Number.isFinite(component))) continue;
    vertices.push(vertex);
    if (vertices.length === 3) {
      triangles.push({ vertices: [vertices[0]!, vertices[1]!, vertices[2]!] });
      vertices = [];
    }
  }
  return triangles;
}

/**
 * Render a mesh as a shaded orthographic projection.
 *
 * Orthographic rather than perspective because the frame is a thumbnail: a
 * vanishing point buys nothing at this size and distorts the silhouette. Facets
 * are sorted back to front and painted, which is exact for the convex solids this
 * previews and degrades gracefully rather than dropping faces for anything else.
 */
export function stlPreviewSvg(source: string, options: GeometryPreviewOptions = {}): string | null {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const triangles = parseAsciiStl(source);
  if (!triangles.length) return null;

  const yaw = ((options.yaw ?? DEFAULT_YAW) * Math.PI) / 180;
  const pitch = ((options.pitch ?? DEFAULT_PITCH) * Math.PI) / 180;
  const [cosYaw, sinYaw, cosPitch, sinPitch] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
  // STL is Z-up; the camera works in a Y-up space, so the axes are swapped before
  // the turntable (Y) and elevation (X) rotations are applied.
  const toView = ([modelX, modelY, modelZ]: [number, number, number]): [number, number, number] => {
    const [right, up, forward] = [modelX, modelZ, modelY];
    const turnedX = right * cosYaw + forward * sinYaw;
    const turnedZ = -right * sinYaw + forward * cosYaw;
    return [turnedX, up * cosPitch - turnedZ * sinPitch, up * sinPitch + turnedZ * cosPitch];
  };

  const faces = triangles.map((triangle) => {
    const view = triangle.vertices.map((vertex) => toView(vertex));
    const [a, b, c] = view as [[number, number, number], [number, number, number], [number, number, number]];
    const normal = normalize([
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ]);
    // Absolute lambert: a mesh with inconsistent winding still shades rather than
    // turning half its faces flat black.
    const lambert = Math.abs(normal[0] * LIGHT_DIRECTION[0] + normal[1] * LIGHT_DIRECTION[1] + normal[2] * LIGHT_DIRECTION[2]);
    return {
      points: view.map((vertex) => ({ x: vertex[0], y: -vertex[1] })),
      depth: (a[2] + b[2] + c[2]) / 3,
      intensity: 0.24 + 0.76 * lambert,
    };
  });

  const project = fitTransform(faces.flatMap((face) => face.points), width, height);
  const body = [...faces].sort((first, second) => first.depth - second.depth).map((face) => {
    const points = face.points.map((point) => project(point)).map((point) => `${round(point.x)},${round(point.y)}`).join(' ');
    const channel = (index: 0 | 1 | 2) => Math.round(SHADE_DARK[index] + (SHADE_LIGHT[index] - SHADE_DARK[index]) * face.intensity);
    return `<polygon points="${points}" fill="rgb(${channel(0)},${channel(1)},${channel(2)})" stroke="rgba(255,255,255,.24)" stroke-width="1.5" stroke-linejoin="round"/>`;
  }).join('');
  return svgDocument(width, height, body);
}
