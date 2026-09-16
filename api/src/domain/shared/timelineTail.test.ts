import { describe, expect, it } from 'vitest';
import { readTimelineTail } from './timelineTail';

/** A descending-ordered store, the way the callers' `ORDER BY seq DESC` reads it. */
function store(size: number) {
  const rows = Array.from({ length: size }, (_, i) => ({ seq: i + 1 }));
  const newestFirst = [...rows].reverse();
  return {
    rows,
    take: async (n: number) => newestFirst.slice(0, n),
  };
}

describe('readTimelineTail', () => {
  it('returns the NEWEST rows, oldest-first — the defect this exists to stop', () => {
    const { take } = store(250);
    return readTimelineTail(take, 100, 500).then((got) => {
      expect(got).toHaveLength(100);
      // The head-truncating version returned seq 1..100 and lost the last reply.
      expect(got[0]).toEqual({ seq: 151 });
      expect(got[got.length - 1]).toEqual({ seq: 250 });
    });
  });

  it('keeps the whole transcript when it is shorter than the window', async () => {
    const { rows, take } = store(12);
    expect(await readTimelineTail(take, 100, 500)).toEqual(rows);
  });

  it('is empty for an empty timeline', async () => {
    expect(await readTimelineTail(store(0).take, 100, 500)).toEqual([]);
  });

  it('clamps an untrusted limit to max so no caller can read the table', async () => {
    const seen: number[] = [];
    const probe = async (n: number) => { seen.push(n); return []; };
    await readTimelineTail(probe, 10_000, 500);
    await readTimelineTail(probe, 0, 500);
    await readTimelineTail(probe, -5, 500);
    expect(seen).toEqual([500, 1, 1]);
  });

  it('falls back to max when the limit is not a number', async () => {
    const seen: number[] = [];
    const probe = async (n: number) => { seen.push(n); return []; };
    await readTimelineTail(probe, Number.NaN, 500);
    expect(seen).toEqual([500]);
  });
});
