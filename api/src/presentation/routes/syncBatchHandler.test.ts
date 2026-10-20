import { describe, expect, it } from 'vitest';
import { encodeCursor } from '../../domain/sync/cursorCodec';
import type { ApplyOneResult } from '../../domain/sync/batchSync';
import { MAX_FUTURE_CLOCK_SKEW_MS, occurredAtError } from '../../domain/sync/syncProtocol';
import { handleSyncBatch, type SyncBatchDeps } from './syncBatchHandler';

interface PushEvent {
  eventId: string;
}

const E1: PushEvent = { eventId: 'e1' };
const E2: PushEvent = { eventId: 'e2' };
const E3: PushEvent = { eventId: 'e3' };

function fakeApply(decide: (event: PushEvent) => ApplyOneResult): {
  deps: SyncBatchDeps<PushEvent>;
  seen: string[];
} {
  const seen: string[] = [];
  return {
    seen,
    deps: {
      apply: (event) => {
        seen.push(event.eventId);
        return decide(event);
      },
    },
  };
}

describe('handleSyncBatch', () => {
  it('returns invalid_batch and calls nothing when the body is not an object', () => {
    const { deps, seen } = fakeApply(() => ({ ok: true }));
    const bodies: unknown[] = [null, undefined, 'batch', 0, true, [E1]];

    for (const body of bodies) {
      expect(handleSyncBatch(body, deps)).toEqual({ status: 400, code: 'invalid_batch' });
    }

    expect(seen).toEqual([]);
  });

  it('returns invalid_batch and calls nothing when events is not an array', () => {
    const { deps, seen } = fakeApply(() => ({ ok: true }));

    expect(handleSyncBatch({ events: E1, cursor: 0 }, deps)).toEqual({
      status: 400,
      code: 'invalid_batch',
    });
    expect(handleSyncBatch({ cursor: 4 }, deps)).toEqual({
      status: 400,
      code: 'invalid_batch',
    });

    expect(seen).toEqual([]);
  });

  it('applies every event in order through applyBatch and advances a numeric cursor', () => {
    const { deps, seen } = fakeApply(() => ({ ok: true }));
    const events = [E1, E2, E3];

    const result = handleSyncBatch({ events, cursor: 10 }, deps);

    expect(seen).toEqual(['e1', 'e2', 'e3']);
    expect(result).toEqual({
      applied: [E1, E2, E3],
      stoppedAt: null,
      nextCursor: 13,
    });
    expect(events).toEqual([E1, E2, E3]);
  });

  it('stops at the first rejection and does not advance past it', () => {
    const { deps, seen } = fakeApply((event) =>
      event.eventId === 'e2' ? { ok: false, reason: 'dependency_pending' } : { ok: true },
    );

    const result = handleSyncBatch({ events: [E1, E2, E3], cursor: 4 }, deps);

    expect(seen).toEqual(['e1', 'e2']);
    expect(result).toEqual({
      applied: [E1],
      stoppedAt: { event: E2, reason: 'dependency_pending' },
      nextCursor: 5,
    });
  });

  it('does not call apply for an empty batch and keeps the cursor', () => {
    const { deps, seen } = fakeApply(() => ({ ok: true }));

    expect(handleSyncBatch({ events: [], cursor: 7 }, deps)).toEqual({
      applied: [],
      stoppedAt: null,
      nextCursor: 7,
    });
    expect(seen).toEqual([]);
  });

  it('advances an encoded cursor by the accepted prefix only', () => {
    const { deps, seen } = fakeApply((event) =>
      event.eventId === 'e3' ? { ok: false, reason: 'conflict' } : { ok: true },
    );
    const cursor = encodeCursor(20);

    const result = handleSyncBatch({ events: [E1, E2, E3], cursor }, deps);

    expect(seen).toEqual(['e1', 'e2', 'e3']);
    expect(result).toEqual({
      applied: [E1, E2],
      stoppedAt: { event: E3, reason: 'conflict' },
      nextCursor: encodeCursor(22),
    });
  });

  it('leaves a cursor it cannot advance unchanged', () => {
    const { deps } = fakeApply(() => ({ ok: true }));

    expect(handleSyncBatch({ events: [E1], cursor: 'not-a-cursor' }, deps)).toEqual({
      applied: [E1],
      stoppedAt: null,
      nextCursor: 'not-a-cursor',
    });
    expect(handleSyncBatch({ events: [E1], cursor: null }, deps)).toEqual({
      applied: [E1],
      stoppedAt: null,
      nextCursor: null,
    });
  });

  it('rejects the first event without applying the rest or moving the cursor', () => {
    const { deps, seen } = fakeApply(() => ({ ok: false, reason: 'occurred_at_in_future' }));

    expect(handleSyncBatch({ events: [E1, E2], cursor: 3 }, deps)).toEqual({
      applied: [],
      stoppedAt: { event: E1, reason: 'occurred_at_in_future' },
      nextCursor: 3,
    });
    expect(seen).toEqual(['e1']);
  });
});

interface TimedEvent {
  eventId: string;
  occurredAt: string;
}

const GATE_NOW = new Date('2026-10-18T12:00:00.000Z');

function atOffset(ms: number): string {
  return new Date(GATE_NOW.getTime() + ms).toISOString();
}

describe('handleSyncBatch occurredAt gate', () => {
  it('refuses an invalid occurredAt before apply and writes nothing', () => {
    const { deps, seen } = fakeApply(() => ({ ok: true }));
    deps.now = GATE_NOW;
    const event: TimedEvent = { eventId: 'bad', occurredAt: 'not-a-timestamp' };
    const later: TimedEvent = { eventId: 'later', occurredAt: '2001-01-01T00:00:00.000Z' };

    const result = handleSyncBatch({ events: [event, later], cursor: 8 }, deps);

    expect(occurredAtError(event.occurredAt, GATE_NOW)).toBe('occurred_at_invalid');
    expect(seen).toEqual([]);
    expect(result).toEqual({
      applied: [],
      stoppedAt: { event, reason: 'occurred_at_invalid' },
      nextCursor: 8,
    });
  });

  it('refuses a future occurredAt beyond the 15-minute window before apply', () => {
    expect(MAX_FUTURE_CLOCK_SKEW_MS).toBe(15 * 60 * 1000);
    const { deps, seen } = fakeApply(() => ({ ok: true }));
    deps.now = GATE_NOW;
    const event: TimedEvent = {
      eventId: 'future',
      occurredAt: atOffset(MAX_FUTURE_CLOCK_SKEW_MS + 1),
    };

    const result = handleSyncBatch({ events: [event], cursor: 2 }, deps);

    expect(occurredAtError(event.occurredAt, GATE_NOW)).toBe('occurred_at_in_future');
    expect(seen).toEqual([]);
    expect(result).toEqual({
      applied: [],
      stoppedAt: { event, reason: 'occurred_at_in_future' },
      nextCursor: 2,
    });
  });

  it('allows a historical past timestamp and applies it unchanged', () => {
    const { deps, seen } = fakeApply(() => ({ ok: true }));
    deps.now = GATE_NOW;
    const event: TimedEvent = { eventId: 'old', occurredAt: '2001-01-01T00:00:00.000Z' };

    const result = handleSyncBatch({ events: [event], cursor: 4 }, deps);

    expect(occurredAtError(event.occurredAt, GATE_NOW)).toBeNull();
    expect(seen).toEqual(['old']);
    expect(result).toEqual({
      applied: [event],
      stoppedAt: null,
      nextCursor: 5,
    });
    expect(event.occurredAt).toBe('2001-01-01T00:00:00.000Z');
  });

  it('does not apply events after an occurredAt refusal', () => {
    const { deps, seen } = fakeApply(() => ({ ok: true }));
    deps.now = GATE_NOW;
    const kept: TimedEvent = { eventId: 'kept', occurredAt: '2001-01-01T00:00:00.000Z' };
    const refused: TimedEvent = { eventId: 'refused', occurredAt: '' };
    const skipped: TimedEvent = { eventId: 'skipped', occurredAt: '2001-01-01T00:00:00.000Z' };

    const result = handleSyncBatch({ events: [kept, refused, skipped], cursor: 1 }, deps);

    expect(seen).toEqual(['kept']);
    expect(result).toEqual({
      applied: [kept],
      stoppedAt: { event: refused, reason: 'occurred_at_invalid' },
      nextCursor: 2,
    });
  });
});
