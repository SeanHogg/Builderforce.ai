import { describe, expect, it } from 'vitest';
import { FRUSTRATION_THRESHOLDS } from '@builderforce/interaction-contract';
import { MarkTracker } from './marks';

describe('MarkTracker', () => {
  it('emits rage when three clicks land inside the contract window', () => {
    const marks: string[] = [];
    const tracker = new MarkTracker({ emit: (m) => marks.push(m.kind) });
    const t = 1_000;
    for (let i = 0; i < FRUSTRATION_THRESHOLDS.rage.minClicks; i++) {
      tracker.click({ t: t + i * 200, x: 10, y: 10 }, 'button.buy', {
        tagName: 'BUTTON',
        getAttribute: () => null,
      });
    }
    expect(marks).toContain('rage');
  });

  it('emits quickback on A→B→A inside 7s', () => {
    const marks: string[] = [];
    const tracker = new MarkTracker({ emit: (m) => marks.push(m.kind) });
    tracker.page({ path: '/a', t: 0 });
    tracker.page({ path: '/b', t: 1_000 });
    tracker.page({ path: '/a', t: 2_000 });
    expect(marks).toContain('quickback');
  });

  it('emits error marks', () => {
    const marks: string[] = [];
    const tracker = new MarkTracker({ emit: (m) => marks.push(m.kind) });
    tracker.error('TypeError', 40);
    expect(marks).toEqual(['error']);
  });
});
