import { describe, expect, it } from 'vitest';
import {
  MAX_FUTURE_CLOCK_SKEW_MS,
  occurredAtError,
  occurredAtGate,
} from './occurredAtGate';

/**
 * G25 pre-insert gate. `occurredAtGate(occurredAt, now)` calls `occurredAtError`
 * with an injected clock, never `Date.now()`. An invalid or too-future client
 * time is a refusal and nothing else — no row, no id, no insert. A historical
 * past timestamp is allowed and kept unchanged.
 */
const NOW = new Date('2026-10-18T12:00:00.000Z');

function atOffset(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString();
}

describe('occurredAtGate', () => {
  it('refuses an invalid occurredAt before any insert', () => {
    for (const occurredAt of ['not-a-timestamp', '', '2026-13-40T99:99:99.000Z']) {
      const decision = occurredAtGate(occurredAt, NOW);
      expect(occurredAtError(occurredAt, NOW)).toBe('occurred_at_invalid');
      expect(decision).toEqual({ refused: true, code: 'occurred_at_invalid' });
      expect(decision).not.toHaveProperty('inserted');
      expect(decision).not.toHaveProperty('id');
      expect(decision).not.toHaveProperty('row');
      expect(Object.keys(decision).sort()).toEqual(['code', 'refused']);
    }
  });

  it('refuses a future occurredAt beyond the existing 15-minute window', () => {
    expect(MAX_FUTURE_CLOCK_SKEW_MS).toBe(15 * 60 * 1000);
    const tooFar = atOffset(MAX_FUTURE_CLOCK_SKEW_MS + 1);
    const decision = occurredAtGate(tooFar, NOW);
    expect(occurredAtError(tooFar, NOW)).toBe('occurred_at_in_future');
    expect(decision).toEqual({ refused: true, code: 'occurred_at_in_future' });
    expect(decision).not.toHaveProperty('inserted');
    expect(JSON.stringify(decision)).not.toContain(NOW.toISOString());
  });

  it('allows a historical past timestamp and does not rewrite it', () => {
    const historical = '2001-01-01T00:00:00.000Z';
    const decision = occurredAtGate(historical, NOW);
    expect(occurredAtError(historical, NOW)).toBeNull();
    expect(decision).toEqual({ refused: false, occurredAt: historical });
    expect(decision.refused === false && decision.occurredAt).toBe(historical);
    expect(decision).not.toHaveProperty('inserted');
    expect(decision).not.toHaveProperty('receivedAt');
    expect(JSON.stringify(decision)).not.toContain(NOW.toISOString());
  });

  it('allows the 15-minute boundary and still does not insert', () => {
    const boundary = atOffset(MAX_FUTURE_CLOCK_SKEW_MS);
    const decision = occurredAtGate(boundary, NOW);
    expect(occurredAtError(boundary, NOW)).toBeNull();
    expect(decision).toEqual({ refused: false, occurredAt: boundary });
    expect(Object.keys(decision).sort()).toEqual(['occurredAt', 'refused']);
  });
});
