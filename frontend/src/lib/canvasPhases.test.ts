// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CANVAS_PHASES,
  canvasPhaseStorageKey,
  readChosenCanvasPhase,
  surfacesAddedByPhase,
  surfacesForPhase,
  writeCanvasPhase,
} from './canvasPhases';
import { boardCanvasSurfaces } from './canvasSurfaces';

describe('which surfaces each phase offers', () => {
  /**
   * THE REGRESSION THIS FILE EXISTS FOR. The Ideas scratchpad shipped as a board surface
   * in `canvasSurfaces.ts` and never appeared on screen: the header switcher offers only
   * what `surfacesForPhase` allows, and `ideas` was in no phase. A surface registered but
   * offered by no phase is a feature nobody can reach, and nothing else fails for it.
   */
  it('offers every board surface in at least one phase', () => {
    const offered = [...new Set(CANVAS_PHASES.flatMap((phase) => surfacesForPhase(phase)))];
    for (const def of boardCanvasSurfaces()) expect(offered, `${def.id} is offered by no phase`).toContain(def.id);
  });

  it('offers the idea scratchpad from the Idea phase on', () => {
    for (const phase of CANVAS_PHASES) expect(surfacesForPhase(phase), phase).toContain('ideas');
  });

  it('never takes a surface away when the phase moves forward', () => {
    for (let index = 1; index < CANVAS_PHASES.length; index += 1) {
      const before = surfacesForPhase(CANVAS_PHASES[index - 1]!);
      const after = surfacesForPhase(CANVAS_PHASES[index]!);
      for (const id of before) expect(after, `${CANVAS_PHASES[index]} drops ${id}`).toContain(id);
    }
  });
});

describe('App starts at Make (PRD 32 · W0)', () => {
  /** In Idea, App could only open "Start this session's app" — building before the idea
   *  is tested. A prototype that tests demand is an `experiment` card, not this surface. */
  it('does not offer App in Idea', () => {
    expect(surfacesForPhase('idea')).not.toContain('app');
    expect(surfacesForPhase('idea')).toEqual(['chat', 'graph', 'ideas', 'room']);
  });

  it('offers App from Make through Reach', () => {
    for (const phase of ['make', 'run', 'measure', 'reach'] as const) expect(surfacesForPhase(phase), phase).toContain('app');
  });

  it('offers Operate from Run, Insights from Measure and Launch only at Reach', () => {
    const offeredFrom = (id: string) => CANVAS_PHASES.find((phase) => surfacesForPhase(phase).includes(id as never));
    expect(offeredFrom('operate')).toBe('run');
    expect(offeredFrom('insights')).toBe('measure');
    expect(offeredFrom('launch')).toBe('reach');
  });

  it('keeps every phase a superset of the one before it', () => {
    for (let index = 1; index < CANVAS_PHASES.length; index += 1) {
      const before = new Set(surfacesForPhase(CANVAS_PHASES[index - 1]!));
      const after = new Set(surfacesForPhase(CANVAS_PHASES[index]!));
      expect([...before].every((id) => after.has(id)), CANVAS_PHASES[index]).toBe(true);
      expect(after.size, CANVAS_PHASES[index]).toBeGreaterThan(before.size);
    }
  });
});

describe('surfacesAddedByPhase — the phone sheet's "adds …" line', () => {
  it('names exactly what each phase offers that the one before did not', () => {
    expect(surfacesAddedByPhase('idea')).toEqual(['chat', 'graph', 'ideas', 'room']);
    expect(surfacesAddedByPhase('make')).toEqual(['app']);
    expect(surfacesAddedByPhase('run')).toEqual(['operate']);
    expect(surfacesAddedByPhase('measure')).toEqual(['insights']);
    expect(surfacesAddedByPhase('reach')).toEqual(['launch']);
  });

  it('adds up, phase by phase, to what the last phase offers', () => {
    const added = CANVAS_PHASES.flatMap((phase) => surfacesAddedByPhase(phase));
    expect(new Set(added).size).toBe(added.length);
    expect([...added].sort()).toEqual([...surfacesForPhase('reach')].sort());
  });
});

describe('the phase is remembered per canvas (PRD 32 · W2)', () => {
  const LEGACY_KEY = 'builderforce:create:phase';
  beforeEach(() => { window.localStorage.clear(); });

  it('keys the choice on the session id', () => {
    expect(canvasPhaseStorageKey('abc')).toBe('builderforce:create:phase:abc');
    writeCanvasPhase('measure', 'abc');
    expect(window.localStorage.getItem('builderforce:create:phase:abc')).toBe('measure');
  });

  it('keeps two canvases' phases apart', () => {
    writeCanvasPhase('measure', 'canvas-a');
    writeCanvasPhase('make', 'canvas-b');
    expect(readChosenCanvasPhase('canvas-a')).toBe('measure');
    expect(readChosenCanvasPhase('canvas-b')).toBe('make');
    expect(readChosenCanvasPhase('canvas-c')).toBeUndefined();
  });

  it('reads nothing when no choice was ever made — the canvas then opens at its frontier', () => {
    expect(readChosenCanvasPhase('fresh')).toBeUndefined();
  });

  it('ignores a value that is not a phase', () => {
    window.localStorage.setItem(canvasPhaseStorageKey('junk'), 'admin');
    expect(readChosenCanvasPhase('junk')).toBeUndefined();
  });

  it('ignores the legacy global key on read, and removes it on the first per-canvas write', () => {
    window.localStorage.setItem(LEGACY_KEY, 'reach');
    // Never migrated: one phase per BROWSER was never this canvas's truth.
    expect(readChosenCanvasPhase('canvas-a')).toBeUndefined();
    expect(window.localStorage.getItem(LEGACY_KEY)).toBe('reach');

    writeCanvasPhase('make', 'canvas-a');
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(readChosenCanvasPhase('canvas-a')).toBe('make');
  });
});
