import { describe, it, expect } from 'vitest';
import { formatMetricValue, seriesDelta, formatRecency, deltaTone } from './metricFormat';

// ---------------------------------------------------------------------------
// Pure Dashboard-library helpers — value formatting, trend-delta derivation,
// and relative recency. Guard the wiring every widget depends on.
// ---------------------------------------------------------------------------

describe('formatMetricValue', () => {
  it('applies unit suffixes', () => {
    expect(formatMetricValue(1240, 'USD')).toBe('$1,240');
    expect(formatMetricValue(92, '%')).toBe('92%');
    expect(formatMetricValue(3.2, '/day')).toBe('3.2/day');
    expect(formatMetricValue(5, 'hours')).toBe('5h');
  });

  it('renders missing values as an em dash', () => {
    expect(formatMetricValue(null)).toBe('—');
    expect(formatMetricValue(undefined)).toBe('—');
    expect(formatMetricValue(NaN)).toBe('—');
  });
});

describe('seriesDelta', () => {
  it('flags an upward trend when the recent half outweighs the earlier half', () => {
    const d = seriesDelta([1, 1, 5, 5]);
    expect(d?.direction).toBe('up');
    expect(d?.pct).toBe(400);
  });

  it('flags a downward trend', () => {
    expect(seriesDelta([5, 5, 1, 1])?.direction).toBe('down');
  });

  it('returns null without enough signal', () => {
    expect(seriesDelta([1, 2])).toBeNull();
    expect(seriesDelta([0, 0, 0, 0])).toBeNull();
  });
});

describe('deltaTone', () => {
  it('colours by polarity: rising matches goodWhenUp → good, else bad', () => {
    expect(deltaTone('up', true)).toBe('good'); // merge rate up = good
    expect(deltaTone('down', true)).toBe('bad'); // merge rate down = bad
    expect(deltaTone('up', false)).toBe('bad'); // errors up = bad
    expect(deltaTone('down', false)).toBe('good'); // errors down = good
  });

  it('is neutral for flat trends or metrics with no polarity', () => {
    expect(deltaTone('flat', true)).toBe('neutral');
    expect(deltaTone('up', null)).toBe('neutral');
    expect(deltaTone('down', undefined)).toBe('neutral');
  });
});

describe('formatRecency', () => {
  const t = (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${values.n}` : key;
  const now = 1_000_000_000_000;

  it('buckets by minutes / hours / days via the translator', () => {
    expect(formatRecency(now - 30_000, t, now)).toBe('recency.justNow');
    expect(formatRecency(now - 5 * 60_000, t, now)).toBe('recency.minutesAgo:5');
    expect(formatRecency(now - 3 * 3_600_000, t, now)).toBe('recency.hoursAgo:3');
    expect(formatRecency(now - 2 * 86_400_000, t, now)).toBe('recency.daysAgo:2');
  });

  it('returns null for missing/invalid input', () => {
    expect(formatRecency(null, t, now)).toBeNull();
    expect(formatRecency('not-a-date', t, now)).toBeNull();
  });
});
