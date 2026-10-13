import { describe, expect, it } from 'vitest';
import {
  nonConvertingFilter,
  parseProofMeasure,
  proofStatus,
  proofValue,
  thresholdMet,
  type ProofMeasure,
} from './proofMeasure';

const SMOKE: ProofMeasure = {
  sample: { filter: { all: [{ field: 'tag', op: 'neq', value: 'source=direct' }] }, min: 500 },
  success: { kind: 'smartEvent', ref: 'sign up' },
  threshold: { op: '>=', value: 25, unit: 'count' },
  windowDays: 14,
};

describe('parseProofMeasure', () => {
  it('accepts a well-formed measure and returns it normalised', () => {
    expect(parseProofMeasure(JSON.parse(JSON.stringify(SMOKE)))).toEqual(SMOKE);
  });

  it('trims the success ref', () => {
    expect(parseProofMeasure({ ...SMOKE, success: { kind: 'smartEvent', ref: '  sign up ' } })?.success.ref).toBe('sign up');
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['no sample', { ...SMOKE, sample: undefined }],
    ['a sample min of zero', { ...SMOKE, sample: { ...SMOKE.sample, min: 0 } }],
    ['a fractional sample min', { ...SMOKE, sample: { ...SMOKE.sample, min: 1.5 } }],
    ['an invalid filter', { ...SMOKE, sample: { filter: { all: [{ field: 'nope', op: 'eq', value: 1 }] }, min: 10 } }],
    ['an unknown success kind', { ...SMOKE, success: { kind: 'pageview', ref: '/' } }],
    ['an empty ref', { ...SMOKE, success: { kind: 'smartEvent', ref: '   ' } }],
    ['an unknown op', { ...SMOKE, threshold: { ...SMOKE.threshold, op: '>' } }],
    ['a negative threshold', { ...SMOKE, threshold: { ...SMOKE.threshold, value: -1 } }],
    ['a rate above one', { ...SMOKE, threshold: { op: '>=', value: 1.5, unit: 'rate' } }],
    ['a zero window', { ...SMOKE, windowDays: 0 }],
    ['a window over a year', { ...SMOKE, windowDays: 400 }],
  ])('refuses %s', (_label, raw) => {
    expect(parseProofMeasure(raw)).toBeNull();
  });
});

describe('proofValue / thresholdMet', () => {
  it('reads a count as the successes and a rate as successes over the sample', () => {
    expect(proofValue(1000, 31, 'count')).toBe(31);
    expect(proofValue(1000, 31, 'rate')).toBeCloseTo(0.031);
    expect(proofValue(0, 0, 'rate')).toBe(0);
  });

  it('compares a floor and a ceiling', () => {
    expect(thresholdMet(25, { op: '>=', value: 25 })).toBe(true);
    expect(thresholdMet(24, { op: '>=', value: 25 })).toBe(false);
    expect(thresholdMet(0.1, { op: '<=', value: 0.2 })).toBe(true);
  });
});

describe('proofStatus', () => {
  const end = new Date('2026-10-20T00:00:00Z');
  const before = new Date('2026-10-19T00:00:00Z');
  const after = new Date('2026-10-21T00:00:00Z');
  const threshold = { op: '>=' as const, value: 40, unit: 'count' as const };

  it('1,000 sampled / 31 signups / threshold 40: collecting before the window ends, missed after', () => {
    const input = { sampleReached: true, value: 31, threshold, windowEndsAt: end };
    expect(proofStatus(input, before)).toBe('collecting');
    expect(proofStatus(input, after)).toBe('missed');
  });

  it('30 visits / 40 signups is never met — the sample was never reached', () => {
    const input = { sampleReached: false, value: 40, threshold, windowEndsAt: end };
    expect(proofStatus(input, before)).toBe('collecting');
    expect(proofStatus(input, after)).toBe('missed');
  });

  it('a count floor cleared on a full sample is met before the window ends', () => {
    expect(proofStatus({ sampleReached: true, value: 41, threshold, windowEndsAt: end }, before)).toBe('met');
  });

  it('a rate is never decided before the window ends', () => {
    const rate = { op: '>=' as const, value: 0.05, unit: 'rate' as const };
    expect(proofStatus({ sampleReached: true, value: 0.2, threshold: rate, windowEndsAt: end }, before)).toBe('collecting');
    expect(proofStatus({ sampleReached: true, value: 0.2, threshold: rate, windowEndsAt: end }, after)).toBe('met');
  });

  it('has no window before the first sampled visit', () => {
    expect(proofStatus({ sampleReached: false, value: 0, threshold, windowEndsAt: null }, after)).toBe('collecting');
  });
});

describe('nonConvertingFilter', () => {
  it('is the sample minus the success smart event', () => {
    expect(nonConvertingFilter(SMOKE)).toEqual({
      all: [
        { field: 'tag', op: 'neq', value: 'source=direct' },
        { field: 'smartEvent', op: 'neq', value: 'sign up' },
      ],
    });
  });

  it('is the sample itself for a funnel success', () => {
    const funnel: ProofMeasure = { ...SMOKE, success: { kind: 'funnel', ref: 'f-1' } };
    expect(nonConvertingFilter(funnel)).toEqual(SMOKE.sample.filter);
  });
});
