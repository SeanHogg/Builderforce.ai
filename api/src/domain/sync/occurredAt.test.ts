import { describe, expect, it } from 'vitest';
import {
  applyClientOccurredAt,
  CLIENT_REPORTED_EVIDENCE,
  MAX_FUTURE_CLOCK_SKEW_MS,
  occurredAtError,
} from './occurredAtGate';

const NOW = new Date('2026-10-18T12:00:00.000Z');

describe('occurredAtError', () => {
  it('rejects a timestamp that does not parse', () => {
    expect(occurredAtError('not-a-timestamp', NOW)).toBe('occurred_at_invalid');
    expect(occurredAtError('', NOW)).toBe('occurred_at_invalid');
  });

  it('rejects a client clock more than 15 minutes ahead of the server', () => {
    const tooFar = new Date(NOW.getTime() + MAX_FUTURE_CLOCK_SKEW_MS + 1).toISOString();
    expect(occurredAtError(tooFar, NOW)).toBe('occurred_at_in_future');
    expect(MAX_FUTURE_CLOCK_SKEW_MS).toBe(15 * 60 * 1000);
  });

  it('accepts the 15-minute skew boundary and an arbitrarily old historical time', () => {
    const boundary = new Date(NOW.getTime() + MAX_FUTURE_CLOCK_SKEW_MS).toISOString();
    expect(occurredAtError(boundary, NOW)).toBeNull();
    expect(occurredAtError('2019-03-04T08:15:00.000Z', NOW)).toBeNull();
  });
});

describe('applyClientOccurredAt', () => {
  it('applies occurredAtError and does not stamp a receivedAt for an invalid clock', () => {
    expect(applyClientOccurredAt('not-a-timestamp', NOW)).toEqual({
      ok: false,
      error: occurredAtError('not-a-timestamp', NOW),
    });
  });

  it('applies occurredAtError and refuses a clock more than 15 minutes in the future', () => {
    const tooFar = new Date(NOW.getTime() + MAX_FUTURE_CLOCK_SKEW_MS + 1).toISOString();
    expect(applyClientOccurredAt(tooFar, NOW)).toEqual({
      ok: false,
      error: 'occurred_at_in_future',
    });
  });

  it('keeps a historical occurredAt, stamps server receivedAt, and marks client-reported evidence', () => {
    const historical = 'March 4, 2019 08:15:00 GMT';
    const applied = applyClientOccurredAt(historical, NOW);
    expect(occurredAtError(historical, NOW)).toBeNull();
    expect(applied).toEqual({
      ok: true,
      time: {
        occurredAt: historical,
        receivedAt: NOW.toISOString(),
        evidence: CLIENT_REPORTED_EVIDENCE,
      },
    });
    expect(CLIENT_REPORTED_EVIDENCE).toBe('client-reported');
  });
});
