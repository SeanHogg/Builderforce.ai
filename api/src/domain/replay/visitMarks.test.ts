import { describe, expect, it } from 'vitest';
import { REPLAY_LIMITS, type ReplayMark } from '@builderforce/interaction-contract';
import { marksToInsert } from './visitMarks';

function mark(kind: string, atMs: number): ReplayMark {
  return { kind, key: `${kind}-${atMs}`, atMs };
}

describe('marksToInsert', () => {
  it('assigns ord after the existing count', () => {
    const inserted = marksToInsert(4, {
      visitId: 'v1',
      seq: 0,
      events: [],
      marks: [mark('page', 0), mark('click', 10)],
    });
    expect(inserted.map((m) => m.ord)).toEqual([4, 5]);
    expect(inserted[0]?.kind).toBe('page');
  });

  it('inserts nothing once the visit is at the cap', () => {
    expect(
      marksToInsert(REPLAY_LIMITS.maxMarksPerVisit, {
        visitId: 'v1',
        seq: 0,
        events: [],
        marks: [mark('error', 1)],
      }),
    ).toEqual([]);
  });

  it('drops plain clicks first when the incoming batch would overflow', () => {
    const room = 3;
    const existing = REPLAY_LIMITS.maxMarksPerVisit - room;
    const inserted = marksToInsert(existing, {
      visitId: 'v1',
      seq: 0,
      events: [],
      marks: [
        mark('click', 1),
        mark('page', 2),
        mark('click', 3),
        mark('error', 4),
        mark('click', 5),
        mark('rage', 6),
      ],
    });
    expect(inserted.map((m) => m.kind)).toEqual(['page', 'error', 'rage']);
    expect(inserted.map((m) => m.ord)).toEqual([existing, existing + 1, existing + 2]);
  });

  it('still trims protected marks from the end if they alone exceed the room', () => {
    const existing = REPLAY_LIMITS.maxMarksPerVisit - 1;
    const inserted = marksToInsert(existing, {
      visitId: 'v1',
      seq: 0,
      events: [],
      marks: [mark('page', 1), mark('error', 2)],
    });
    expect(inserted.map((m) => m.kind)).toEqual(['page']);
  });

  it('returns [] when the chunk has no marks', () => {
    expect(marksToInsert(0, { visitId: 'v1', seq: 0, events: [{ t: 0, kind: 'click' }] })).toEqual([]);
  });
});
