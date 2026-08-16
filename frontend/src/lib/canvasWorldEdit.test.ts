import { describe, expect, it } from 'vitest';
import { addProp, canvasWorldSceneFrom, deleteProp, emptyCanvasWorldScene, moveProp, updateGround, updateLighting, updateProp, updateSkyColor, updateSpawn } from '@builderforce/creation-canvas-contract';

describe('canvas world edit', () => {
  it('adds a prop with kind-default scale/color/physics and an incrementing id', () => {
    const scene = emptyCanvasWorldScene();
    const first = addProp(scene, { kind: 'block' });
    expect(first.prop).toMatchObject({ id: 'block-1', kind: 'block', color: '#94a3b8', physics: 'static' });
    const second = addProp(first.scene, { kind: 'block' });
    expect(second.prop.id).toBe('block-2');
    expect(second.scene.props).toHaveLength(2);
    // Original scene is untouched — every helper is immutable.
    expect(scene.props).toHaveLength(0);
  });

  it('places a fresh prop resting on the ground at half its own height', () => {
    const { prop } = addProp(emptyCanvasWorldScene(), { kind: 'sphere' });
    expect(prop.position).toEqual([0, 0.5, 0]);
  });

  it('updates and deletes a prop without touching the rest of the scene', () => {
    const { scene, prop } = addProp(emptyCanvasWorldScene(), { kind: 'hazard' });
    const moved = updateProp(scene, prop.id, { color: '#000000' });
    expect(moved.props[0]!.color).toBe('#000000');
    expect(moved.props[0]!.physics).toBe('sensor');
    const deleted = deleteProp(moved, prop.id);
    expect(deleted.props).toHaveLength(0);
  });

  it('moving an unknown prop id is a no-op', () => {
    const scene = emptyCanvasWorldScene();
    expect(moveProp(scene, 'missing', [1, 1, 1])).toEqual(scene);
  });

  it('moves a prop by position only', () => {
    const { scene, prop } = addProp(emptyCanvasWorldScene(), { kind: 'block' });
    const moved = moveProp(scene, prop.id, [5, 1, -2]);
    expect(moved.props[0]!.position).toEqual([5, 1, -2]);
  });

  it('patches spawn, ground, lighting and sky independently', () => {
    const scene = emptyCanvasWorldScene();
    expect(updateSpawn(scene, { position: [1, 2, 3] }).spawn.position).toEqual([1, 2, 3]);
    expect(updateGround(scene, { size: 50 }).ground).toEqual({ size: 50, color: scene.ground.color });
    expect(updateLighting(scene, { ambient: { intensity: 1, color: '#fff' } }).lighting.ambient.intensity).toBe(1);
    expect(updateSkyColor(scene, '#000000').skyColor).toBe('#000000');
  });

  it('reads an undefined field back as an empty scene rather than throwing', () => {
    expect(canvasWorldSceneFrom(undefined)).toEqual(emptyCanvasWorldScene());
    expect(canvasWorldSceneFrom(null)).toEqual(emptyCanvasWorldScene());
    expect(canvasWorldSceneFrom('not an object')).toEqual(emptyCanvasWorldScene());
  });

  it('drops a malformed prop instead of crashing the surface', () => {
    const scene = canvasWorldSceneFrom({
      props: [
        { id: 'block-1', kind: 'block', position: [1, 1, 1], rotation: [0, 0, 0], scale: [2, 2, 2], color: '#fff', physics: 'static' },
        { kind: 'not-a-real-kind' },
        'garbage',
      ],
    });
    expect(scene.props).toHaveLength(1);
    expect(scene.props[0]!.id).toBe('block-1');
  });

  it('round-trips a written scene through the defensive reader unchanged', () => {
    const { scene } = addProp(emptyCanvasWorldScene(), { kind: 'ramp' });
    expect(canvasWorldSceneFrom(scene)).toEqual(scene);
  });
});
