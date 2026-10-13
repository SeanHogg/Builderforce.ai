import { describe, expect, it } from 'vitest';
import {
  DROPPED_SAMPLE,
  evaluateFunnel,
  interpolateStepTimes,
  reachedTimes,
  type FunnelRecording,
  type FunnelStepSpec,
} from './funnelFold';

const STEPS: FunnelStepSpec[] = [
  { ord: 0, stepKind: 'page', match: '/', matchMode: 'equals', label: 'Home' },
  { ord: 1, stepKind: 'page', match: '/pricing', matchMode: 'prefix', label: 'Pricing' },
  { ord: 2, stepKind: 'event', match: 'sign up', matchMode: 'equals', label: 'Sign up' },
];

function rec(id: string, tokens: Array<[string, number]>, opts: Partial<FunnelRecording> = {}): FunnelRecording {
  return { recordingId: id, weight: 1, clicked: [], steps: tokens.map(([token, atMs]) => ({ token, atMs })), ...opts };
}

describe('reachedTimes', () => {
  it('requires the steps in ORDER', () => {
    const backwards = rec('r', [['page:/pricing', 0], ['page:/', 1_000], ['event:sign up', 2_000]]);
    expect(reachedTimes(backwards, STEPS, 30 * 60_000)).toEqual([1_000]);
  });

  it('stops at a step outside the window measured from step one', () => {
    const slow = rec('r', [['page:/', 0], ['page:/pricing/pro', 60_000], ['event:sign up', 31 * 60_000]]);
    expect(reachedTimes(slow, STEPS, 30 * 60_000)).toEqual([0, 60_000]);
  });

  it('matches case-insensitively, like markMatchesRule', () => {
    const r = rec('r', [['page:/', 0], ['page:/PRICING', 5], ['event:Sign Up', 9]]);
    expect(reachedTimes(r, STEPS, 60_000)).toEqual([0, 5, 9]);
  });

  it('satisfies a click step from the clicked set at the previous step\'s time', () => {
    const steps: FunnelStepSpec[] = [
      STEPS[0]!,
      { ord: 1, stepKind: 'click', match: 'button.buy', matchMode: 'contains', label: 'Buy' },
    ];
    expect(reachedTimes(rec('r', [['page:/', 400]], { clicked: ['main > button.buy-now'] }), steps, 60_000)).toEqual([400, 400]);
    expect(reachedTimes(rec('r', [['page:/', 400]], { clicked: ['a.nav'] }), steps, 60_000)).toEqual([400]);
  });
});

describe('evaluateFunnel', () => {
  const recordings = [
    rec('a', [['page:/', 0], ['page:/pricing', 10_000], ['event:sign up', 40_000]]),
    rec('b', [['page:/', 0], ['page:/pricing', 20_000]]),
    rec('c', [['page:/', 0], ['page:/about', 5_000]]),
    rec('d', [['page:/blog', 0]]),
  ];

  it('counts visits per step, conversion from the previous step, and median times', () => {
    const out = evaluateFunnel(recordings, STEPS, 30);
    expect(out.truncated).toBe(false);
    expect(out.steps.map((s) => s.visits)).toEqual([3, 2, 1]);
    expect(out.steps[0]).toMatchObject({ conversionFromPrevPct: null, medianTimeFromPrevMs: null });
    expect(out.steps[1]).toMatchObject({ conversionFromPrevPct: 66.7, medianTimeFromPrevMs: 15_000 });
    expect(out.steps[2]).toMatchObject({ conversionFromPrevPct: 50, medianTimeFromPrevMs: 30_000 });
  });

  it('lists who dropped at each step (reached the previous one, not this one)', () => {
    const out = evaluateFunnel(recordings, STEPS, 30);
    expect(out.steps[0]!.droppedRecordingIds).toEqual([]);
    expect(out.steps[1]!.droppedRecordingIds).toEqual(['c']);
    expect(out.steps[2]!.droppedRecordingIds).toEqual(['b']);
  });

  it('caps the drop-off sample', () => {
    const many = Array.from({ length: DROPPED_SAMPLE + 5 }, (_, i) => rec(`r${i}`, [['page:/', 0]]));
    expect(evaluateFunnel(many, STEPS, 30).steps[1]!.droppedRecordingIds).toHaveLength(DROPPED_SAMPLE);
  });

  it('weights visits by sample_weight', () => {
    const out = evaluateFunnel([rec('a', [['page:/', 0]], { weight: 4 }), rec('b', [['page:/', 0], ['page:/pricing', 1]])], STEPS, 30);
    expect(out.steps[0]!.visits).toBe(5);
    expect(out.steps[1]!.visits).toBe(1);
    expect(out.steps[1]!.conversionFromPrevPct).toBe(20);
  });

  it('folds at most maxRecordings and says it truncated', () => {
    const out = evaluateFunnel(recordings, STEPS, 30, { maxRecordings: 2 });
    expect(out.truncated).toBe(true);
    expect(out.steps[0]!.visits).toBe(2);
  });

  it('orders steps by ord whatever order they arrive in', () => {
    const out = evaluateFunnel(recordings, [...STEPS].reverse(), 30);
    expect(out.steps.map((s) => s.label)).toEqual(['Home', 'Pricing', 'Sign up']);
  });
});

describe('interpolateStepTimes', () => {
  it('spreads ordered steps across the duration', () => {
    expect(interpolateStepTimes(['page:/', 'page:/a', 'event:x'], 10_000)).toEqual([
      { token: 'page:/', atMs: 0 }, { token: 'page:/a', atMs: 5_000 }, { token: 'event:x', atMs: 10_000 },
    ]);
    expect(interpolateStepTimes(['page:/'], 10_000)).toEqual([{ token: 'page:/', atMs: 0 }]);
  });
});
