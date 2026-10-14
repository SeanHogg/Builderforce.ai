import { describe, expect, it } from 'vitest';
import { REPLAY_LIMITS, type ReplayMark } from '@builderforce/interaction-contract';
import { appendMarks, marksToAppend } from './visitMarks';

const mark = (kind: ReplayMark['kind'], atMs: number, key = 'k'): ReplayMark => ({ kind, key, atMs });
const CAP = REPLAY_LIMITS.maxMarksPerVisit;

describe('marksToAppend', () => {
  it('appends everything while there is room', () => {
    const marks = [mark('page', 0, '/'), mark('click', 1)];
    expect(marksToAppend(0, marks)).toEqual(marks);
  });

  it('appends nothing once the visit is full', () => {
    expect(marksToAppend(CAP, [mark('page', 0)])).toEqual([]);
    expect(marksToAppend(CAP + 10, [mark('page', 0)])).toEqual([]);
  });

  it('drops the latest plain clicks first when the chunk would overflow', () => {
    const marks = [mark('click', 1, 'early'), mark('rage', 2), mark('click', 3, 'late'), mark('error', 4)];
    const out = marksToAppend(CAP - 3, marks);
    expect(out.map((m) => m.key)).toEqual(['early', 'k', 'k']);
    expect(out.map((m) => m.kind)).toEqual(['click', 'rage', 'error']);
  });

  it('truncates to the room left when there are no clicks to drop', () => {
    const marks = [mark('page', 1), mark('rage', 2), mark('error', 3)];
    expect(marksToAppend(CAP - 2, marks).map((m) => m.kind)).toEqual(['page', 'rage']);
  });
});

describe('appendMarks', () => {
  it('returns the stored timeline ordered by time', () => {
    const out = appendMarks([mark('page', 50, '/b')], [mark('page', 10, '/a')]);
    expect(out.map((m) => m.key)).toEqual(['/a', '/b']);
  });
});
