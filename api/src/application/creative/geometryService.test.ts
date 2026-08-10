import { describe, expect, it } from 'vitest';
import {
  dxfFromProfile,
  facetCount,
  readCadSpec,
  readModel3dSpec,
  stlFromSolids,
  tessellateSolid,
} from './geometryService';

/**
 * The contract these tests hold is narrow and load-bearing: a model chooses the
 * SHAPE, and this module is the reason the resulting file always opens. So the
 * cases below are the two failure modes that matter — a spec that cannot be built
 * must be rejected rather than repaired, and a spec that can be built must produce
 * geometry a reader accepts.
 */

describe('reading a generated spec', () => {
  it('accepts a profile a machinist could cut', () => {
    const spec = readCadSpec({
      outline: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }, { x: 0, y: 40 }],
      holes: [{ x: 40, y: 20, r: 6 }],
      lines: [{ x1: 0, y1: 20, x2: 80, y2: 20 }],
      summary: 'Mounting plate',
    });
    expect(spec).toMatchObject({ summary: 'Mounting plate' });
    expect(spec!.outline).toHaveLength(4);
    expect(spec!.holes).toHaveLength(1);
  });

  it('rejects an outline that is not a shape rather than patching it up', () => {
    // A silently repaired outline is a part nobody designed, so two points, a
    // missing outline and non-numeric coordinates are all a refusal.
    expect(readCadSpec({ outline: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toBeNull();
    expect(readCadSpec({ outline: 'a plate' })).toBeNull();
    expect(readCadSpec(null)).toBeNull();
    expect(readCadSpec({ outline: [{ x: 0, y: 0 }, { x: 1, y: 'wide' }, { x: 2, y: 2 }] })).toBeNull();
  });

  it('drops a hole with no radius but keeps the rest of the drawing', () => {
    const spec = readCadSpec({
      outline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      holes: [{ x: 5, y: 5, r: 0 }, { x: 6, y: 6, r: 2 }],
    });
    expect(spec!.holes).toEqual([{ x: 6, y: 6, r: 2 }]);
  });

  it('keeps only primitives that have the dimensions their type needs', () => {
    const spec = readModel3dSpec({
      solids: [
        { type: 'box', x: 0, y: 0, z: 10, width: 20, depth: 20, height: 20 },
        { type: 'cylinder', x: 0, y: 0, z: 30, radius: 5 },
        { type: 'sphere', x: 0, y: 0, z: 40, radius: 8 },
        { type: 'torus', x: 0, y: 0, z: 0, radius: 4 },
      ],
      summary: 'A post with a ball on it',
    });
    expect(spec!.solids.map((solid) => solid.type)).toEqual(['box', 'sphere']);
  });

  it('rejects a model with nothing buildable in it', () => {
    expect(readModel3dSpec({ solids: [] })).toBeNull();
    expect(readModel3dSpec({ solids: [{ type: 'box', x: 0, y: 0, z: 0, width: -5, depth: 5, height: 5 }] })).toBeNull();
    expect(readModel3dSpec(null)).toBeNull();
  });
});

describe('evaluating a spec into geometry', () => {
  it('writes the outline as a CLOSED polyline, so the part is a region', () => {
    const dxf = dxfFromProfile({
      outline: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }, { x: 0, y: 40 }],
      holes: [{ x: 40, y: 20, r: 6 }],
      lines: [{ x1: 0, y1: 20, x2: 80, y2: 20 }],
    });
    const tokens = dxf.split('\n');
    // Group code 70 carries the closed flag; without it the profile is a stray path.
    expect(tokens[tokens.indexOf('LWPOLYLINE') + 5]).toBe('70');
    expect(tokens[tokens.indexOf('LWPOLYLINE') + 6]).toBe('1');
    expect(dxf).toContain('CIRCLE');
    expect(dxf).toContain('LINE');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('closes a box with twelve triangles and no degenerate faces', () => {
    const faces = tessellateSolid({ type: 'box', x: 0, y: 0, z: 5, width: 10, depth: 10, height: 10 });
    expect(faces.filter(Boolean)).toHaveLength(12);
    expect(faces.every((face) => face === null || !face.includes('NaN'))).toBe(true);
  });

  it('drops the degenerate slivers a sphere’s poles produce', () => {
    const faces = tessellateSolid({ type: 'sphere', x: 0, y: 0, z: 0, radius: 4 });
    // Every band emits two triangles per segment, but the two polar bands collapse
    // half of theirs to a line; writing those would make the solid non-manifold.
    expect(faces.filter(Boolean).length).toBeGreaterThan(0);
    expect(faces.filter((face) => face === null).length).toBeGreaterThan(0);
  });

  it('emits an ASCII STL whose facet count matches what it claims', () => {
    const spec = {
      solids: [
        { type: 'box' as const, x: 0, y: 0, z: 5, width: 10, depth: 10, height: 10 },
        { type: 'cylinder' as const, x: 0, y: 0, z: 20, radius: 3, height: 10 },
      ],
    };
    const stl = stlFromSolids('Bracket v2', spec);
    expect(stl.startsWith('solid Bracket_v2')).toBe(true);
    expect(stl.trimEnd().endsWith('endsolid Bracket_v2')).toBe(true);
    expect(stl.match(/facet normal/g)).toHaveLength(facetCount(spec));
    // Every facet closes its own loop, which is what a reader checks first.
    expect(stl.match(/endfacet/g)!.length).toBe(stl.match(/facet normal/g)!.length);
    expect(stl.match(/outer loop/g)!.length).toBe(stl.match(/endloop/g)!.length);
    expect(stl).not.toContain('NaN');
  });
});
