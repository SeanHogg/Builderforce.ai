import { describe, expect, it } from 'vitest';
import { canvasTourDesignFromNode, defaultCanvasTourDesign } from './canvasTourDesign';

describe('canvas tour design', () => {
  it('creates an opt-in tour with an escape hatch by default', () => {
    expect(defaultCanvasTourDesign()).toMatchObject({ minimumVisits: 1, blurBackground: true, escapeHatch: true });
  });

  it('normalizes authored eligibility and target steps', () => {
    const tour = canvasTourDesignFromNode({ kind: 'guidedTour', title: 'Tour', tour: { minimumVisits: 99, version: 0, escapeHatch: false, steps: [{ id: 'a', title: 'A', body: 'B', targetObjectId: 'node-a' }] } });
    expect(tour.minimumVisits).toBe(20);
    expect(tour.version).toBe(1);
    expect(tour.escapeHatch).toBe(true);
    expect(tour.steps[0]).toMatchObject({ id: 'a', targetObjectId: 'node-a' });
  });
});
