import { describe, expect, it } from 'vitest';
import { buildDatabase } from '../database/connection';
import { decodeSyncCursor, encodeSyncCursor } from '../../domain/sync/syncProtocol';
import {
  applyServerPullLocally,
  changesAfterCursorQuery,
  minChangeSeqQuery,
  pullSyncTables,
  recordsAfterCursorQuery,
  recordsForClientsQuery,
  type PullSyncTablesResult,
  type SyncChangeRow,
  type SyncPullTables,
  type SyncRecordRow,
} from './syncPullQuery';

const db = buildDatabase({ NEON_DATABASE_URL: 'postgresql://user:pw@localhost/db' } as Parameters<typeof buildDatabase>[0]);

const SECRET = 'tombstone-body-must-not-merge';
const DELETED_AT = '2026-10-19T12:00:00.000Z';

function delta(seq: number): string {
  return encodeSyncCursor({ v: 1, kind: 'delta', seq });
}

function snapshot(afterEntityType: string, afterClientEntityId: string): string {
  return encodeSyncCursor({ v: 1, kind: 'snapshot', afterEntityType, afterClientEntityId });
}

function rejectable(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function change(overrides: Partial<SyncChangeRow> = {}): SyncChangeRow {
  return {
    seq: 8,
    entityType: 'ticket',
    clientEntityId: 'ticket-1',
    serverId: 'server-1',
    operation: 'upsert',
    version: 2,
    destinationKey: 'bound:1',
    record: { payload: { title: 'live' } },
    occurredAt: DELETED_AT,
    deviceId: 'device-1',
    eventId: '11111111-1111-1111-1111-111111111111',
    ...overrides,
  };
}

function record(overrides: Partial<SyncRecordRow> = {}): SyncRecordRow {
  return {
    entityType: 'ticket',
    clientEntityId: 'ticket-1',
    serverId: 'server-1',
    schemaVersion: 1,
    version: 2,
    destinationKey: 'bound:1',
    occurredAt: DELETED_AT,
    updatedAt: DELETED_AT,
    deletedAt: null,
    payload: { title: 'live' },
    provenance: {},
    ...overrides,
  };
}

function source(seed: {
  minSeq?: number | null;
  changes?: readonly SyncChangeRow[];
  records?: readonly SyncRecordRow[];
  forClients?: readonly SyncRecordRow[];
  onPage?: (name: string) => void;
} = {}): SyncPullTables & { calls: string[]; seen: { changes?: unknown; records?: unknown; forClients?: unknown } } {
  const calls: string[] = [];
  const seen: { changes?: unknown; records?: unknown; forClients?: unknown } = {};
  const note = (name: string) => {
    calls.push(name);
    seed.onPage?.(name);
  };
  return {
    calls,
    seen,
    async minChangeSeq() {
      note('min');
      return seed.minSeq ?? null;
    },
    async changesAfter(input) {
      note('changes');
      seen.changes = input;
      return seed.changes ?? [];
    },
    async recordsAfter(input) {
      note('records');
      seen.records = input;
      return seed.records ?? [];
    },
    async recordsForClients(input) {
      note('forClients');
      seen.forClients = input;
      return seed.forClients ?? [];
    },
  };
}

function localSet() {
  return [{ clientEntityId: 'ticket-1', entityType: 'ticket', payload: { title: 'keep-me' } }];
}

function assertResnapshot(page: PullSyncTablesResult, local: ReturnType<typeof localSet>) {
  expect(page).toEqual({ resnapshotRequired: true });
  expect(Object.keys(page)).toEqual(['resnapshotRequired']);
  expect(page).not.toHaveProperty('changes');
  expect(page).not.toHaveProperty('records');
  expect(page).not.toHaveProperty('cursor');
  const applied = applyServerPullLocally(local, page);
  expect(applied.applied).toBe(false);
  expect(applied.records).toBe(local);
  expect(applied.records[0]?.payload).toEqual({ title: 'keep-me' });
  expect(JSON.stringify(applied)).not.toContain(SECRET);
}

describe('sync pull reads sync_changes and sync_records through the cursor codec', () => {
  it('renders a sync_changes read bounded by the decoded delta seq', () => {
    const cursor = delta(7);
    const decoded = decodeSyncCursor(cursor);
    expect(decoded).toEqual({ v: 1, kind: 'delta', seq: 7 });
    const { sql, params } = changesAfterCursorQuery(db, {
      tenantId: 3,
      destinationKey: 'bound:1',
      afterSeq: decoded && decoded.kind === 'delta' ? decoded.seq : -1,
      limit: 500,
    }).toSQL();
    expect(sql).toContain('sync_changes');
    expect(sql).toContain('tenant_id');
    expect(sql).not.toContain(cursor);
    expect(params).toEqual(expect.arrayContaining([3, 'bound:1', 7, 500]));
  });

  it('renders a sync_records keyset read from the decoded snapshot cursor', () => {
    const cursor = snapshot('ticket', 'ticket-1');
    const decoded = decodeSyncCursor(cursor);
    expect(decoded?.kind).toBe('snapshot');
    if (!decoded || decoded.kind !== 'snapshot') throw new Error('expected a snapshot cursor');
    const { sql, params } = recordsAfterCursorQuery(db, {
      tenantId: 3,
      destinationKey: 'bound:1',
      afterEntityType: decoded.afterEntityType,
      afterClientEntityId: decoded.afterClientEntityId,
      limit: 25,
    }).toSQL();
    expect(sql).toContain('sync_records');
    expect(sql).toContain('tenant_id');
    expect(sql).not.toContain(cursor);
    expect(params).toEqual(expect.arrayContaining([3, 'bound:1', 'ticket', 'ticket-1', 25]));
  });

  it('renders the projection read and the retention read against the two tables', () => {
    const recordsSql = recordsForClientsQuery(db, {
      tenantId: 3,
      destinationKey: null,
      clientEntityIds: ['ticket-1'],
      limit: 500,
    }).toSQL();
    expect(recordsSql.sql).toContain('sync_records');
    expect(recordsSql.params).toEqual(expect.arrayContaining([3, 'ticket-1']));

    const minSql = minChangeSeqQuery(db, 3, 'bound:1').toSQL();
    expect(minSql.sql).toContain('sync_changes');
    expect(minSql.sql.toLowerCase()).toContain('min(');
    expect(minSql.params).toEqual(expect.arrayContaining([3, 'bound:1']));
  });

  it('passes the codec seq into the change read, not the opaque token', async () => {
    const cursor = delta(7);
    const tables = source({ minSeq: 1, changes: [change({ seq: 9 })] });
    const page = await pullSyncTables(tables, { tenantId: 3, cursor, destinationKey: 'bound:1', limit: 2 });
    expect(tables.seen.changes).toEqual({ tenantId: 3, destinationKey: 'bound:1', afterSeq: 7, limit: 2 });
    expect(JSON.stringify(tables.seen.changes)).not.toContain(cursor);
    if (page.resnapshotRequired) throw new Error('expected a page');
    expect(page.cursor).toBe(encodeSyncCursor({ v: 1, kind: 'delta', seq: 9 }));
    expect(decodeSyncCursor(page.cursor)).toEqual({ v: 1, kind: 'delta', seq: 9 });
  });

  it('passes the codec keyset into the sync_records read', async () => {
    const cursor = snapshot('chat', 'chat-0');
    const tables = source({ records: [record({ entityType: 'ticket', clientEntityId: 'ticket-9', payload: { title: 'next' } })] });
    const page = await pullSyncTables(tables, { tenantId: 3, cursor, destinationKey: 'bound:1' });
    expect(tables.calls).toEqual(['records']);
    expect(tables.seen.records).toMatchObject({ afterEntityType: 'chat', afterClientEntityId: 'chat-0' });
    if (page.resnapshotRequired) throw new Error('expected a page');
    expect(page.cursor).toBe(encodeSyncCursor({ v: 1, kind: 'snapshot', afterEntityType: 'ticket', afterClientEntityId: 'ticket-9' }));
    expect(page.records).toEqual([{ op: 'upsert', clientEntityId: 'ticket-9', entityType: 'ticket', payload: { title: 'next' }, version: 2 }]);
  });
});

describe('a tombstone deletes the local record and does not merge its body', () => {
  it('deletes a local record for a sync_changes delete and drops the body', async () => {
    const tables = source({
      minSeq: 1,
      changes: [change({ operation: 'delete', record: { payload: { title: SECRET }, deletedAt: DELETED_AT } })],
    });
    const local = localSet();
    const page = await pullSyncTables(tables, { tenantId: 1, cursor: delta(4), destinationKey: 'bound:1' });
    if (page.resnapshotRequired) throw new Error('expected a page');
    expect(page.changes).toEqual([{
      op: 'delete',
      clientEntityId: 'ticket-1',
      entityType: 'ticket',
      seq: 8,
      deletedAt: DELETED_AT,
    }]);
    expect(page.changes[0]).not.toHaveProperty('payload');
    expect(JSON.stringify(page)).not.toContain(SECRET);
    const applied = applyServerPullLocally(local, page);
    expect(applied.applied).toBe(true);
    expect(applied.records).toEqual([]);
    expect(local).toEqual(localSet());
    expect(JSON.stringify(applied)).not.toContain(SECRET);
  });

  it('treats a non-blank deletedAt on an upsert change as a tombstone', async () => {
    const tables = source({
      minSeq: 1,
      changes: [change({ operation: 'upsert', record: { payload: { title: SECRET }, deletedAt: DELETED_AT } })],
    });
    const page = await pullSyncTables(tables, { tenantId: 1, cursor: delta(4) });
    const applied = applyServerPullLocally(localSet(), page);
    expect(applied.records).toEqual([]);
    expect(JSON.stringify(page)).not.toContain(SECRET);
  });

  it('deletes a local record for a sync_records tombstone on a snapshot page', async () => {
    const tables = source({
      records: [record({ deletedAt: DELETED_AT, payload: { title: SECRET } })],
    });
    const page = await pullSyncTables(tables, { tenantId: 1, cursor: snapshot('', '') });
    if (page.resnapshotRequired) throw new Error('expected a page');
    expect(page.records).toEqual([{
      op: 'delete',
      clientEntityId: 'ticket-1',
      entityType: 'ticket',
      deletedAt: DELETED_AT,
    }]);
    expect(page.records[0]).not.toHaveProperty('payload');
    const applied = applyServerPullLocally(localSet(), page);
    expect(applied.records).toEqual([]);
    expect(JSON.stringify(page)).not.toContain(SECRET);
    expect(JSON.stringify(applied)).not.toContain(SECRET);
  });

  it('a projection tombstone deletes even when the change row still carries a body', async () => {
    const tables = source({
      minSeq: 1,
      changes: [change({ operation: 'upsert', record: { payload: { title: SECRET } } })],
      forClients: [record({ deletedAt: new Date(DELETED_AT), payload: { title: SECRET } })],
    });
    const page = await pullSyncTables(tables, { tenantId: 1, cursor: delta(4), destinationKey: 'bound:1' });
    expect(tables.calls).toEqual(['min', 'changes', 'forClients']);
    if (page.resnapshotRequired) throw new Error('expected a page');
    expect(page.changes[0]?.op).toBe('delete');
    expect(page.changes[0]).not.toHaveProperty('payload');
    expect(applyServerPullLocally(localSet(), page).records).toEqual([]);
    expect(JSON.stringify(page)).not.toContain(SECRET);
  });

  it('does not tombstone a different entity type that shares the client id', async () => {
    const tables = source({
      minSeq: 1,
      changes: [change({ record: { payload: { title: 'ticket-lives' } } })],
      forClients: [record({ entityType: 'chat', deletedAt: DELETED_AT, payload: { title: SECRET } })],
    });
    const page = await pullSyncTables(tables, { tenantId: 1, cursor: delta(4) });
    const applied = applyServerPullLocally(localSet(), page);
    expect(applied.records).toEqual([{
      clientEntityId: 'ticket-1',
      entityType: 'ticket',
      payload: { title: 'ticket-lives' },
    }]);
    expect(JSON.stringify(page)).not.toContain(SECRET);
  });

  it('a later upsert after a tombstone in the same page wins, and the tombstone body is still absent', async () => {
    const tables = source({
      minSeq: 1,
      changes: [
        change({ seq: 6, operation: 'delete', record: { payload: { title: SECRET } } }),
        change({ seq: 7, operation: 'upsert', record: { payload: { title: 'restored' } } }),
      ],
    });
    const applied = applyServerPullLocally(localSet(), await pullSyncTables(tables, { tenantId: 1, cursor: delta(4) }));
    expect(applied.records).toEqual([{
      clientEntityId: 'ticket-1',
      entityType: 'ticket',
      payload: { title: 'restored' },
    }]);
    expect(JSON.stringify(applied)).not.toContain(SECRET);
  });
});

describe('a bad or expired cursor forces resnapshot and does not apply a partial merge', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['blank', '   '],
    ['zero token', '0'],
    ['garbage', 'not-a-cursor'],
  ] as const)('rejects %s before any table read', async (_name, cursor) => {
    const tables = source({
      onPage: () => { throw new Error('must not read a partial page'); },
      changes: [change({ record: { payload: { title: SECRET } } })],
    });
    const local = localSet();
    const page = await pullSyncTables(tables, { tenantId: 1, cursor, destinationKey: 'bound:1' });
    expect(tables.calls).toEqual([]);
    assertResnapshot(page, local);
  });

  it('rejects a future version and a non-integer seq that decodeSyncCursor rejects', async () => {
    const future = rejectable({ v: 2, kind: 'delta', seq: 1 });
    const fractional = rejectable({ v: 1, kind: 'delta', seq: 1.5 });
    expect(decodeSyncCursor(future)).toBeNull();
    expect(decodeSyncCursor(fractional)).toBeNull();
    const tables = source({ onPage: () => { throw new Error('must not read a partial page'); } });
    const local = localSet();
    assertResnapshot(await pullSyncTables(tables, { tenantId: 1, cursor: future }), local);
    assertResnapshot(await pullSyncTables(tables, { tenantId: 1, cursor: fractional }), local);
    expect(tables.calls).toEqual([]);
  });

  it('an expired flag returns resnapshot and does not read the page', async () => {
    const tables = source({
      onPage: () => { throw new Error('must not read a partial page'); },
      changes: [change({ record: { payload: { title: SECRET } } })],
    });
    const local = localSet();
    const page = await pullSyncTables(tables, { tenantId: 1, cursor: delta(4), expired: true });
    expect(tables.calls).toEqual([]);
    assertResnapshot(page, local);
  });

  it('a retention gap is expired and does not return the rows still in the source', async () => {
    const tables = source({
      minSeq: 10,
      changes: [change({ seq: 11, record: { payload: { title: SECRET } } })],
      onPage: (name) => {
        if (name !== 'min') throw new Error('must not read a partial page');
      },
    });
    const local = localSet();
    const page = await pullSyncTables(tables, { tenantId: 1, cursor: delta(4), destinationKey: 'bound:1' });
    expect(tables.calls).toEqual(['min']);
    assertResnapshot(page, local);
  });

  it('an empty log with a cursor past zero is expired', async () => {
    const tables = source({
      minSeq: null,
      onPage: (name) => {
        if (name !== 'min') throw new Error('must not read a partial page');
      },
    });
    const page = await pullSyncTables(tables, { tenantId: 1, cursor: delta(5) });
    expect(tables.calls).toEqual(['min']);
    assertResnapshot(page, localSet());
  });

  it('a contiguous window is not expired and does not resnapshot', async () => {
    const tables = source({ minSeq: 5, changes: [] });
    const page = await pullSyncTables(tables, { tenantId: 1, cursor: delta(4), destinationKey: 'bound:1' });
    expect(tables.calls).toEqual(['min', 'changes']);
    if (page.resnapshotRequired) throw new Error('expected an empty page, not a resnapshot');
    expect(page.changes).toEqual([]);
    expect(page.cursor).toBe(delta(4));
  });

  it('seq 0 against an empty log is an empty page, not a resnapshot and not a partial merge', async () => {
    const tables = source({ minSeq: null, changes: [] });
    const page = await pullSyncTables(tables, { tenantId: 1, cursor: delta(0) });
    if (page.resnapshotRequired) throw new Error('a zero cursor on an empty log is the start, not a bad cursor');
    expect(page.changes).toEqual([]);
    expect(page.cursor).toBe(delta(0));
    expect(applyServerPullLocally(localSet(), page).records).toEqual(localSet());
  });
});
