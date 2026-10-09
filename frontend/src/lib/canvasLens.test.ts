import { describe, expect, it } from 'vitest';
import { CANVAS_LENSES, canvasLensDefinition, canvasLensSessionPath, isCanvasLens, lensForRoute } from './canvasLens';
import { isStageRoute } from './workbenchPolicy';

describe('canvas lenses — the registry', () => {
  it('names each lens once', () => {
    const ids = CANVAS_LENSES.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['canvas', 'studio']);
  });

  it('keeps the canvas lens a no-op: full chrome, nothing applied on entry', () => {
    expect(canvasLensDefinition('canvas')).toMatchObject({
      chrome: { topChrome: true, commandBar: true, shellSidebar: true },
      surface: null, appModality: null, phaseFloor: null, brainDock: null, promptPlacement: null,
    });
  });

  it('presents Studio as prompt + preview: no canvas chrome, the App surface, a docked conversation', () => {
    expect(canvasLensDefinition('studio')).toMatchObject({
      chrome: { topChrome: false, commandBar: false, shellSidebar: false },
      surface: 'app', appModality: 'designer', phaseFloor: 'make',
      brainDock: { side: 'left', open: true }, promptPlacement: 'docked',
    });
  });

  it('degrades an unknown id to the canvas lens rather than throwing', () => {
    expect(canvasLensDefinition('nope' as never).id).toBe('canvas');
    expect(isCanvasLens('studio')).toBe(true);
    expect(isCanvasLens('nope')).toBe(false);
    expect(isCanvasLens(undefined)).toBe(false);
  });
});

describe('lensForRoute — one answer for "is this a board" and "how is it presented"', () => {
  it('reads a Studio session as the studio lens, guest and server ids alike', () => {
    expect(lensForRoute('/studio/local-abc')).toBe('studio');
    expect(lensForRoute('/studio/2f1c0b7e-0000-4000-8000-000000000000')).toBe('studio');
  });

  it('never reads the Studio home or the durable-project IDE as a board', () => {
    expect(lensForRoute('/studio')).toBeNull();
    expect(lensForRoute('/studio/project/42')).toBeNull();
    expect(lensForRoute('/studio/project')).toBeNull();
  });

  it('reads a canvas board as the canvas lens, and the library as no board', () => {
    expect(lensForRoute('/create/local-abc')).toBe('canvas');
    expect(lensForRoute('/create/2f1c0b7e')).toBe('canvas');
    expect(lensForRoute('/create')).toBeNull();
    expect(lensForRoute('/pricing')).toBeNull();
  });

  it('is what the stage policy asks, so a Studio session keeps the board mounted', () => {
    expect(isStageRoute('/studio/local-abc')).toBe(true);
    expect(isStageRoute('/create/local-abc')).toBe(true);
    expect(isStageRoute('/studio')).toBe(false);
    expect(isStageRoute('/studio/project/42')).toBe(false);
    expect(isStageRoute('/brainstorm')).toBe(true);
  });
});

describe('canvasLensSessionPath — the redirect that keeps the lens', () => {
  it('addresses the same session through either lens', () => {
    expect(canvasLensSessionPath('canvas', 'local-abc')).toBe('/create/local-abc');
    expect(canvasLensSessionPath('studio', 'local-abc')).toBe('/studio/local-abc');
  });

  it('carries the query it is given and drops the empty entries', () => {
    expect(canvasLensSessionPath('studio', 'srv-1', { surface: 'app', prompt: null })).toBe('/studio/srv-1?surface=app');
    expect(canvasLensSessionPath('canvas', 'srv-1', { surface: null })).toBe('/create/srv-1');
  });
});
