import { describe, expect, it } from 'vitest';
import { parseAsciiStl } from '@/lib/creativeGeometry';
import { meshVolume, placeMesh, rotateByQuaternion } from '../mesh/triMesh';
import { buildModel3dExport, model3dExportFileName, model3dPreviewSvg } from './model3dExport';
import { boxMesh, cylinderMesh, model3dToMesh, sphereMesh } from './model3dMesh';
import {
  addBooleanOp, addBox, addCylinder, addSphere, createBlankModel3dState, deleteEntities, materialColor,
  model3dStateFrom, ownedEntityIds, updateEntity, type Model3dState,
} from './model3dState';

const MATERIAL = '#d9dde4';

function sceneOf(...adds: Array<(state: Model3dState) => { state: Model3dState; id: string }>): { state: Model3dState; ids: string[] } {
  let state = createBlankModel3dState(MATERIAL);
  const ids: string[] = [];
  for (const add of adds) { const next = add(state); state = next.state; ids.push(next.id); }
  return { state, ids };
}

describe('model3d edits', () => {
  it('adds a box resting on the bed at its centre, without touching the input', () => {
    const before = createBlankModel3dState(MATERIAL);
    const { state, id } = addBox(before);
    expect(before.entities).toHaveLength(0);
    expect(state.entities).toHaveLength(1);
    expect(state.entities[0]).toMatchObject({ id, kind: 'box', translate: { x: 110, y: 110, z: 10 } });
  });

  it('yields the right kinds', () => {
    const { state } = sceneOf((s) => addCylinder(s), (s) => addSphere(s));
    expect(state.entities.map((entity) => entity.kind)).toEqual(['cylinder', 'sphere']);
  });

  it('groups two or more existing entities under a boolean and keeps the children', () => {
    const { state, ids } = sceneOf((s) => addBox(s), (s) => addCylinder(s));
    const grouped = addBooleanOp(state, 'difference', ids);
    expect(grouped.state.entities).toHaveLength(3);
    expect(grouped.state.entities[2]).toMatchObject({ kind: 'boolean', op: 'difference', children: ids });
    expect(() => addBooleanOp(state, 'union', [ids[0]!])).toThrow();
    expect(() => addBooleanOp(state, 'union', [ids[0]!, 'ghost'])).toThrow();
    expect(() => addBooleanOp(state, 'union', [ids[0]!, ids[0]!])).toThrow();
    expect([...ownedEntityIds(grouped.state)]).toEqual(ids);
  });

  it('deleting a child takes its boolean with it; deleting the boolean leaves the children', () => {
    const { state, ids } = sceneOf((s) => addBox(s), (s) => addCylinder(s));
    const grouped = addBooleanOp(state, 'union', ids).state;
    expect(deleteEntities(grouped, [ids[0]!]).entities.map((entity) => entity.id)).toEqual([ids[1]]);
    expect(deleteEntities(grouped, [grouped.entities[2]!.id]).entities.map((entity) => entity.id)).toEqual(ids);
  });

  it('updates and moves one entity, keeping order', () => {
    const { state, ids } = sceneOf((s) => addBox(s), (s) => addSphere(s));
    const widened = updateEntity(state, ids[0]!, { widthMm: 50 } as never);
    expect(widened.entities[0]).toMatchObject({ widthMm: 50 });
    expect(widened.entities.map((entity) => entity.id)).toEqual(ids);
    expect(updateEntity(widened, ids[1]!, { translate: { x: 1, y: 2, z: 3 } }).entities[1]!.translate).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('resolves an entity colour through its material, then the default', () => {
    const { state, ids } = sceneOf((s) => addBox(s));
    const palette: Model3dState = { ...state, materials: [...state.materials, { id: 'red', label: 'Red', color: '#ff0000' }] };
    expect(materialColor(palette, palette.entities[0]!)).toBe(palette.materials[0]!.color);
    expect(materialColor(palette, updateEntity(palette, ids[0]!, { materialId: 'red' }).entities[0]!)).toBe('#ff0000');
    expect(materialColor(palette, { ...palette.entities[0]!, materialId: 'gone' })).toBe(palette.materials[0]!.color);
  });
});

describe('model3dStateFrom', () => {
  it('reads anything unreadable as an empty scene', () => {
    for (const bad of [null, 'x', 4, [], {}]) expect(model3dStateFrom(bad, MATERIAL).entities).toEqual([]);
  });

  it('drops malformed entities and booleans whose children are gone, and clamps nonsense dimensions', () => {
    const state = model3dStateFrom({
      entities: [
        { id: 'a', kind: 'box', widthMm: -5, depthMm: 'x' },
        { id: 'b', kind: 'cylinder', radiusMm: 4, heightMm: 9, segments: 2 },
        { id: 'bad', kind: 'extrude', profile: [{ x: 0, y: 0 }, { x: 1, y: 1 }], depthMm: 3 },
        { id: 'g', kind: 'boolean', op: 'difference', children: ['a', 'b'] },
        { id: 'orphan', kind: 'boolean', op: 'union', children: ['a', 'missing'] },
        { kind: 'box' },
        { id: 'z', kind: 'torus' },
      ],
    }, MATERIAL);
    expect(state.entities.map((entity) => entity.id)).toEqual(['a', 'b', 'g']);
    expect(state.entities[0]).toMatchObject({ widthMm: 20, depthMm: 20, heightMm: 20 });
    expect(state.entities[1]).not.toHaveProperty('segments');
  });

  it('repairs the material palette and the build volume', () => {
    const state = model3dStateFrom({ materials: [{ id: 'm', color: 'not-a-colour' }], defaultMaterialId: 'nope', buildVolumeMm: { x: 0, y: 1, z: 1 } }, MATERIAL);
    expect(state.materials).toHaveLength(1);
    expect(state.defaultMaterialId).toBe(state.materials[0]!.id);
    expect(state.buildVolumeMm).toEqual({ x: 220, y: 220, z: 250 });
  });
});

describe('primitive meshes', () => {
  it('are closed solids with outward normals and the analytic volume', () => {
    expect(meshVolume(boxMesh({ widthMm: 20, depthMm: 30, heightMm: 40 }))).toBeCloseTo(20 * 30 * 40, 6);
    // An n-gon prism: ½·n·r²·sin(2π/n)·h.
    expect(meshVolume(cylinderMesh({ radiusMm: 10, heightMm: 30, segments: 32 }))).toBeCloseTo(0.5 * 32 * 100 * Math.sin((2 * Math.PI) / 32) * 30, 4);
    const sphere = meshVolume(sphereMesh({ radiusMm: 10, segments: 48 }));
    expect(sphere).toBeGreaterThan(0.98 * (4 / 3) * Math.PI * 1000);
    expect(sphere).toBeLessThan((4 / 3) * Math.PI * 1000);
  });

  it('has no degenerate sphere triangles at the poles', () => {
    const mesh = sphereMesh({ radiusMm: 5, segments: 8 });
    // A full latitude/longitude grid has 2·n² triangles; the pole rows lose n each.
    expect(mesh.triangles).toHaveLength(2 * 8 * 8 - 2 * 8);
  });
});

describe('placement', () => {
  it('scales, then rotates, then translates', () => {
    const placed = placeMesh({ vertices: [[1, 0, 0]], triangles: [] }, { scale: [2, 1, 1], rotate: [0, 0, Math.SQRT1_2, Math.SQRT1_2], translate: [10, 0, 0] });
    // (1,0,0) → scaled (2,0,0) → turned 90° about Z (0,2,0) → moved (10,2,0)
    expect(placed.vertices[0]![0]).toBeCloseTo(10, 6);
    expect(placed.vertices[0]![1]).toBeCloseTo(2, 6);
    expect(rotateByQuaternion([1, 0, 0], [0, 0, 0, 1])).toEqual([1, 0, 0]);
  });

  it('keeps a mirrored solid facing outward', () => {
    const mirrored = placeMesh(boxMesh({ widthMm: 2, depthMm: 2, heightMm: 2 }), { scale: [-1, 1, 1] });
    expect(meshVolume(mirrored)).toBeCloseTo(8, 6);
  });
});

describe('scene mesh', () => {
  it('places each entity once, and exports a union as the concatenation of its children', () => {
    const { state, ids } = sceneOf((s) => addBox(s, { widthMm: 10, depthMm: 10, heightMm: 10 }), (s) => addBox(s, { widthMm: 10, depthMm: 10, heightMm: 10 }));
    const separate = model3dToMesh(state);
    const grouped = model3dToMesh(addBooleanOp(state, 'union', ids).state);
    expect(grouped.mesh.triangles).toHaveLength(separate.mesh.triangles.length);
    expect(meshVolume(grouped.mesh)).toBeCloseTo(2000, 6);
    expect(grouped.approximated).toBe(0);
  });

  it('counts a difference exported as a union, so the caller can say so', () => {
    const { state, ids } = sceneOf((s) => addBox(s), (s) => addCylinder(s));
    expect(model3dToMesh(addBooleanOp(state, 'difference', ids).state).approximated).toBe(1);
    expect(model3dToMesh(addBooleanOp(state, 'intersection', ids).state).approximated).toBe(1);
  });

  it('applies the entity translation to the exported vertices', () => {
    const { state, ids } = sceneOf((s) => addBox(s, { widthMm: 10, depthMm: 10, heightMm: 10 }));
    const moved = updateEntity(state, ids[0]!, { translate: { x: 100, y: 0, z: 0 } });
    const xs = model3dToMesh(moved).mesh.vertices.map((vertex) => vertex[0]);
    expect(Math.min(...xs)).toBe(95);
    expect(Math.max(...xs)).toBe(105);
  });

  it('does not hang on booleans that own each other', () => {
    const state = model3dStateFrom({
      entities: [{ id: 'a', kind: 'boolean', op: 'union', children: ['b', 'b2'] }, { id: 'b', kind: 'boolean', op: 'union', children: ['a', 'b2'] }, { id: 'b2', kind: 'box' }],
    }, MATERIAL);
    expect(() => model3dToMesh(state)).not.toThrow();
  });
});

describe('export', () => {
  const { state } = sceneOf((s) => addBox(s), (s) => addSphere(s));

  it('writes an STL the canvas reader parses back to the same triangle count', async () => {
    const result = buildModel3dExport(state, 'stl', 'My part');
    expect(result).toMatchObject({ fileName: 'my-part.stl', mimeType: 'model/stl', label: 'STL', approximated: 0 });
    expect(result.triangleCount).toBeGreaterThan(0);
    expect(parseAsciiStl(await result.blob.text())).toHaveLength(result.triangleCount);
  });

  it('writes a STEP file', async () => {
    const result = buildModel3dExport(state, 'step', 'My part');
    expect(result).toMatchObject({ fileName: 'my-part.step', mimeType: 'model/step', label: 'STEP' });
    const text = await result.blob.text();
    expect(text.startsWith('ISO-10303-21;')).toBe(true);
    expect(text).toContain('FACETED_BREP_SHAPE_REPRESENTATION');
  });

  it('falls back to a name when the title has no usable characters', () => {
    expect(model3dExportFileName('板', 'stl')).toBe('model.stl');
  });

  it('draws a preview of a non-empty scene and nothing for an empty one', () => {
    expect(model3dPreviewSvg(state)).toContain('<polygon');
    expect(model3dPreviewSvg(createBlankModel3dState(MATERIAL))).toBeNull();
  });
});
