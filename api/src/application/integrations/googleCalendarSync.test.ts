import { describe, expect, it } from 'vitest';
import { deriveAvailability, derivePto, type BusyBlock, type CalEvent } from './googleCalendarSync';

/** Pure Calendar→profile mapping (no network): busy→availability, events→PTO. */

describe('deriveAvailability', () => {
  const now = new Date('2026-06-13T12:00:00Z');
  it('is busy until the end of the block currently covering now', () => {
    const busy: BusyBlock[] = [{ start: '2026-06-13T11:30:00Z', end: '2026-06-13T13:00:00Z' }];
    expect(deriveAvailability(now, busy)).toEqual({ availabilityStatus: 'busy', availabilityUntil: '2026-06-13T13:00:00.000Z' });
  });
  it('is available when no block covers now', () => {
    const busy: BusyBlock[] = [{ start: '2026-06-13T14:00:00Z', end: '2026-06-13T15:00:00Z' }];
    expect(deriveAvailability(now, busy)).toEqual({ availabilityStatus: 'available', availabilityUntil: null });
  });
  it('available on empty calendar', () => {
    expect(deriveAvailability(now, []).availabilityStatus).toBe('available');
  });
});

describe('derivePto', () => {
  it('picks up Google outOfOffice events and leave-titled all-day events', () => {
    const events: CalEvent[] = [
      { eventType: 'outOfOffice', start: { dateTime: '2026-07-01T00:00:00Z' }, end: { dateTime: '2026-07-05T00:00:00Z' }, summary: 'OOO' },
      { start: { date: '2026-08-10' }, end: { date: '2026-08-12' }, summary: 'Vacation' },
      { start: { dateTime: '2026-06-20T10:00:00Z' }, end: { dateTime: '2026-06-20T11:00:00Z' }, summary: 'Team sync' }, // not PTO
      { start: { date: '2026-09-01' }, end: { date: '2026-09-02' }, summary: 'Lunch' }, // all-day but not leave
    ];
    const pto = derivePto(events);
    expect(pto).toHaveLength(2);
    expect(pto[0]!.reason).toBe('OOO');
    expect(pto[1]).toEqual({ from: '2026-08-10', to: '2026-08-12', reason: 'Vacation' });
  });
  it('returns empty for no PTO', () => {
    expect(derivePto([{ start: { dateTime: 'x' }, end: { dateTime: 'y' }, summary: 'Standup' }])).toEqual([]);
  });
});
