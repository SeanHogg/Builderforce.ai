import { describe, expect, it } from 'vitest';
import { applyBatch, pullSince, type ApplyOneResult } from './batchSync';

interface PushEvent {
  eventId: string;
  occurredAt: string;
}

const E1: PushEvent = { eventId: 'e1', occurredAt: '2026-10-18T12:00:03.000Z' };
const E2: PushEvent = { eventId: 'e2', occurredAt: '2026-10-18T12:00:01.000Z' };
const E3: PushEvent = { eventId: 'e3', occurredAt: '2026-10-18T12:00:02.000Z' };

const accept = (): ApplyOneResult => ({ ok: true });

describe('applyBatch', () => {
  it('returns an empty applied list and a null rejection for an empty batch', () => {
    let calls = 0;
    const result = applyBatch([], () => {
      calls += 1;
      return accept();
    });

    expect(result).toEqual({ applied: [], rejected: null, rest: [] });
    expect(calls).toBe(0);
  });

  it('applies every event in array order when none is rejected', () => {
    const seen: string[] = [];
    const input = [E1, E2, E3];
    const result = applyBatch(input, (event) => {
      seen.push(event.eventId);
      return { ok: true };
    });

    expect(seen).toEqual(['e1', 'e2', 'e3']);
    expect(result.applied).toEqual([E1, E2, E3]);
    expect(result.rejected).toBeNull();
    expect(result.rest).toEqual([]);
    expect(input).toEqual([E1, E2, E3]);
  });

  it('stops at the first rejection and does not apply anything after it', () => {
    const seen: string[] = [];
    const result = applyBatch([E1, E2, E3], (event) => {
      seen.push(event.eventId);
      if (event.eventId === 'e2') return { ok: false, reason: 'dependency_pending' };
      return { ok: true };
    });

    expect(seen).toEqual(['e1', 'e2']);
    expect(result.applied).toEqual([E1]);
    expect(result.rejected).toEqual({ event: E2, reason: 'dependency_pending' });
    expect(result.rest).toEqual([E3]);
    expect(result.applied).not.toContain(E2);
    expect(result.applied).not.toContain(E3);
    expect(result.rest).not.toContain(E2);
  });

  it('rejects the first event without applying the rest', () => {
    const seen: string[] = [];
    const result = applyBatch([E1, E2, E3], (event) => {
      seen.push(event.eventId);
      return { ok: false, reason: 'occurred_at_in_future' };
    });

    expect(seen).toEqual(['e1']);
    expect(result).toEqual({
      applied: [],
      rejected: { event: E1, reason: 'occurred_at_in_future' },
      rest: [E2, E3],
    });
  });

  it('keeps a rejected tail empty when the last event is the one that fails', () => {
    const result = applyBatch([E1, E2], (event) => {
      if (event.eventId === 'e2') return { ok: false, reason: 'schema_version' };
      return { ok: true };
    });

    expect(result.applied).toEqual([E1]);
    expect(result.rejected).toEqual({ event: E2, reason: 'schema_version' });
    expect(result.rest).toEqual([]);
  });
});

interface PullChange {
  cursor: number;
  id: string;
  occurredAt: string;
}

describe('pullSince', () => {
  const changes: PullChange[] = [
    { cursor: 30, id: 'c', occurredAt: '2026-01-01T00:00:00.000Z' },
    { cursor: 10, id: 'a', occurredAt: '2026-12-31T00:00:00.000Z' },
    { cursor: 20, id: 'b', occurredAt: '2026-06-01T00:00:00.000Z' },
    { cursor: 20, id: 'b-tie', occurredAt: '2020-01-01T00:00:00.000Z' },
  ];

  it('returns only changes strictly after the cursor, in ascending cursor order', () => {
    const page = pullSince(changes, 10);

    expect(page.map((change) => change.id)).toEqual(['b', 'b-tie', 'c']);
    expect(page.map((change) => change.cursor)).toEqual([20, 20, 30]);
    expect(page.map((change) => change.occurredAt)).toEqual([
      '2026-06-01T00:00:00.000Z',
      '2020-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
  });

  it('does not sort by occurredAt', () => {
    const byTime = [...changes].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const page = pullSince(changes, 0);

    expect(byTime.map((change) => change.id)).toEqual(['b-tie', 'c', 'b', 'a']);
    expect(page.map((change) => change.id)).toEqual(['a', 'b', 'b-tie', 'c']);
  });

  it('returns an empty page when the cursor is ahead of every change', () => {
    expect(pullSince(changes, 30)).toEqual([]);
    expect(pullSince(changes, 31)).toEqual([]);
    expect(pullSince(changes, Number.POSITIVE_INFINITY)).toEqual([]);
    expect(pullSince([], 0)).toEqual([]);
  });

  it('excludes a change whose cursor equals the given cursor', () => {
    expect(pullSince(changes, 20).map((change) => change.cursor)).toEqual([30]);
  });

  it('does not mutate the input log', () => {
    const input = [...changes];
    const before = input.map((change) => change.id);

    pullSince(input, 0);

    expect(input.map((change) => change.id)).toEqual(before);
  });
});
