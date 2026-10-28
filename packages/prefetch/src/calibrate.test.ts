import { describe, expect, it } from 'vitest';
import {
  COLD_START,
  deserializeCalibration,
  emptyCalibration,
  headOf,
  predict,
  serializeCalibration,
  thresholdOf,
  updateHead,
} from './calibrate';
import { isReask } from './lexical';
import type { CalibrationState, GateOutcome } from './types';

const outcome = (over: Partial<GateOutcome> = {}): GateOutcome => ({
  actionId: 'dup.check',
  route: 'answer',
  p: 0.7,
  tier: 2,
  accepted: true,
  features: [0.6, 0.5, 0.6],
  ...over,
});

const fold = (state: CalibrationState, outcomes: GateOutcome[]) => outcomes.reduce(updateHead, state);

describe('calibration', () => {
  it('starts at the conservative cold floors', () => {
    expect(thresholdOf(emptyCalibration(), 'dup.check')).toEqual({ answer: COLD_START.answer, prefetch: COLD_START.prefetch, n: 0 });
  });

  it('never drops below the cold floor before 30 outcomes, then moves down on accepted evidence', () => {
    const few = fold(emptyCalibration(), Array.from({ length: 10 }, () => outcome()));
    expect(thresholdOf(few, 'dup.check').answer).toBe(COLD_START.answer);
    const many = fold(emptyCalibration(), Array.from({ length: 40 }, () => outcome()));
    expect(thresholdOf(many, 'dup.check').answer).toBeCloseTo(0.7);
    expect(thresholdOf(many, 'dup.check').n).toBe(40);
  });

  it('moves up when answers above the floor are rejected', () => {
    const rejected = fold(emptyCalibration(), Array.from({ length: 10 }, () => outcome({ p: 0.95, accepted: false })));
    expect(thresholdOf(rejected, 'dup.check').answer).toBeGreaterThan(COLD_START.answer);
  });

  it('learns the head online: accepted outcomes raise p for the same features', () => {
    const features = [0.6, 0.5, 0.6];
    const before = predict(headOf(emptyCalibration(), 'dup.check'), features);
    const after = fold(emptyCalibration(), Array.from({ length: 20 }, () => outcome({ features })));
    expect(predict(headOf(after, 'dup.check'), features)).toBeGreaterThan(before);
  });

  it('does not log a tier-1 outcome toward the threshold', () => {
    const s = fold(emptyCalibration(), Array.from({ length: 40 }, () => outcome({ tier: 1, p: 1 })));
    expect(thresholdOf(s, 'dup.check').n).toBe(0);
  });

  it('round-trips through serialize / deserialize, and a bad value is a cold start', () => {
    const s = fold(emptyCalibration(), Array.from({ length: 35 }, () => outcome()));
    const back = deserializeCalibration(serializeCalibration(s));
    expect(back.heads).toEqual(s.heads);
    expect(back.thresholds).toEqual(s.thresholds);
    expect(deserializeCalibration('not json')).toEqual(emptyCalibration());
    expect(deserializeCalibration({ v: 99 })).toEqual(emptyCalibration());
  });
});

describe('isReask', () => {
  it('reads the same ask again as a re-ask, a new ask as acceptance', () => {
    expect(isReask('where is fooBar defined?', 'where is fooBar defined')).toBe(true);
    expect(isReask('where is fooBar defined?', 'now rename it to bazQux')).toBe(false);
  });
});
