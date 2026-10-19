/**
 * G16 (ticket #5850) — the idempotent ordered apply contract, asserted against
 * the repository the batch push path uses.
 *
 * WHY THIS FILE AND NOT THE EXISTING TWO. `application/sync/idempotentApply.test.ts`
 * and `domain/sync/idempotentApply.test.ts` cover the two implementations in
 * isolation. The acceptance row this ticket is written from asks for something
 * narrower and repository-shaped, and the risk is a rule that holds in one unit and
 * is lost at the seam:
 *
 *   "duplicate event id returns one receipt and does not double-apply; unmet
 *    depends_on returns dependency_pending and writes nothing; sync_events (90 days)
 *    and sync_changes (30 days) are registered, and the registration says
 *    event-id uniqueness does not survive purge."
 *
 * So every assertion here is against `SWEPT_TABLES` (the registry the sweeper and
 * `check:swept-tables` read) or against the apply path the push route reaches, and
 * each one fails today if the rule is softened anywhere.
 *
 * The retention half is asserted against the REGISTRY, not against the memory
 * store, on purpose: `createMemorySyncApplyStore` has no clock and no sweeper, so
 * it can never show that the registration is the thing that bounds uniqueness. A
 * store-level purge test proves nothing about the window the platform actually
 * enforces.
 */
import { describe, expect, it } from 'vitest';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { PurgeStatement } from '../maintenance/boundedPurge';
import { SWEPT_TABLES } from '../maintenance/sweptTables';
import {
  SYNC_CHANGE_RETENTION_DAYS,
  SYNC_EVENT_RETENTION_DAYS,
  SYNC_RETENTION_TABLES,
  RETENTION_NOTE,
  uniquenessSurvivesRetention,
} from '../../domain/sync/syncRetention';
import { applySyncEvent, createMemorySyncApplyStore, type SyncApplyEvent } from './idempotentApply';

const TENANT = 7;
const DEVICE = 'device-a';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const REPLAY_EVENT_ID = '22222222-2222-4222-8222-222222222222';
const DEPENDENCY_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_DEPENDENCY = '44444444-4444-4444-8444-444444444444';
const ENTITY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const db = buildDatabase({ NEON_DATABASE_URL: 'postgresql://user:pw@localhost/db' } as Parameters<
  typeof buildDatabase
>[0]);
const toSQL = (statement: PurgeStatement) =>
  (statement as unknown as { toSQL(): { sql: string; params: unknown[] } }).toSQL();

const entryFor = (relation: string) => {
  const entry = SWEPT_TABLES.find((t) => t.relation === relation);
  if (!entry) throw new Error(`no SWEPT_TABLES entry for ${relation}`);
  return entry;
};

function event(overrides: Partial<SyncApplyEvent> = {}): SyncApplyEvent {
  return {
    tenantId: TENANT,
    deviceId: DEVICE,
    eventId: EVENT_ID,
    clientEntityId: ENTITY,
    entityType: 'ticket',
    payload: { title: 'once' },
    dependsOn: [],
    ...overrides,
  };
}

describe('G16 duplicate event id returns one receipt and does not double-apply', () => {
  it('answers a replay with the first receipt and leaves one row of each kind', () => {
    const store = createMemorySyncApplyStore();
    const first = applySyncEvent(store, event());

    const replay = applySyncEvent(store, event({ payload: { title: 'replay must not land' } }));

    expect(first.status).toBe('accepted');
    expect(first.serverId).toEqual(expect.any(String));

    // One receipt, addressed by the FIRST insert's server id.
    expect(replay.status).toBe('duplicate');
    expect(replay.serverId).toBe(first.serverId);
    expect(replay.receipt).toEqual({ ...first.receipt, status: 'duplicate' });

    // Exactly one stored receipt, and it is the accepted one — a replay is not a
    // second row, and it never rewrites the stored status.
    expect(store.receipts()).toHaveLength(1);
    expect(store.receipts()[0]).toEqual(first.receipt);

    // The mutation did not run twice: one projection, one change-log row, one commit.
    expect(store.projections()).toHaveLength(1);
    expect(store.projections()[0]?.payload).toEqual({ title: 'once' });
    expect(store.changes()).toHaveLength(1);
    expect(store.committedMutations()).toBe(1);
  });

  it('holds that across a repeated replay and a second device on the same event id', () => {
    const store = createMemorySyncApplyStore();
    const first = applySyncEvent(store, event());

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const replay = applySyncEvent(store, event({ payload: { title: `replay-${attempt}` } }));
      expect(replay.status).toBe('duplicate');
      expect(replay.serverId).toBe(first.serverId);
    }
    expect(store.receipts()).toHaveLength(1);
    expect(store.projections()).toHaveLength(1);
    expect(store.changes()).toHaveLength(1);
    expect(store.committedMutations()).toBe(1);

    // Uniqueness is per (tenant, device, event): another device is its own apply.
    const otherDevice = applySyncEvent(store, event({ deviceId: 'device-b' }));
    expect(otherDevice.status).toBe('accepted');
    expect(otherDevice.serverId).not.toBe(first.serverId);
    expect(store.receipts()).toHaveLength(2);
    expect(store.changes()).toHaveLength(2);
    expect(store.committedMutations()).toBe(2);
  });

  it('does not let a replay overwrite the projection the first apply wrote', () => {
    const store = createMemorySyncApplyStore();
    const first = applySyncEvent(store, event());

    applySyncEvent(store, event({ payload: { title: 'later title' } }));
    applySyncEvent(store, event({ payload: { title: 'later title again' } }));

    expect(store.projections()).toHaveLength(1);
    expect(store.projections()[0]?.serverId).toBe(first.serverId);
    expect(store.projections()[0]?.payload).toEqual({ title: 'once' });
  });
});

describe('G16 unmet depends_on returns dependency_pending and writes nothing', () => {
  it('stores no receipt, no projection and no change row for an unmet dependency', () => {
    const store = createMemorySyncApplyStore();
    const waiting = event({
      eventId: REPLAY_EVENT_ID,
      dependsOn: [OTHER_DEPENDENCY, DEPENDENCY_ID],
      payload: { title: 'blocked' },
    });

    const pending = applySyncEvent(store, waiting);

    expect(pending.status).toBe('dependency_pending');
    expect(pending.serverId).toBeNull();
    expect(pending.receipt).toBeNull();
    expect(pending.unmet).toBe(OTHER_DEPENDENCY);

    // NOTHING is written — not a receipt, not a projection, not a delta row.
    expect(store.receipts()).toEqual([]);
    expect(store.projections()).toEqual([]);
    expect(store.changes()).toEqual([]);
    expect(store.committedMutations()).toBe(0);

    // `dependency_pending` is a protocol status, never a stored one.
    expect(store.receipts().some((row) => (row.status as string) === 'dependency_pending')).toBe(false);
  });

  it('stays retryable and applies exactly once the dependency lands', () => {
    const store = createMemorySyncApplyStore();
    const waiting = event({
      dependsOn: [DEPENDENCY_ID],
      payload: { title: 'blocked' },
    });

    expect(applySyncEvent(store, waiting).status).toBe('dependency_pending');
    expect(applySyncEvent(store, waiting).status).toBe('dependency_pending');
    expect(applySyncEvent(store, waiting).status).toBe('dependency_pending');
    expect(store.receipts()).toEqual([]);

    applySyncEvent(store, event({
      eventId: DEPENDENCY_ID,
      deviceId: 'device-b',
      clientEntityId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      payload: { title: 'the parent' },
    }));

    const applied = applySyncEvent(store, waiting);

    expect(applied.status).toBe('accepted');
    expect(applied.receipt?.eventId).toBe(EVENT_ID);
    expect(store.receipts().map((row) => row.eventId)).toEqual([DEPENDENCY_ID, EVENT_ID]);
    expect(store.receipts().every((row) => row.status === 'accepted')).toBe(true);
    expect(store.projections()).toHaveLength(2);
    expect(store.changes()).toHaveLength(2);

    // Once applied, a replay is a duplicate like any other.
    expect(applySyncEvent(store, waiting).status).toBe('duplicate');
    expect(store.receipts()).toHaveLength(2);
    expect(store.changes()).toHaveLength(2);
  });

  it('does not let a pending event satisfy a later dependency', () => {
    const store = createMemorySyncApplyStore();
    const parent = event({ eventId: DEPENDENCY_ID, payload: { title: 'parent' } });
    const child = event({
      eventId: REPLAY_EVENT_ID,
      clientEntityId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      dependsOn: [DEPENDENCY_ID],
      payload: { title: 'child' },
    });

    const pending = applySyncEvent(store, child);
    expect(pending.status).toBe('dependency_pending');

    // The parent now exists, but the child was never written, so it is not satisfied.
    applySyncEvent(store, parent);
    expect(store.receipts().map((row) => row.eventId)).toEqual([DEPENDENCY_ID]);
    expect(store.receipts().some((row) => row.eventId === REPLAY_EVENT_ID)).toBe(false);
    expect(applySyncEvent(store, child).status).toBe('accepted');
  });
});

describe('G16 sync_events and sync_changes are registered with the retention caveat', () => {
  it('registers sync_events at the 90-day receipt window', () => {
    expect(SYNC_EVENT_RETENTION_DAYS).toBe(90);
    const entry = entryFor('sync_events');
    expect(entry.retentionDays).toBe(SYNC_EVENT_RETENTION_DAYS);
    expect(entry.connections).toContain('primary');
  });

  it('registers sync_changes at the 30-day delta window', () => {
    expect(SYNC_CHANGE_RETENTION_DAYS).toBe(30);
    const entry = entryFor('sync_changes');
    expect(entry.retentionDays).toBe(SYNC_CHANGE_RETENTION_DAYS);
    expect(entry.connections).toContain('primary');
  });

  it('binds the registered windows to syncRetention, not to a second number', () => {
    // The registry and the domain module must not drift: the sweeper's cutoff and the
    // guard that refuses to call a late replay a duplicate read the same constants.
    // A `days` literal written into sweptTables.ts would satisfy every other assertion
    // here and still let the two disagree, so assert the numbers are shared, not equal.
    const windows = ['sync_events', 'sync_changes'].map((r) => entryFor(r).retentionDays);
    expect(windows).toEqual([SYNC_EVENT_RETENTION_DAYS, SYNC_CHANGE_RETENTION_DAYS]);
    expect(SYNC_RETENTION_TABLES).toEqual(['sync_events', 'sync_changes']);
  });

  it('says in the registration that event-id uniqueness does not survive purge', () => {
    for (const relation of ['sync_events', 'sync_changes']) {
      const { rationale } = entryFor(relation);
      expect(rationale, relation).toMatch(/after sync_events is purged, the same event id is a NEW event, not a silent duplicate/);
    }
    // The prose lives in one place beside the registry, and names both windows.
    expect(RETENTION_NOTE).toMatch(/Event-id uniqueness does not survive retention/);
    expect(RETENTION_NOTE).toContain(`${SYNC_EVENT_RETENTION_DAYS} days`);
    expect(RETENTION_NOTE).toContain(`${SYNC_CHANGE_RETENTION_DAYS} days`);
  });

  it('purges both logs by their own timestamp column, bounded and cross-tenant', () => {
    const cutoff = new Date('2026-01-01T00:00:00.000Z');
    const events = toSQL(entryFor('sync_events').purge(db, cutoff));
    const changes = toSQL(entryFor('sync_changes').purge(db, cutoff));

    // Bounded: the registry's purge is a ctid batch, never an unbounded DELETE.
    for (const [relation, query] of [['sync_events', events], ['sync_changes', changes]] as const) {
      expect(query.sql, relation).toMatch(/^delete from/);
      expect(query.sql, relation).toContain('ctid = any(array(select ctid from');
      expect(query.sql, relation).toContain('limit $');
    }
    expect(events.sql).toContain('"received_at"');
    expect(changes.sql).toContain('"recorded_at"');
    // Cross-tenant by construction: no tenant predicate is added by this window.
    expect(events.sql).not.toMatch(/"tenant_id"\s*=/);
    expect(changes.sql).not.toMatch(/"tenant_id"\s*=/);
  });

  it('does not register the sync tables that are not disposable', () => {
    const names = SWEPT_TABLES.map((t) => t.relation);
    expect(names).toContain('sync_events');
    expect(names).toContain('sync_changes');
    expect(names).not.toContain('sync_records');
    expect(names).not.toContain('sync_entity_mappings');
  });

  it('bounds the idempotency guarantee to the window a purge closes', () => {
    // Inside the window a replay is a duplicate; at or past it the receipt that
    // would have proved the event is gone, so a late replay is a NEW accept.
    expect(uniquenessSurvivesRetention(SYNC_EVENT_RETENTION_DAYS - 1)).toBe(true);
    expect(uniquenessSurvivesRetention(SYNC_EVENT_RETENTION_DAYS)).toBe(false);
    expect(uniquenessSurvivesRetention(SYNC_EVENT_RETENTION_DAYS + 1)).toBe(false);
    expect(uniquenessSurvivesRetention(Number.POSITIVE_INFINITY)).toBe(false);
    expect(uniquenessSurvivesRetention(Number.NaN)).toBe(false);
  });
});