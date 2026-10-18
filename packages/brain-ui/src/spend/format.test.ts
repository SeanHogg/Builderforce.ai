import { describe, expect, it } from 'vitest';
import { formatTokens, formatUsd } from './format';

describe('formatUsd', () => {
  it('keeps the cents under $100', () => {
    expect(formatUsd(0.42, 'en-US')).toBe('$0.42');
    expect(formatUsd(12.5, 'en-US')).toBe('$12.50');
    expect(formatUsd(99.99, 'en-US')).toBe('$99.99');
  });

  it('says a sub-cent cost is not free', () => {
    expect(formatUsd(0.004, 'en-US')).toBe('<$0.01');
    expect(formatUsd(-0.004, 'en-US')).toBe('−<$0.01');
  });

  it('does not throw once the amount reaches $100 — Intl rejects minFraction > maxFraction', () => {
    // The Spent tab formats the 30-day total. The old options were
    // minimumFractionDigits: 2 with maximumFractionDigits: 0, which throws
    // RangeError ("maximumFractionDigits value is out of range") and took
    // the whole board down.
    expect(() => formatUsd(100, 'en-US')).not.toThrow();
    expect(() => formatUsd(1234.56, 'en-US')).not.toThrow();
    expect(formatUsd(100, 'en-US')).toBe('$100');
    expect(formatUsd(1234.56, 'en-US')).toBe('$1,235');
    expect(formatUsd(-1234.5, 'en-US')).toBe('-$1,235');
  });
});

describe('formatTokens', () => {
  it('compacts without throwing on a large count', () => {
    expect(formatTokens(13_100_000, 'en-US')).toBe('13.1M');
  });
});
