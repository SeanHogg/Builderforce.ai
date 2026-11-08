import { triangleNormal, type TriMesh } from './triMesh';

/** The solid name STL carries on its first line — kept to characters every reader accepts. */
function solidName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'model';
}

function fixed(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : '0.000000';
}

/**
 * ASCII STL — the one every slicer reads and `lib/creativeGeometry` reads back for the
 * card preview. Binary would be smaller, but this is human-checkable and the files here
 * are plates and primitives, not scans.
 */
export function meshToStlAscii(mesh: TriMesh, name = 'model'): string {
  const solid = solidName(name);
  const lines: string[] = [`solid ${solid}`];
  for (const [ia, ib, ic] of mesh.triangles) {
    const a = mesh.vertices[ia]!;
    const b = mesh.vertices[ib]!;
    const c = mesh.vertices[ic]!;
    const normal = triangleNormal(a, b, c);
    lines.push(
      `  facet normal ${fixed(normal[0])} ${fixed(normal[1])} ${fixed(normal[2])}`,
      '    outer loop',
      `      vertex ${fixed(a[0])} ${fixed(a[1])} ${fixed(a[2])}`,
      `      vertex ${fixed(b[0])} ${fixed(b[1])} ${fixed(b[2])}`,
      `      vertex ${fixed(c[0])} ${fixed(c[1])} ${fixed(c[2])}`,
      '    endloop',
      '  endfacet',
    );
  }
  lines.push(`endsolid ${solid}`);
  return lines.join('\n');
}
