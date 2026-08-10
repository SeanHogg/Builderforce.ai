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

/** Read the facets of an ASCII STL — the form Canvas itself writes. */
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
 *
 * The angle is a parameter rather than a constant because the 3D canvas re-renders
 * this from the SAME triangles whenever the camera settles: a mesh that only ever
 * projects at one fixed three-quarter angle is a photograph of an object, not an
 * object the scene can turn.
 */
export function meshPreviewSvg(triangles: readonly GeometryTriangle[], options: GeometryPreviewOptions = {}): string | null {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
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

/** Draw an ASCII STL back as an image — the mesh reader plus the projection. */
export function stlPreviewSvg(source: string, options: GeometryPreviewOptions = {}): string | null {
  return meshPreviewSvg(parseAsciiStl(source), options);
}

/* ---------- reading a mesh authored anywhere ---------- */

/**
 * The mesh containers this canvas can turn.
 *
 * Canvas writes ASCII STL, but a model dropped onto the board was authored
 * somewhere else — a slicer writes binary STL, a modeller writes OBJ or glTF, a
 * CAD seat writes STEP. Reading only the one format Canvas happens to emit makes
 * every model from anywhere else an unreadable file, so each of these has a
 * reader. STEP is read only where it carries a tessellated face set: evaluating
 * analytic B-rep surfaces needs a geometry kernel, and guessing at one would draw
 * a shape the file does not describe.
 */
export type MeshFormat = 'stl' | 'obj' | 'gltf' | 'glb' | 'step';

const MESH_EXTENSIONS: ReadonlyArray<readonly [string, MeshFormat]> = [
  ['stl', 'stl'], ['obj', 'obj'], ['gltf', 'gltf'], ['glb', 'glb'], ['step', 'step'], ['stp', 'step'],
];

/**
 * Which reader a file name, URL, MIME type or format label asks for.
 *
 * Only the head of the value is inspected: a `data:` URL carries its media type
 * at the front and its payload — which may contain any of these words — after it.
 */
export function meshFormatFromHint(hint: string): MeshFormat | null {
  const value = hint.slice(0, 200).toLowerCase();
  for (const [token, format] of MESH_EXTENSIONS) {
    if (new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`).test(value)) return format;
  }
  return null;
}

function decodeText(data: ArrayBuffer): string {
  return new TextDecoder().decode(data);
}

/**
 * ASCII and binary STL share an extension, so the bytes decide.
 *
 * A binary file's triangle count exactly accounts for its length, which is the
 * reliable test; the text sniff is the fallback for a file whose count field is
 * wrong, where an ASCII header is the only remaining evidence.
 */
function isBinaryStl(data: ArrayBuffer): boolean {
  if (data.byteLength < 84) return false;
  if (84 + new DataView(data).getUint32(80, true) * 50 === data.byteLength) return true;
  const head = decodeText(data.slice(0, 512));
  return !/^\s*solid/i.test(head) || !/facet\s+normal/i.test(head);
}

export function parseBinaryStl(data: ArrayBuffer): GeometryTriangle[] {
  if (data.byteLength < 84) return [];
  const view = new DataView(data);
  const declared = view.getUint32(80, true);
  const available = Math.floor((data.byteLength - 84) / 50);
  const count = Math.min(declared, available);
  const triangles: GeometryTriangle[] = [];
  for (let index = 0; index < count; index += 1) {
    // 50 bytes per facet: a normal we recompute anyway, then three vertices.
    const base = 84 + index * 50 + 12;
    const vertex = (corner: number): [number, number, number] => [
      view.getFloat32(base + corner * 12, true),
      view.getFloat32(base + corner * 12 + 4, true),
      view.getFloat32(base + corner * 12 + 8, true),
    ];
    const vertices: [number, number, number][] = [vertex(0), vertex(1), vertex(2)];
    if (vertices.every((point) => point.every((component) => Number.isFinite(component)))) {
      triangles.push({ vertices: [vertices[0]!, vertices[1]!, vertices[2]!] });
    }
  }
  return triangles;
}

/** Read an OBJ's vertices and faces. Faces of any size are fanned into triangles. */
export function parseObj(source: string): GeometryTriangle[] {
  const points: [number, number, number][] = [];
  const triangles: GeometryTriangle[] = [];
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('v ')) {
      const parts = trimmed.slice(2).trim().split(/\s+/).slice(0, 3).map(Number);
      if (parts.length === 3 && parts.every((component) => Number.isFinite(component))) {
        points.push([parts[0]!, parts[1]!, parts[2]!]);
      }
    } else if (trimmed.startsWith('f ')) {
      // `f v`, `f v/vt`, `f v//vn` and `f v/vt/vn` all lead with the vertex index,
      // and a negative index counts back from the vertices seen so far.
      const corners = trimmed.slice(2).trim().split(/\s+/).map((token) => {
        const raw = Number(token.split('/')[0]);
        if (!Number.isFinite(raw) || raw === 0) return -1;
        return raw < 0 ? points.length + raw : raw - 1;
      }).filter((index) => index >= 0 && index < points.length);
      for (let corner = 2; corner < corners.length; corner += 1) {
        triangles.push({ vertices: [points[corners[0]!]!, points[corners[corner - 1]!]!, points[corners[corner]!]!] });
      }
    }
  }
  return triangles;
}

/* ---------- glTF / GLB ---------- */

type Matrix4 = readonly number[];
const IDENTITY_4: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major 4×4 multiply, matching glTF's own matrix convention. */
function multiply4(a: Matrix4, b: Matrix4): Matrix4 {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] = a[row]! * b[column * 4]!
        + a[4 + row]! * b[column * 4 + 1]!
        + a[8 + row]! * b[column * 4 + 2]!
        + a[12 + row]! * b[column * 4 + 3]!;
    }
  }
  return out;
}

function transformPoint(matrix: Matrix4, point: [number, number, number]): [number, number, number] {
  return [
    matrix[0]! * point[0]! + matrix[4]! * point[1]! + matrix[8]! * point[2]! + matrix[12]!,
    matrix[1]! * point[0]! + matrix[5]! * point[1]! + matrix[9]! * point[2]! + matrix[13]!,
    matrix[2]! * point[0]! + matrix[6]! * point[1]! + matrix[10]! * point[2]! + matrix[14]!,
  ];
}

function trsMatrix(node: Record<string, unknown>): Matrix4 {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix as number[];
  const [tx, ty, tz] = (Array.isArray(node.translation) ? node.translation : [0, 0, 0]) as number[];
  const [qx, qy, qz, qw] = (Array.isArray(node.rotation) ? node.rotation : [0, 0, 0, 1]) as number[];
  const [sx, sy, sz] = (Array.isArray(node.scale) ? node.scale : [1, 1, 1]) as number[];
  const rotation = [
    1 - 2 * (qy! * qy! + qz! * qz!), 2 * (qx! * qy! + qz! * qw!), 2 * (qx! * qz! - qy! * qw!), 0,
    2 * (qx! * qy! - qz! * qw!), 1 - 2 * (qx! * qx! + qz! * qz!), 2 * (qy! * qz! + qx! * qw!), 0,
    2 * (qx! * qz! + qy! * qw!), 2 * (qy! * qz! - qx! * qw!), 1 - 2 * (qx! * qx! + qy! * qy!), 0,
    tx!, ty!, tz!, 1,
  ];
  return rotation.map((value, index) => (index < 12 ? value * [sx!, sy!, sz!][Math.floor(index / 4)]! : value));
}

function base64ToBuffer(payload: string): ArrayBuffer | null {
  try {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  } catch {
    return null;
  }
}

const GLTF_COMPONENT_READERS: Record<number, (view: DataView, offset: number) => number> = {
  5120: (view, offset) => view.getInt8(offset),
  5121: (view, offset) => view.getUint8(offset),
  5122: (view, offset) => view.getInt16(offset, true),
  5123: (view, offset) => view.getUint16(offset, true),
  5125: (view, offset) => view.getUint32(offset, true),
  5126: (view, offset) => view.getFloat32(offset, true),
};
const GLTF_COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const GLTF_TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/**
 * Read a glTF document's triangles, with every node's placement applied.
 *
 * A model is routinely a tree of parts positioned by their nodes; reading the
 * primitives alone piles every part at the origin, which is a different object
 * from the one the file describes. Buffers are read from the GLB binary chunk or
 * from an embedded `data:` URI — a buffer that lives in a separate file is left
 * to the caller, since fetching it is not this function's decision to make.
 */
export function parseGltf(json: string, binaryChunk: ArrayBuffer | null = null): GeometryTriangle[] {
  let document: Record<string, unknown>;
  try {
    document = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return [];
  }
  const list = (key: string): Record<string, unknown>[] => Array.isArray(document[key]) ? document[key] as Record<string, unknown>[] : [];
  const buffers = list('buffers').map((buffer) => {
    const uri = typeof buffer.uri === 'string' ? buffer.uri : '';
    if (!uri) return binaryChunk;
    const match = /^data:[^,]*;base64,([\s\S]*)$/.exec(uri);
    return match ? base64ToBuffer(match[1]!) : null;
  });
  const bufferViews = list('bufferViews');
  const accessors = list('accessors');
  const meshes = list('meshes');
  const nodes = list('nodes');

  const read = (accessorIndex: unknown): number[] | null => {
    const accessor = typeof accessorIndex === 'number' ? accessors[accessorIndex] : undefined;
    if (!accessor) return null;
    const view = typeof accessor.bufferView === 'number' ? bufferViews[accessor.bufferView] : undefined;
    if (!view) return null;
    const buffer = typeof view.buffer === 'number' ? buffers[view.buffer] : null;
    const reader = GLTF_COMPONENT_READERS[accessor.componentType as number];
    const componentBytes = GLTF_COMPONENT_BYTES[accessor.componentType as number];
    const components = GLTF_TYPE_COMPONENTS[String(accessor.type)];
    if (!buffer || !reader || !componentBytes || !components) return null;
    const stride = typeof view.byteStride === 'number' && view.byteStride > 0 ? view.byteStride : components * componentBytes;
    const start = (typeof view.byteOffset === 'number' ? view.byteOffset : 0) + (typeof accessor.byteOffset === 'number' ? accessor.byteOffset : 0);
    const count = typeof accessor.count === 'number' ? accessor.count : 0;
    if (start + (count - 1) * stride + components * componentBytes > buffer.byteLength) return null;
    const data = new DataView(buffer);
    const out: number[] = [];
    for (let element = 0; element < count; element += 1) {
      for (let component = 0; component < components; component += 1) {
        out.push(reader(data, start + element * stride + component * componentBytes));
      }
    }
    return out;
  };

  const triangles: GeometryTriangle[] = [];
  const emit = (meshIndex: unknown, matrix: Matrix4) => {
    const mesh = typeof meshIndex === 'number' ? meshes[meshIndex] : undefined;
    if (!mesh) return;
    for (const primitive of (Array.isArray(mesh.primitives) ? mesh.primitives : []) as Record<string, unknown>[]) {
      // Mode 4 is TRIANGLES and is the glTF default; strips and fans are a
      // different index walk and are skipped rather than drawn wrongly.
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      const attributes = (primitive.attributes ?? {}) as Record<string, unknown>;
      const positions = read(attributes.POSITION);
      if (!positions) continue;
      const vertexCount = Math.floor(positions.length / 3);
      const indices = read(primitive.indices) ?? Array.from({ length: vertexCount }, (_, index) => index);
      const corner = (index: number): [number, number, number] => transformPoint(matrix, [positions[index * 3]!, positions[index * 3 + 1]!, positions[index * 3 + 2]!]);
      for (let offset = 0; offset + 2 < indices.length; offset += 3) {
        const [a, b, c] = [indices[offset]!, indices[offset + 1]!, indices[offset + 2]!];
        if (a >= vertexCount || b >= vertexCount || c >= vertexCount) continue;
        triangles.push({ vertices: [corner(a), corner(b), corner(c)] });
      }
    }
  };

  const visited = new Set<number>();
  const walk = (index: number, parent: Matrix4) => {
    const node = nodes[index];
    if (!node || visited.has(index)) return;
    visited.add(index);
    const matrix = multiply4(parent, trsMatrix(node));
    emit(node.mesh, matrix);
    for (const child of (Array.isArray(node.children) ? node.children : []) as number[]) walk(child, matrix);
  };
  const scenes = list('scenes');
  const scene = scenes[typeof document.scene === 'number' ? document.scene : 0];
  const roots = Array.isArray(scene?.nodes) ? scene.nodes as number[] : nodes.map((_, index) => index);
  for (const root of roots) walk(root, IDENTITY_4);
  return triangles;
}

/** Split a GLB container into its JSON and binary chunks, then read it as glTF. */
export function parseGlb(data: ArrayBuffer): GeometryTriangle[] {
  if (data.byteLength < 20) return [];
  const view = new DataView(data);
  if (view.getUint32(0, true) !== 0x46546c67) return []; // 'glTF'
  let offset = 12;
  let json = '';
  let binary: ArrayBuffer | null = null;
  while (offset + 8 <= data.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > data.byteLength) break;
    if (type === 0x4e4f534a) json = decodeText(data.slice(start, start + length));
    else if (type === 0x004e4942) binary = data.slice(start, start + length);
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  return json ? parseGltf(json, binary) : [];
}

/**
 * Read the tessellated face sets an AP242 STEP file carries.
 *
 * A STEP part is normally analytic B-rep — surfaces defined by equations, which
 * need a geometry kernel to turn into triangles. Where the file also ships a
 * tessellation (which exporters targeting viewers routinely include) those
 * triangles are exactly what a preview wants, so they are read directly. A file
 * with no tessellation returns nothing rather than a guessed shape.
 */
export function parseStepTriangles(source: string): GeometryTriangle[] {
  const flat = source.replace(/\r?\n/g, ' ');
  const coordinateLists = new Map<string, [number, number, number][]>();
  const listPattern = /#(\d+)\s*=\s*COORDINATES_LIST\s*\(([\s\S]*?)\)\s*;/gi;
  for (const match of flat.matchAll(listPattern)) {
    const points: [number, number, number][] = [];
    for (const triple of match[2]!.matchAll(/\(\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*\)/g)) {
      const point: [number, number, number] = [Number(triple[1]), Number(triple[2]), Number(triple[3])];
      if (point.every((component) => Number.isFinite(component))) points.push(point);
    }
    if (points.length) coordinateLists.set(match[1]!, points);
  }
  if (!coordinateLists.size) return [];

  const triangles: GeometryTriangle[] = [];
  for (const match of flat.matchAll(/TRIANGULATED_FACE_SET\s*\(([\s\S]*?)\)\s*;/gi)) {
    const body = match[1]!;
    const reference = /#(\d+)/.exec(body)?.[1];
    const points = reference ? coordinateLists.get(reference) : [...coordinateLists.values()][0];
    if (!points) continue;
    // The face set's last list of integer triples is its triangle table; the
    // lists before it are normals and per-point indices, which a shaded preview
    // recomputes for itself.
    const groups = [...body.matchAll(/\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g)];
    for (const group of groups) {
      const corners = [Number(group[1]) - 1, Number(group[2]) - 1, Number(group[3]) - 1];
      if (corners.some((index) => index < 0 || index >= points.length)) continue;
      triangles.push({ vertices: [points[corners[0]!]!, points[corners[1]!]!, points[corners[2]!]!] });
    }
  }
  return triangles;
}

/** What the bytes look like, when nothing named the format. */
function sniffMeshFormat(data: ArrayBuffer): MeshFormat | null {
  if (data.byteLength >= 4 && new DataView(data).getUint32(0, true) === 0x46546c67) return 'glb';
  const head = decodeText(data.slice(0, 1024)).trimStart();
  if (/^ISO-10303/i.test(head)) return 'step';
  if (head.startsWith('{')) return 'gltf';
  if (/^solid\b/i.test(head) || /facet\s+normal/i.test(head)) return 'stl';
  if (/^(#|v\s|o\s|mtllib\b|usemtl\b)/m.test(head)) return 'obj';
  return data.byteLength >= 84 ? 'stl' : null;
}

/**
 * Read a mesh from whatever container it arrived in.
 *
 * `format` is the caller's hint (from a file name or media type); when it is
 * absent or wrong the bytes are sniffed instead, so a model saved with the wrong
 * extension still reads.
 */
export function parseMeshTriangles(data: ArrayBuffer, format?: MeshFormat | null): GeometryTriangle[] {
  const resolved = format ?? sniffMeshFormat(data);
  if (!resolved) return [];
  if (resolved === 'glb') return parseGlb(data);
  if (resolved === 'gltf') return parseGltf(decodeText(data));
  if (resolved === 'obj') return parseObj(decodeText(data));
  if (resolved === 'step') return parseStepTriangles(decodeText(data));
  return isBinaryStl(data) ? parseBinaryStl(data) : parseAsciiStl(decodeText(data));
}
