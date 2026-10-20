import { describe, expect, it } from 'vitest';
import { applyOnce, applyOrdered, IDEMPOTENT_APPLY_RETENTION_NOTE } from './idempotentApply';

const FIRST = {
  eventId: '11111111-1111-4111-8111-111111111111',
  clientEntityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

const SECOND = {
  eventId: '22222222-2222-4222-8222-222222222222',
  clientEntityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};

describe('applyOnce', () => {
  it('inserts one server id and accepts the first apply', () => {
    const seen = new Map<string, { serverId: string }>();
    const applied = applyOnce(seen, FIRST);

    expect(applied.status).toBe('accepted');
    expect(applied.serverId).toEqual(expect.any(String));
    expect(applied.serverId.length).toBeGreaterThan(0);
    expect(seen.size).toBe(1);
    expect(seen.get(FIRST.eventId)).toEqual({ serverId: applied.serverId });
  });

  it('returns the first server id as duplicate and does not add a row', () => {
    const seen = new Map<string, { serverId: string }>();
    const first = applyOnce(seen, FIRST);
    const row = seen.get(FIRST.eventId);

    const replay = applyOnce(seen, FIRST);
    const replayWithDifferentEntity = applyOnce(seen, {
      eventId: FIRST.eventId,
      clientEntityId: SECOND.clientEntityId,
    });

    expect(replay).toEqual({ status: 'duplicate', serverId: first.serverId });
    expect(replayWithDifferentEntity).toEqual({ status: 'duplicate', serverId: first.serverId });
    expect(seen.size).toBe(1);
    expect(seen.get(FIRST.eventId)).toBe(row);
    expect([...seen.keys()]).toEqual([FIRST.eventId]);
  });

  it('accepts a different event id, including one for the same client entity', () => {
    const seen = new Map<string, { serverId: string }>();
    const first = applyOnce(seen, FIRST);
    const second = applyOnce(seen, SECOND);
    const sameEntity = applyOnce(seen, {
      eventId: '33333333-3333-4333-8333-333333333333',
      clientEntityId: FIRST.clientEntityId,
    });

    expect(second.status).toBe('accepted');
    expect(sameEntity.status).toBe('accepted');
    expect(second.serverId).not.toBe(first.serverId);
    expect(sameEntity.serverId).not.toBe(first.serverId);
    expect(sameEntity.serverId).not.toBe(second.serverId);
    expect(seen.size).toBe(3);
    expect(seen.get(SECOND.eventId)).toEqual({ serverId: second.serverId });
    expect(seen.get(FIRST.eventId)?.serverId).toBe(first.serverId);
  });

  it('does not replace a row that was already recorded for the event', () => {
    const seen = new Map<string, { serverId: string }>([
      [FIRST.eventId, { serverId: 'server-row-already-there' }],
    ]);

    const replay = applyOnce(seen, FIRST);

    expect(replay).toEqual({ status: 'duplicate', serverId: 'server-row-already-there' });
    expect(seen.size).toBe(1);
    expect(seen.get(FIRST.eventId)).toEqual({ serverId: 'server-row-already-there' });
  });

  it('accepts a replay after purge as a new event, not a silent duplicate', () => {
    const seen = new Map<string, { serverId: string }>([
      [FIRST.eventId, { serverId: 'swept-row' }],
    ]);
    seen.delete(FIRST.eventId);

    const replay = applyOnce(seen, FIRST);

    expect(replay.status).toBe('accepted');
    expect(replay.serverId).not.toBe('swept-row');
    expect(seen.size).toBe(1);
    expect(seen.get(FIRST.eventId)?.serverId).toBe(replay.serverId);
  });

  it('refuses to treat a receipt past retention as a duplicate', () => {
    const seen = new Map<string, { serverId: string }>([
      [FIRST.eventId, { serverId: 'stale-row' }],
    ]);

    const replay = applyOnce(seen, FIRST, { receiptAgeDays: 90 });

    expect(replay.status).toBe('accepted');
    expect(replay.serverId).not.toBe('stale-row');
    expect(seen.size).toBe(1);
    expect(seen.get(FIRST.eventId)?.serverId).toBe(replay.serverId);
  });

  it('still returns the first receipt inside the retention window', () => {
    const seen = new Map<string, { serverId: string }>([
      [FIRST.eventId, { serverId: 'live-row' }],
    ]);

    const replay = applyOnce(seen, FIRST, { receiptAgeDays: 89 });

    expect(replay).toEqual({ status: 'duplicate', serverId: 'live-row' });
    expect(seen.get(FIRST.eventId)).toEqual({ serverId: 'live-row' });
  });
});

describe('applyOrdered', () => {
  it('returns one receipt for a duplicate event id and does not double-apply', () => {
    const seen = new Map<string, { serverId: string }>();
    const batch = [FIRST, { ...FIRST }];

    const receipts = applyOrdered(seen, batch);

    expect(receipts).toEqual([
      { eventId: FIRST.eventId, status: 'accepted', serverId: receipts[0]?.serverId },
      { eventId: FIRST.eventId, status: 'duplicate', serverId: receipts[0]?.serverId },
    ]);
    expect(receipts[0]?.serverId).toBe(receipts[1]?.serverId);
    expect(seen.size).toBe(1);
    expect(seen.get(FIRST.eventId)?.serverId).toBe(receipts[0]?.serverId);
    expect(batch).toEqual([FIRST, { ...FIRST }]);
  });

  it('returns dependency_pending and writes nothing when depends_on is unmet', () => {
    const seen = new Map<string, { serverId: string }>([
      ['already-landed', { serverId: 'kept' }],
    ]);
    const kept = seen.get('already-landed');
    const waiting = {
      eventId: 'evt-waiting',
      clientEntityId: 'entity-waiting',
      dependsOn: ['project:project-1:v1'],
    };

    const receipts = applyOrdered(seen, [waiting]);

    expect(receipts).toEqual([{ eventId: waiting.eventId, status: 'dependency_pending' }]);
    expect(receipts[0]).not.toHaveProperty('serverId');
    expect(seen.size).toBe(1);
    expect(seen.has(waiting.eventId)).toBe(false);
    expect(seen.get('already-landed')).toBe(kept);
  });

  it('accepts an event whose dependency landed earlier in the same batch', () => {
    const seen = new Map<string, { serverId: string }>();
    const parent = { eventId: 'evt-parent', clientEntityId: 'entity-parent' };
    const child = {
      eventId: 'evt-child',
      clientEntityId: 'entity-child',
      dependsOn: [parent.eventId],
    };

    const receipts = applyOrdered(seen, [parent, child]);

    expect(receipts.map((receipt) => receipt.status)).toEqual(['accepted', 'accepted']);
    expect(seen.size).toBe(2);
    expect(seen.get(child.eventId)?.serverId).toBe(receipts[1]?.serverId);
  });

  it('does not reorder an event ahead of a dependency that appears later', () => {
    const seen = new Map<string, { serverId: string }>();
    const child = {
      eventId: 'evt-child',
      clientEntityId: 'entity-child',
      dependsOn: ['evt-parent'],
    };
    const parent = { eventId: 'evt-parent', clientEntityId: 'entity-parent' };

    const receipts = applyOrdered(seen, [child, parent]);

    expect(receipts[0]).toEqual({ eventId: child.eventId, status: 'dependency_pending' });
    expect(receipts[1]?.status).toBe('accepted');
    expect(seen.has(child.eventId)).toBe(false);
    expect(seen.size).toBe(1);
  });

  it('still applies a later event that does not depend on the pending one', () => {
    const seen = new Map<string, { serverId: string }>();
    const waiting = {
      eventId: 'evt-waiting',
      clientEntityId: 'entity-waiting',
      dependsOn: ['missing'],
    };
    const independent = { eventId: 'evt-free', clientEntityId: 'entity-free' };

    const receipts = applyOrdered(seen, [waiting, independent]);

    expect(receipts[0]?.status).toBe('dependency_pending');
    expect(receipts[1]?.status).toBe('accepted');
    expect(seen.has(waiting.eventId)).toBe(false);
    expect(seen.has(independent.eventId)).toBe(true);
  });

  it('treats a caller-landed id as a satisfied dependency', () => {
    const seen = new Map<string, { serverId: string }>();
    const child = {
      eventId: 'evt-child',
      clientEntityId: 'entity-child',
      dependsOn: 'project:project-1:v1',
    };

    const receipts = applyOrdered(seen, [child], ['project:project-1:v1']);

    expect(receipts[0]?.status).toBe('accepted');
    expect(seen.size).toBe(1);
  });

  it('ignores blank depends_on entries', () => {
    const seen = new Map<string, { serverId: string }>();
    const event = {
      eventId: 'evt-blank',
      clientEntityId: 'entity-blank',
      dependsOn: ['', '   '],
    };

    const receipts = applyOrdered(seen, [event]);

    expect(receipts[0]?.status).toBe('accepted');
    expect(seen.size).toBe(1);
  });

  it('writes nothing when one of several dependencies is unmet', () => {
    const seen = new Map<string, { serverId: string }>();
    const event = {
      eventId: 'evt-partial',
      clientEntityId: 'entity-partial',
      dependsOn: ['landed-parent', 'missing-parent'],
    };

    const receipts = applyOrdered(seen, [event], ['landed-parent']);

    expect(receipts).toEqual([{ eventId: event.eventId, status: 'dependency_pending' }]);
    expect(seen.size).toBe(0);
  });

  it('does not let a purged receipt satisfy a later dependency or answer duplicate', () => {
    const seen = new Map<string, { serverId: string }>([
      ['evt-parent', { serverId: 'swept-parent' }],
    ]);
    const parent = {
      eventId: 'evt-parent',
      clientEntityId: 'entity-parent',
      receiptAgeDays: 90,
    };
    const child = {
      eventId: 'evt-child',
      clientEntityId: 'entity-child',
      dependsOn: ['evt-parent'],
    };

    const receipts = applyOrdered(seen, [child, parent]);

    expect(receipts[0]).toEqual({ eventId: child.eventId, status: 'dependency_pending' });
    expect(receipts[1]?.status).toBe('accepted');
    expect(receipts[1]?.serverId).not.toBe('swept-parent');
    expect(seen.has(child.eventId)).toBe(false);
    expect(seen.get(parent.eventId)?.serverId).toBe(receipts[1]?.serverId);
  });
});

describe('IDEMPOTENT_APPLY_RETENTION_NOTE', () => {
  it('states that event-id uniqueness does not survive purge', () => {
    expect(IDEMPOTENT_APPLY_RETENTION_NOTE).toBe(
      'Event-id uniqueness does not survive purge. A replay after purge is a new event, not a silent duplicate.',
    );
  });
});
