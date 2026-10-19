import { describe, expect, it } from 'vitest';
import { admitClientTime } from './clientTimeAdmission';
import { MAX_FUTURE_CLOCK_SKEW_MS, occurredAtError } from './occurredAtGate';

/**
 * G25 admission. `admitClientTime(event, now)` calls `occurredAtError` with the
 * injected clock. An accepted event keeps its original `occurredAt`, including
 * a timestamp years in the past. A refusal is the error code only — no server
 * timestamp is invented and nothing is inserted. `now` is never `Date.now()`.
 */
const NOW = new Date('2026-10-18T12:00:00.000Z');

function atOffset(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString();
}

describe('admitClientTime', () => {
  it('keeps a timestamp years in the past and does not invent a server time', () => {
    const event = { eventId: 'hist', occurredAt: '2001-01-01T00:00:00.000Z' };
    const admitted = admitClientTime(event, NOW);
    expect(occurredAtError(event.occurredAt, NOW)).toBeNull();
    expect(admitted).toEqual({ ok: true, event });
    expect(admitted.ok && admitted.event).toBe(event);
    expect(admitted.ok && admitted.event.occurredAt).toBe('2001-01-01T00:00:00.000Z');
    expect(admitted).not.toHaveProperty('receivedAt');
    expect(event).not.toHaveProperty('receivedAt');
    expect(admitted).not.toHaveProperty('inserted');
  });

  it('keeps a timestamp inside the future skew window', () => {
    const event = { eventId: 'skew', occurredAt: atOffset(MAX_FUTURE_CLOCK_SKEW_MS) };
    const admitted = admitClientTime(event, NOW);
    expect(occurredAtError(event.occurredAt, NOW)).toBeNull();
    expect(admitted).toEqual({ ok: true, event });
    expect(admitted.ok && admitted.event.occurredAt).toBe(event.occurredAt);
    expect(admitted.ok && admitted.event.occurredAt).not.toBe(NOW.toISOString());
  });

  it('refuses a timestamp beyond the skew window with the occurredAtError code', () => {
    const event = { eventId: 'future', occurredAt: atOffset(MAX_FUTURE_CLOCK_SKEW_MS + 1) };
    const admitted = admitClientTime(event, NOW);
    expect(occurredAtError(event.occurredAt, NOW)).toBe('occurred_at_in_future');
    expect(admitted).toEqual({ ok: false, code: 'occurred_at_in_future' });
    expect(admitted).not.toHaveProperty('receivedAt');
    expect(admitted).not.toHaveProperty('event');
    expect(admitted).not.toHaveProperty('inserted');
    expect(JSON.stringify(admitted)).not.toContain(NOW.toISOString());
  });

  it('refuses an unparseable string with the occurredAtError code', () => {
    const event = { eventId: 'bad', occurredAt: 'not-a-timestamp' };
    const admitted = admitClientTime(event, NOW);
    expect(occurredAtError(event.occurredAt, NOW)).toBe('occurred_at_invalid');
    expect(admitted).toEqual({ ok: false, code: 'occurred_at_invalid' });
    expect(admitted).not.toHaveProperty('receivedAt');
    expect(admitted).not.toHaveProperty('event');
    expect(admitted).not.toHaveProperty('inserted');
  });
});
