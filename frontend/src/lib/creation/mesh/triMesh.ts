/**
 * An indexed triangle mesh, and the two things every solid-producing kind does with one:
 * place it (scale, rotate, translate) and measure it.
 *
 * ── WHY IT IS SHARED ─────────────────────────────────────────────────────────
 * A CAD drawing extruded to a plate and a 3D model assembled from primitives both end as
 * triangles that leave as STL or STEP. They used to carry three private copies of the
 * triangle writer between them; one mesh type with one STL writer and one STEP writer
 * (`meshStl.ts`, `meshStep.ts`) means a fix to either file format lands for both kinds.
 *
 * Coordinates are millimetres, Z up — the orientation STL and STEP readers assume.
 * Winding is counter-clockwise seen from outside, so face normals point out.
 */

export type Vec3 = readonly [number, number, number];
/** Quaternion as [x, y, z, w]. */
export type Quat = readonly [number, number, number, number];

export interface TriMesh {
  vertices: Vec3[];
  /** Each triangle is three indices into `vertices`. */
  triangles: Array<readonly [number, number, number]>;
}

export function emptyMesh(): TriMesh {
  return { vertices: [], triangles: [] };
}

/** Append `source` onto `target`, re-basing its indices. */
export function appendMesh(target: TriMesh, source: TriMesh): void {
  const base = target.vertices.length;
  for (const vertex of source.vertices) target.vertices.push(vertex);
  for (const [a, b, c] of source.triangles) target.triangles.push([a + base, b + base, c + base]);
}

/** Rotate a point by a unit quaternion. */
export function rotateByQuaternion([x, y, z]: Vec3, [qx, qy, qz, qw]: Quat): Vec3 {
  // v' = v + 2w(q × v) + 2 q × (q × v)
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

export interface MeshPlacement {
  scale?: Vec3;
  rotate?: Quat;
  translate?: Vec3;
}

/** Scale, then rotate, then translate — the order a scene graph applies them. */
export function placeMesh(mesh: TriMesh, placement: MeshPlacement): TriMesh {
  const [sx, sy, sz] = placement.scale ?? [1, 1, 1];
  const [tx, ty, tz] = placement.translate ?? [0, 0, 0];
  const vertices = mesh.vertices.map((vertex): Vec3 => {
    const scaled: Vec3 = [vertex[0] * sx, vertex[1] * sy, vertex[2] * sz];
    const turned = placement.rotate ? rotateByQuaternion(scaled, placement.rotate) : scaled;
    return [turned[0] + tx, turned[1] + ty, turned[2] + tz];
  });
  // A mirroring scale (an odd number of negative axes) turns the solid inside out;
  // flipping the winding keeps the normals pointing out.
  const mirrored = sx * sy * sz < 0;
  const triangles = mesh.triangles.map(([a, b, c]): readonly [number, number, number] => (mirrored ? [a, c, b] : [a, b, c]));
  return { vertices, triangles };
}

/** Signed volume (mm³). Positive for a closed mesh whose normals point out. */
export function meshVolume(mesh: TriMesh): number {
  let volume = 0;
  for (const [ia, ib, ic] of mesh.triangles) {
    const a = mesh.vertices[ia]!;
    const b = mesh.vertices[ib]!;
    const c = mesh.vertices[ic]!;
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return volume;
}

/** The unit normal of a triangle; the zero vector for a degenerate one. */
export function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  return length > 0 ? [nx / length, ny / length, nz / length] : [0, 0, 0];
}

/** The triangles in the shape `lib/creativeGeometry`'s previews read. */
export function meshToGeometryTriangles(mesh: TriMesh): Array<{ vertices: [number, number, number][] }> {
  return mesh.triangles.map(([a, b, c]) => ({
    vertices: [mesh.vertices[a]!, mesh.vertices[b]!, mesh.vertices[c]!].map((vertex): [number, number, number] => [vertex[0], vertex[1], vertex[2]]),
  }));
}

/** Signed area of a 2D polygon — positive when it winds counter-clockwise. */
export function polygonArea(points: ReadonlyArray<{ x: number; y: number }>): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

/**
 * A closed prism: `profile` extruded from `z0` to `z1`.
 *
 * The caps are a triangle fan from the first vertex, which is exact for a convex
 * profile and a sliver of overlap for a concave one — acceptable for the plates and
 * brackets this produces, and stated here rather than discovered in a slicer.
 */
export function prismMesh(profile: ReadonlyArray<{ x: number; y: number }>, z0: number, z1: number): TriMesh {
  if (profile.length < 3) return emptyMesh();
  const ring = polygonArea(profile) < 0 ? [...profile].reverse() : profile;
  const count = ring.length;
  const vertices: Vec3[] = [];
  for (const point of ring) vertices.push([point.x, point.y, z0], [point.x, point.y, z1]);
  const triangles: Array<readonly [number, number, number]> = [];
  for (let index = 1; index < count - 1; index += 1) {
    triangles.push([0, (index + 1) * 2, index * 2]);
    triangles.push([1, index * 2 + 1, (index + 1) * 2 + 1]);
  }
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    triangles.push([index * 2, next * 2, next * 2 + 1]);
    triangles.push([index * 2, next * 2 + 1, index * 2 + 1]);
  }
  return { vertices, triangles };
}
