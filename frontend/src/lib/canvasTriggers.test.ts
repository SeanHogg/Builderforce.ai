import { describe, expect, it } from 'vitest';
import { evaluateTrigger, numericValue } from './canvasTriggers';

describe('numericValue', () => {
  it('reads a plain number', () => {
    expect(numericValue(14)).toBe(14);
    expect(numericValue(-3.5)).toBe(-3.5);
  });

  it('reads a formatted string', () => {
    expect(numericValue('14 months')).toBe(14);
    expect(numericValue('1200.50')).toBe(1200.5);
  });

  /**
   * A thousands separator is NOT a decimal point. Read as one, "$1,200" becomes 1.2 and
   * a $1,200 burn compared against a $1,000 ceiling reports healthy by a factor of a
   * thousand — the single most dangerous way this function can be wrong.
   */
  it('distinguishes a thousands separator from a decimal comma', () => {
    expect(numericValue('$1,200')).toBe(1200);
    expect(numericValue('1,200,000')).toBe(1_200_000);
    expect(numericValue('1,200,000.50')).toBe(1_200_000.5);
    expect(numericValue('1200,50')).toBe(1200.5);
  });

  /**
   * THE BUG THIS PAIR PINS. "months" starts with an 'm', and a suffix check that
   * accepted any word beginning with one turned a 14-month runway into 14,000,000 —
   * so a "runway below 6 months" trigger compared 4.5 million against 6 and stayed
   * silent. A trigger that cannot fire is worse than no trigger.
   */
  it('does not read a unit word as a magnitude suffix', () => {
    expect(numericValue('14 months')).toBe(14);
    expect(numericValue('4.5 months')).toBe(4.5);
    expect(numericValue('30 minutes')).toBe(30);
    expect(numericValue('12 basis points')).toBe(12);
  });

  it('accepts bare and written magnitudes', () => {
    expect(numericValue('1.2M')).toBe(1_200_000);
    expect(numericValue('1.2 million')).toBe(1_200_000);
    expect(numericValue('450k')).toBe(450_000);
    expect(numericValue('2 bn')).toBe(2_000_000_000);
  });

  /**
   * A suffix MULTIPLIES. Without this, "$1.2M" parses as 1.2 and a threshold of
   * 1_000_000 reports healthy burn on a company that is on fire.
   */
  it('applies magnitude suffixes', () => {
    expect(numericValue('1.2M')).toBe(1_200_000);
    expect(numericValue('$450K')).toBe(450_000);
    expect(numericValue('2.5B')).toBe(2_500_000_000);
  });

  it('returns null for anything unparseable, rather than NaN', () => {
    expect(numericValue('not disclosed')).toBeNull();
    expect(numericValue('')).toBeNull();
    expect(numericValue(null)).toBeNull();
    expect(numericValue(undefined)).toBeNull();
    expect(numericValue(Number.NaN)).toBeNull();
  });
});

describe('evaluateTrigger', () => {
  const bound = { metricFound: true, metricValue: 5, threshold: 6 };

  it('breaches when a value falls below its threshold', () => {
    expect(evaluateTrigger({ ...bound, comparator: 'below' })).toMatchObject({ state: 'breached', observed: 5, reason: 'breached' });
  });

  it('stays armed when the value is within the threshold', () => {
    expect(evaluateTrigger({ ...bound, comparator: 'above' })).toMatchObject({ state: 'armed', reason: 'within-threshold' });
  });

  it('handles above and equals', () => {
    expect(evaluateTrigger({ metricFound: true, metricValue: 12, threshold: 10, comparator: 'above' }).state).toBe('breached');
    expect(evaluateTrigger({ metricFound: true, metricValue: 10, threshold: 10, comparator: 'equals' }).state).toBe('breached');
    expect(evaluateTrigger({ metricFound: true, metricValue: 11, threshold: 10, comparator: 'equals' }).state).toBe('armed');
  });

  it('defaults an unknown comparator to below rather than silently passing', () => {
    expect(evaluateTrigger({ ...bound, comparator: 'sideways' }).state).toBe('breached');
  });

  describe('changes-by', () => {
    it('breaches on a move at or beyond the threshold, in either direction', () => {
      expect(evaluateTrigger({ metricFound: true, metricValue: 10, previousValue: 7, threshold: 3, comparator: 'changes-by' }).state).toBe('breached');
      expect(evaluateTrigger({ metricFound: true, metricValue: 4, previousValue: 7, threshold: 3, comparator: 'changes-by' }).state).toBe('breached');
    });

    it('stays armed on a smaller move', () => {
      expect(evaluateTrigger({ metricFound: true, metricValue: 8, previousValue: 7, threshold: 3, comparator: 'changes-by' }).state).toBe('armed');
    });

    it('cannot breach without a previous observation, and says so', () => {
      expect(evaluateTrigger({ metricFound: true, metricValue: 10, threshold: 3, comparator: 'changes-by' }))
        .toMatchObject({ state: 'armed', reason: 'no-previous-value' });
    });
  });

  /**
   * The three unbound states. Each one is reported distinctly because "armed" over an
   * unevaluated threshold is the failure the tool exists to prevent — a founder told
   * "all clear" about a number nothing actually checked.
   */
  describe('unbound', () => {
    it('reports a missing metric', () => {
      expect(evaluateTrigger({ metricFound: false, threshold: 6, comparator: 'below' }))
        .toMatchObject({ state: 'unbound', reason: 'no-metric', observed: null });
    });

    it('reports a metric that has no value yet', () => {
      expect(evaluateTrigger({ metricFound: true, metricValue: 'not disclosed', threshold: 6, comparator: 'below' }))
        .toMatchObject({ state: 'unbound', reason: 'metric-has-no-value' });
    });

    it('reports a trigger with no threshold', () => {
      expect(evaluateTrigger({ metricFound: true, metricValue: 5, comparator: 'below' }))
        .toMatchObject({ state: 'unbound', reason: 'no-threshold', observed: 5 });
    });
  });

  it('respects a muted trigger before anything else', () => {
    expect(evaluateTrigger({ ...bound, comparator: 'below', state: 'muted' }))
      .toMatchObject({ state: 'muted', reason: 'muted' });
  });

  it('compares formatted values on the same scale', () => {
    // Runway written "4.5 months" against a threshold of 6.
    expect(evaluateTrigger({ metricFound: true, metricValue: '4.5 months', threshold: '6', comparator: 'below' }).state).toBe('breached');
    // Burn written "$1.2M" against a $1M ceiling — the suffix case that matters.
    expect(evaluateTrigger({ metricFound: true, metricValue: '$1.2M', threshold: '1000000', comparator: 'above' }).state).toBe('breached');
  });
});
