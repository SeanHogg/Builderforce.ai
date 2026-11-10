import { describe, expect, it } from 'vitest';
import { rotatingWindow, sweepPassOf } from './runOutcomeLabelSweep';

describe('rotatingWindow — the tenant cap never starves a tenant', () => {
  const ids = Array.from({ length: 450 }, (_, i) => i + 1);

  it('returns everything when the list fits the cap', () => {
    expect(rotatingWindow([3, 1, 2], 200, 17)).toEqual([3, 1, 2]);
  });

  it('advances by the cap each pass and wraps', () => {
    expect(rotatingWindow(ids, 200, 0)[0]).toBe(1);
    expect(rotatingWindow(ids, 200, 1)[0]).toBe(201);
    const third = rotatingWindow(ids, 200, 2);
    expect(third[0]).toBe(401);
    expect(third).toHaveLength(200);
    expect(third[50]).toBe(1); // wrapped past 450
  });

  it('covers every id within ceil(n / cap) consecutive passes, from any starting pass', () => {
    for (const start of [0, 7, 20_000]) {
      const seen = new Set<number>();
      for (let p = start; p < start + Math.ceil(ids.length / 200); p += 1) for (const id of rotatingWindow(ids, 200, p)) seen.add(id);
      expect(seen.size).toBe(ids.length);
    }
  });

  it('the pass advances once per UTC day', () => {
    const a = sweepPassOf(new Date('2026-10-18T00:00:00Z'));
    expect(sweepPassOf(new Date('2026-10-18T23:59:59Z'))).toBe(a);
    expect(sweepPassOf(new Date('2026-10-19T00:00:00Z'))).toBe(a + 1);
  });
});
