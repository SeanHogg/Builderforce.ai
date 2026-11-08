import { appendMesh, emptyMesh, placeMesh, prismMesh, type TriMesh, type Vec3 } from '../mesh/triMesh';
import { ownedEntityIds, type Model3dBox, type Model3dCylinder, type Model3dEntity, type Model3dSphere, type Model3dState } from './model3dState';

/**
 * The scene as one triangle mesh, ready for STL or STEP.
 *
 * Primitives are tessellated here with outward-facing normals (a test pins each one's
 * volume positive). Entities owned by a boolean are reached through it, never twice.
 *
 * BOOLEANS: a union is exactly the concatenation of its children. A difference or an
 * intersection needs a solid-modelling kernel this app does not carry, so it is exported
 * as the union and COUNTED in `approximated` — the caller tells the person, rather than
 * the file silently describing a different part than the one they cut.
 */

const DEFAULT_CYLINDER_SEGMENTS = 32;
const DEFAULT_SPHERE_SEGMENTS = 24;
const MAX_NESTING = 8;

export interface Model3dMeshResult {
  mesh: TriMesh;
  /** How many difference/intersection operations were exported as unions. */
  approximated: number;
}

export function boxMesh({ widthMm: w, depthMm: d, heightMm: h }: Pick<Model3dBox, 'widthMm' | 'depthMm' | 'heightMm'>): TriMesh {
  const [x, y, z] = [w / 2, d / 2, h / 2];
  const vertices: Vec3[] = [
    [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
  ];
  return {
    vertices,
    triangles: [
      [0, 2, 1], [0, 3, 2], // bottom
      [4, 5, 6], [4, 6, 7], // top
      [0, 1, 5], [0, 5, 4], // -Y
      [1, 2, 6], [1, 6, 5], // +X
      [2, 3, 7], [2, 7, 6], // +Y
      [3, 0, 4], [3, 4, 7], // -X
    ],
  };
}

export function cylinderMesh({ radiusMm: r, heightMm: h, segments = DEFAULT_CYLINDER_SEGMENTS }: Pick<Model3dCylinder, 'radiusMm' | 'heightMm' | 'segments'>): TriMesh {
  const vertices: Vec3[] = [[0, 0, -h / 2], [0, 0, h / 2]];
  for (let step = 0; step < segments; step += 1) {
    const angle = (step / segments) * Math.PI * 2;
    vertices.push([Math.cos(angle) * r, Math.sin(angle) * r, -h / 2], [Math.cos(angle) * r, Math.sin(angle) * r, h / 2]);
  }
  const triangles: TriMesh['triangles'] = [];
  for (let step = 0; step < segments; step += 1) {
    const bottom = 2 + step * 2;
    const nextBottom = 2 + ((step + 1) % segments) * 2;
    triangles.push([0, nextBottom, bottom], [1, bottom + 1, nextBottom + 1], [bottom, nextBottom, nextBottom + 1], [bottom, nextBottom + 1, bottom + 1]);
  }
  return { vertices, triangles };
}

export function sphereMesh({ radiusMm: r, segments = DEFAULT_SPHERE_SEGMENTS }: Pick<Model3dSphere, 'radiusMm' | 'segments'>): TriMesh {
  const vertices: Vec3[] = [];
  const triangles: TriMesh['triangles'] = [];
  for (let lat = 0; lat <= segments; lat += 1) {
    const theta = (lat / segments) * Math.PI;
    for (let lon = 0; lon <= segments; lon += 1) {
      const phi = (lon / segments) * Math.PI * 2;
      vertices.push([r * Math.sin(theta) * Math.cos(phi), r * Math.sin(theta) * Math.sin(phi), r * Math.cos(theta)]);
    }
  }
  for (let lat = 0; lat < segments; lat += 1) {
    for (let lon = 0; lon < segments; lon += 1) {
      const a = lat * (segments + 1) + lon;
      const b = a + segments + 1;
      // The pole rows collapse to a point: skip the zero-area half of each polar quad.
      if (lat > 0) triangles.push([a, b, a + 1]);
      if (lat < segments - 1) triangles.push([b, b + 1, a + 1]);
    }
  }
  return { vertices, triangles };
}

function entityMesh(state: Model3dState, entity: Model3dEntity, result: Model3dMeshResult, depth: number): TriMesh {
  let local: TriMesh;
  switch (entity.kind) {
    case 'box': local = boxMesh(entity); break;
    case 'cylinder': local = cylinderMesh(entity); break;
    case 'sphere': local = sphereMesh(entity); break;
    case 'extrude': local = prismMesh(entity.profile, 0, entity.depthMm); break;
    case 'boolean': {
      local = emptyMesh();
      if (depth >= MAX_NESTING) break;
      if (entity.op !== 'union') result.approximated += 1;
      for (const id of entity.children) {
        const child = state.entities.find((candidate) => candidate.id === id);
        if (child) appendMesh(local, entityMesh(state, child, result, depth + 1));
      }
      break;
    }
  }
  const { translate, rotate, scale } = entity;
  return placeMesh(local, {
    ...(translate ? { translate: [translate.x, translate.y, translate.z] as const } : {}),
    ...(rotate ? { rotate } : {}),
    ...(scale ? { scale: [scale.x, scale.y, scale.z] as const } : {}),
  });
}

export function model3dToMesh(state: Model3dState): Model3dMeshResult {
  const result: Model3dMeshResult = { mesh: emptyMesh(), approximated: 0 };
  const owned = ownedEntityIds(state);
  for (const entity of state.entities) {
    if (!owned.has(entity.id)) appendMesh(result.mesh, entityMesh(state, entity, result, 0));
  }
  return result;
}
