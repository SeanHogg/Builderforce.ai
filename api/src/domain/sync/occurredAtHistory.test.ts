import { describe, expect, it } from 'vitest';
import { MAX_FUTURE_CLOCK_SKEW_MS, occurredAtError } from './occurredAtGate';

/**
 * G25 client and server time. `occurredAtError(occurredAt, now)` takes the
 * server clock as an injected `now: Date`, so every case here is anchored to a
 * fixed instant rather than wall time. Historical past timestamps are
 * intentionally allowed — only the future direction is bounded — so an
 * arbitrarily old import is accepted and never read as a client defect.
 * The push path calls this check before any insert.
 */
const NOW = new Date('2026-10-18T12:00:00.000Z');
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

function atOffset(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString();
}

describe('occurredAtError historical client time', () => {
  it('rejects timestamps the injected clock cannot parse', () => {
    expect(occurredAtError('not-a-timestamp', NOW)).toBe('occurred_at_invalid');
    expect(occurredAtError('', NOW)).toBe('occurred_at_invalid');
    expect(occurredAtError('2026-13-40T99:99:99.000Z', NOW)).toBe('occurred_at_invalid');
  });

  it('rejects a client time more than 15 minutes ahead of the injected server clock', () => {
    expect(MAX_FUTURE_CLOCK_SKEW_MS).toBe(FIFTEEN_MINUTES_MS);
    expect(occurredAtError(atOffset(FIFTEEN_MINUTES_MS + 60_000), NOW)).toBe('occurred_at_in_future');
    expect(occurredAtError(atOffset(FIFTEEN_MINUTES_MS + 1), NOW)).toBe('occurred_at_in_future');
  });

  it('accepts a historical past timestamp hours ago and years ago', () => {
    expect(occurredAtError(atOffset(-1), NOW)).toBeNull();
    expect(occurredAtError(atOffset(-6 * 60 * 60 * 1000), NOW)).toBeNull();
    expect(occurredAtError('2020-10-18T12:00:00.000Z', NOW)).toBeNull();
    expect(occurredAtError('2001-01-01T00:00:00.000Z', NOW)).toBeNull();
  });

  it('accepts the boundary just inside 15 minutes and rejects just outside it', () => {
    expect(occurredAtError(atOffset(FIFTEEN_MINUTES_MS - 1), NOW)).toBeNull();
    expect(occurredAtError(atOffset(FIFTEEN_MINUTES_MS), NOW)).toBeNull();
    expect(occurredAtError(atOffset(FIFTEEN_MINUTES_MS + 1), NOW)).toBe('occurred_at_in_future');
  });
});
