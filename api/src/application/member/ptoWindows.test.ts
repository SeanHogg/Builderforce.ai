import { describe, it, expect } from 'vitest';
import { parsePtoBlocks, isOnPtoAt, findPtoAt } from './ptoWindows';
import { derivePto } from '../integrations/googleCalendarSync';

/**
 * `member_profiles.pto` has been write-only since 0116 and was never validated at the
 * route boundary, so these tests are as much about what the column is ALLOWED to contain
 * as about the happy path. The failure mode that matters throughout: a window that fails
 * to parse reads as "this person is never on leave", which is the reading that lets their
 * work be reassigned while they are away.
 */

const at = (iso: string) => new Date(iso);

describe('parsePtoBlocks — tolerating an unvalidated jsonb column', () => {
  it('parses the intended shape', () => {
    expect(parsePtoBlocks([{ from: '2026-08-10', to: '2026-08-12', reason: 'Vacation' }]))
      .toEqual([{ from: '2026-08-10', to: '2026-08-12', reason: 'Vacation' }]);
  });

  it('accepts a double-encoded JSON string', () => {
    // The column is jsonb, but nothing stopped a client sending a string.
    expect(parsePtoBlocks('[{"from":"2026-08-10","to":"2026-08-12","reason":"PTO"}]')).toHaveLength(1);
  });

  it('returns [] for every non-array shape the column could legally hold', () => {
    for (const v of [null, undefined, 0, 42, true, {}, { from: 'x' }, 'not json', '"a string"']) {
      expect(parsePtoBlocks(v)).toEqual([]);
    }
  });

  it('drops entries missing either end rather than inventing one', () => {
    expect(parsePtoBlocks([
      { from: '2026-08-10', reason: 'no end' },
      { to: '2026-08-12', reason: 'no start' },
      { from: '', to: '2026-08-12', reason: 'blank start' },
      { from: 2026, to: 2027, reason: 'numbers' },
      { from: '2026-08-10', to: '2026-08-12', reason: 'good' },
    ])).toEqual([{ from: '2026-08-10', to: '2026-08-12', reason: 'good' }]);
  });

  it('defaults a missing reason instead of dropping a real window', () => {
    expect(parsePtoBlocks([{ from: '2026-08-10', to: '2026-08-12' }])[0]?.reason).toBe('Out of office');
  });
});

describe('isOnPtoAt — all-day windows use Google’s EXCLUSIVE end date', () => {
  // {from:'2026-08-10', to:'2026-08-12'} means out the 10th and 11th, back on the 12th.
  const leave = parsePtoBlocks([{ from: '2026-08-10', to: '2026-08-12', reason: 'Vacation' }]);

  it('covers the first day', () => {
    expect(isOnPtoAt(leave, at('2026-08-10T00:00:00Z'))).toBe(true);
    expect(isOnPtoAt(leave, at('2026-08-10T09:30:00Z'))).toBe(true);
  });

  it('covers the last full day', () => {
    expect(isOnPtoAt(leave, at('2026-08-11T23:59:00Z'))).toBe(true);
  });

  it('does NOT cover the exclusive end date — they are back at work', () => {
    // The bug this pins: an inclusive read would excuse someone from a standup they
    // were expected at, and silently protect stale work for an extra day.
    expect(isOnPtoAt(leave, at('2026-08-12T00:00:00Z'))).toBe(false);
    expect(isOnPtoAt(leave, at('2026-08-12T09:00:00Z'))).toBe(false);
  });

  it('does not cover the day before', () => {
    expect(isOnPtoAt(leave, at('2026-08-09T23:59:00Z'))).toBe(false);
  });

  it('reads an equal-ended all-day pair as one whole day, not zero', () => {
    // Written inclusively by a non-Google writer. Zero-length would mean "never on
    // leave" — the exact misreading this module exists to avoid.
    const oneDay = parsePtoBlocks([{ from: '2026-08-10', to: '2026-08-10', reason: 'Day off' }]);
    expect(isOnPtoAt(oneDay, at('2026-08-10T12:00:00Z'))).toBe(true);
    expect(isOnPtoAt(oneDay, at('2026-08-11T00:00:00Z'))).toBe(false);
  });
});

describe('isOnPtoAt — timed windows are literal instants', () => {
  const halfDay = parsePtoBlocks([
    { from: '2026-08-10T09:00:00Z', to: '2026-08-10T13:00:00Z', reason: 'Appointment' },
  ]);

  it('covers inside the window and excludes the end instant', () => {
    expect(isOnPtoAt(halfDay, at('2026-08-10T08:59:00Z'))).toBe(false);
    expect(isOnPtoAt(halfDay, at('2026-08-10T09:00:00Z'))).toBe(true);
    expect(isOnPtoAt(halfDay, at('2026-08-10T12:59:00Z'))).toBe(true);
    expect(isOnPtoAt(halfDay, at('2026-08-10T13:00:00Z'))).toBe(false);
  });

  it('handles date-only and timed blocks coexisting in one array', () => {
    // Exactly what the calendar sync produces: it copies Google's fields straight through.
    const mixed = parsePtoBlocks([
      { from: '2026-08-10', to: '2026-08-12', reason: 'Vacation' },
      { from: '2026-09-01T09:00:00Z', to: '2026-09-01T17:00:00Z', reason: 'Offsite' },
    ]);
    expect(isOnPtoAt(mixed, at('2026-08-11T10:00:00Z'))).toBe(true);
    expect(isOnPtoAt(mixed, at('2026-09-01T10:00:00Z'))).toBe(true);
    expect(isOnPtoAt(mixed, at('2026-09-02T10:00:00Z'))).toBe(false);
  });
});

describe('isOnPtoAt — degenerate windows never excuse anyone', () => {
  it('ignores an inverted window', () => {
    expect(isOnPtoAt(parsePtoBlocks([{ from: '2026-08-12', to: '2026-08-10', reason: 'x' }]), at('2026-08-11T10:00:00Z')))
      .toBe(false);
  });

  it('ignores an unparseable date', () => {
    expect(isOnPtoAt(parsePtoBlocks([{ from: 'yesterday', to: 'tomorrow', reason: 'x' }]), at('2026-08-11T10:00:00Z')))
      .toBe(false);
  });

  it('ignores a zero-length timed window', () => {
    expect(isOnPtoAt(
      parsePtoBlocks([{ from: '2026-08-10T09:00:00Z', to: '2026-08-10T09:00:00Z', reason: 'x' }]),
      at('2026-08-10T09:00:00Z'),
    )).toBe(false);
  });

  it('is false for an empty list and an invalid instant', () => {
    expect(isOnPtoAt([], at('2026-08-10T09:00:00Z'))).toBe(false);
    expect(isOnPtoAt(parsePtoBlocks([{ from: '2026-08-10', to: '2026-08-12', reason: 'x' }]), new Date('nope'))).toBe(false);
  });
});

describe('findPtoAt', () => {
  it('returns the covering window so the reason can be shown', () => {
    const blocks = parsePtoBlocks([{ from: '2026-08-10', to: '2026-08-12', reason: 'Parental leave' }]);
    expect(findPtoAt(blocks, at('2026-08-11T10:00:00Z'))?.reason).toBe('Parental leave');
    expect(findPtoAt(blocks, at('2026-08-20T10:00:00Z'))).toBeNull();
  });
});

describe('round-trip with what the Google sync actually writes', () => {
  it('an all-day OOO event parses back to the days the person was away', () => {
    // derivePto copies Google's exclusive end date through verbatim; this is the
    // end-to-end proof that the reader and the writer agree about that.
    const blocks = parsePtoBlocks(derivePto([{
      summary: 'Vacation',
      eventType: 'outOfOffice',
      start: { date: '2026-08-10' },
      end: { date: '2026-08-12' },
    }]));
    expect(blocks).toHaveLength(1);
    expect(isOnPtoAt(blocks, at('2026-08-10T12:00:00Z'))).toBe(true);
    expect(isOnPtoAt(blocks, at('2026-08-11T12:00:00Z'))).toBe(true);
    expect(isOnPtoAt(blocks, at('2026-08-12T12:00:00Z'))).toBe(false);
  });
});
