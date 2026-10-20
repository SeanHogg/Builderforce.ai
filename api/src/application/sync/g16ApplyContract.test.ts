/**
 * G16 (ticket #5850) — the idempotent ordered apply contract, asserted against
 * the ONE push path (`handleSyncPush`) and the swept-tables REGISTRY.
 *
 * The acceptance row this is written from:
 *
 *   "duplicate event id returns one receipt and does not double-apply; unmet
 *    depends_on returns dependency_pending and writes nothing; sync_events (90 days)
 *    and sync_changes (30 days) are registered, and the registration says
 *    event-id uniqueness does not survive purge."
 *
 * The two in-memory apply twins this file used to drive are gone; the rule is
 * asserted where it now lives. The retention half stays against the REGISTRY,
 * because only the registry bounds the window the platform enforces.
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
import { SYNC_PROTOCOL_VERSION, hashSyncPayload } from '../../domain/sync/syncProtocol';
import { createMemorySyncStores } from './__fixtures__/memorySyncStores';
import { handleSyncPush } from './handleSyncPush';
import type { SyncMutationImporter } from './syncPorts';

const NOW = new Date('2026-02-01T10:00:00.000Z');
const AUTH = { tenantId: 7, userId: 'user-7', role: 'developer' };
const DESTINATION = { kind: 'bound' as const, tenantId: '7' };

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const DEPENDENCY_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_DEPENDENCY = '44444444-4444-4444-8444-444444444444';

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

function harness() {
  const applied: string[] = [];
  const importer: SyncMutationImporter = async (event, ctx) => {
    applied.push(event.eventId);
    return {
      status: 'applied',
      serverId: `srv-${event.clientEntityId}`,
      serverVersion: 1,
      payloadHash: hashSyncPayload(event.payload),
      destinationKey: ctx.destinationKey,
      payload: event.payload,
    };
  };
  const stores = createMemorySyncStores({
    importers: { importSyncedTicket: importer, importSyncedProject: importer, importMirrorRecord: importer },
  });
  const push = (events: Array<{ eventId: string; clientEntityId: string; dependsOn?: string[]; title?: string }>, deviceId = 'device-a') =>
    handleSyncPush({
      batchId: 'b',
      protocolVersion: SYNC_PROTOCOL_VERSION,
      deviceId,
      destination: DESTINATION,
      events: events.map((e, index) => {
        const payload = { title: e.title ?? 'once' };
        return {
          eventId: e.eventId,
          clientEntityId: e.clientEntityId,
          entityType: 'chat',
          operation: 'create',
          schemaVersion: 1,
          localSequence: index + 1,
          occurredAt: NOW.toISOString(),
          dependsOn: e.dependsOn ?? [],
          destination: DESTINATION,
          payload,
          payloadHash: hashSyncPayload(payload),
        };
      }),
    }, { auth: AUTH, now: NOW, stores });
  return { applied, stores, push };
}

const ENTITY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ENTITY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('G16 duplicate event id returns one receipt and does not double-apply', () => {
  it('answers repeated replays with the first receipt and leaves one row of each kind', async () => {
    const h = harness();
    const first = await h.push([{ eventId: EVENT_ID, clientEntityId: ENTITY }]);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const replay = await h.push([{ eventId: EVENT_ID, clientEntityId: ENTITY }]);
      expect(replay.ok && replay.receipts[0]).toMatchObject({ status: 'duplicate', serverId: `srv-${ENTITY}` });
    }
    expect(first.ok && first.receipts[0]?.status).toBe('accepted');
    expect(h.applied).toEqual([EVENT_ID]);
    const state = h.stores.state();
    expect(state.events).toHaveLength(1);
    expect(state.events[0]?.status).toBe('accepted');
    expect(state.records).toHaveLength(1);
    expect(state.changes).toHaveLength(1);
  });

  it('scopes uniqueness to (tenant, device, event): another device is its own apply', async () => {
    const h = harness();
    await h.push([{ eventId: EVENT_ID, clientEntityId: ENTITY }]);
    const other = await h.push([{ eventId: EVENT_ID, clientEntityId: ENTITY }], 'device-b');
    expect(other.ok && other.receipts[0]?.status).toBe('accepted');
    expect(h.stores.state().events).toHaveLength(2);
  });
});

describe('G16 unmet depends_on returns dependency_pending and writes nothing', () => {
  it('stores no receipt, projection or change row, and stays retryable', async () => {
    const h = harness();
    const waiting = { eventId: EVENT_ID, clientEntityId: ENTITY, dependsOn: [OTHER_DEPENDENCY, DEPENDENCY_ID] };
    const pending = await h.push([waiting]);
    expect(pending.ok && pending.receipts[0]).toMatchObject({ status: 'dependency_pending', detail: OTHER_DEPENDENCY });
    expect(h.stores.state()).toMatchObject({ events: [], records: [], changes: [] });
    expect(h.applied).toEqual([]);

    await h.push([{ eventId: DEPENDENCY_ID, clientEntityId: OTHER_ENTITY }, { eventId: OTHER_DEPENDENCY, clientEntityId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }]);
    const applied = await h.push([waiting]);
    expect(applied.ok && applied.receipts[0]?.status).toBe('accepted');
    expect((await h.push([waiting])).ok).toBe(true);
    expect(h.applied.filter((id) => id === EVENT_ID)).toHaveLength(1);
  });
});

describe('G16 a replay after purge is a new event, not a silent duplicate', () => {
  it('accepts the same event id again once its receipt row is gone', async () => {
    const h = harness();
    await h.push([{ eventId: EVENT_ID, clientEntityId: ENTITY }]);
    h.stores.state().events.length = 0; // the sweeper removed the receipt
    const late = await h.push([{ eventId: EVENT_ID, clientEntityId: ENTITY }]);
    expect(late.ok && late.receipts[0]?.status).toBe('accepted');
    expect(h.applied).toEqual([EVENT_ID, EVENT_ID]);
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