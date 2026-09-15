import { describe, expect, it } from 'vitest';
import { CANVAS_PHASES, surfacesForPhase } from './canvasPhases';
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
