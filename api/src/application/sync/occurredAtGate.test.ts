import { describe, expect, it } from 'vitest';
import { MAX_FUTURE_CLOCK_SKEW_MS, occurredAtError } from '../../domain/sync/occurredAtGate';
import { pushClientOccurredAt, rejectInvalidOccurredAt } from './occurredAtGate';

/**
 * G25 application gate. The push path calls `occurredAtError` before `insert`.
 * An invalid or too-future client time is a rejection and `insert` is not
 * called. A historical past timestamp is admitted and only then inserted,
 * unchanged. The clock is injected; nothing reads `Date.now()`.
 */
const NOW = new Date('2026-10-18T12:00:00.000Z');

function atOffset(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString();
}

/** The gate returns a code or null. A row, an id, or an insert is not a result. */
function expectNoInsert(result: string | null): void {
  expect(result === null || typeof result === 'string').toBe(true);
  if (result !== null) {
    expect(result).not.toHaveProperty('inserted');
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('row');
    expect(result).not.toHaveProperty('receivedAt');
  }
  expect(result).not.toEqual(expect.objectContaining({ inserted: expect.anything() }));
}

describe('rejectInvalidOccurredAt', () => {
  it('returns occurred_at_invalid for an unparseable client time and does not insert', () => {
    for (const occurredAt of ['not-a-timestamp', '', '2026-13-40T99:99:99.000Z']) {
      const result = rejectInvalidOccurredAt(occurredAt, NOW);
      expect(occurredAtError(occurredAt, NOW)).toBe('occurred_at_invalid');
      expect(result).toBe('occurred_at_invalid');
      expect(result).toBe(occurredAtError(occurredAt, NOW));
      expectNoInsert(result);
    }
  });

  it('returns occurred_at_in_future beyond the existing 15-minute window and does not insert', () => {
    expect(MAX_FUTURE_CLOCK_SKEW_MS).toBe(15 * 60 * 1000);
    const tooFar = atOffset(MAX_FUTURE_CLOCK_SKEW_MS + 1);
    const result = rejectInvalidOccurredAt(tooFar, NOW);
    expect(occurredAtError(tooFar, NOW)).toBe('occurred_at_in_future');
    expect(result).toBe('occurred_at_in_future');
    expect(result).toBe(occurredAtError(tooFar, NOW));
    expectNoInsert(result);
    expect(String(result)).not.toContain(NOW.toISOString());
  });

  it('allows a historical past timestamp and does not insert', () => {
    const historical = '2001-01-01T00:00:00.000Z';
    const result = rejectInvalidOccurredAt(historical, NOW);
    expect(occurredAtError(historical, NOW)).toBeNull();
    expect(result).toBeNull();
    expect(result).toBe(occurredAtError(historical, NOW));
    expectNoInsert(result);
  });

  it('allows the 15-minute boundary and still does not insert', () => {
    const boundary = atOffset(MAX_FUTURE_CLOCK_SKEW_MS);
    const result = rejectInvalidOccurredAt(boundary, NOW);
    expect(occurredAtError(boundary, NOW)).toBeNull();
    expect(result).toBeNull();
    expect(result).toBe(occurredAtError(boundary, NOW));
    expectNoInsert(result);
  });

  it('takes only the client time and an injected clock, so it has no store to insert into', () => {
    expect(rejectInvalidOccurredAt.length).toBe(2);
  });
});

describe('pushClientOccurredAt', () => {
  it('calls occurredAtError before insert and does not insert an invalid, a too-future, or rewrite a historical time', () => {
    const inserted: string[] = [];
    const insert = (event: { occurredAt: string }): void => {
      inserted.push(event.occurredAt);
    };
    const tooFar = atOffset(MAX_FUTURE_CLOCK_SKEW_MS + 1);
    const historical = '2001-01-01T00:00:00.000Z';

    const invalid = pushClientOccurredAt({ id: 'bad', occurredAt: 'not-a-timestamp' }, NOW, insert);
    const future = pushClientOccurredAt({ id: 'future', occurredAt: tooFar }, NOW, insert);
    expect(occurredAtError('not-a-timestamp', NOW)).toBe('occurred_at_invalid');
    expect(occurredAtError(tooFar, NOW)).toBe('occurred_at_in_future');
    expect(invalid).toEqual({ ok: false, code: 'occurred_at_invalid' });
    expect(future).toEqual({ ok: false, code: 'occurred_at_in_future' });
    expect(inserted).toEqual([]);

    const admitted = pushClientOccurredAt({ id: 'hist', occurredAt: historical }, NOW, insert);
    expect(occurredAtError(historical, NOW)).toBeNull();
    expect(admitted).toEqual({ ok: true, event: { id: 'hist', occurredAt: historical } });
    expect(inserted).toEqual([historical]);
    expect(JSON.stringify(invalid)).not.toContain(NOW.toISOString());
    expect(JSON.stringify(future)).not.toContain(NOW.toISOString());
  });
});
