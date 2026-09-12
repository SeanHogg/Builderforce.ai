import { describe, expect, it } from 'vitest';
import { formatElapsedBetween } from './duration';

describe('formatElapsedBetween', () => {
  it('is null while the span is still open', () => {
    expect(formatElapsedBetween('2026-09-12T10:00:00Z', null)).toBeNull();
    expect(formatElapsedBetween('2026-09-12T10:00:00Z', undefined)).toBeNull();
  });

  it('reads a closed span at the scale formatDuration uses', () => {
    expect(formatElapsedBetween('2026-09-12T10:00:00Z', '2026-09-12T10:00:45Z')).toBe('45s');
    expect(formatElapsedBetween('2026-09-12T10:00:00Z', '2026-09-12T10:01:23Z')).toBe('1m 23s');
    expect(formatElapsedBetween('2026-09-12T10:00:00Z', '2026-09-12T11:04:00Z')).toBe('1h 04m');
  });

  it('clamps an end before its start to zero', () => {
    expect(formatElapsedBetween('2026-09-12T10:00:10Z', '2026-09-12T10:00:00Z')).toBe('0s');
  });
});
