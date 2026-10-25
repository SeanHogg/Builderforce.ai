/**
 * The Drizzle `SyncStores` adapter — the seams the use-case tests cannot see:
 * every read is tenant-scoped, the tip is ONE aggregate, the destination reads
 * filter by destination, and `transact` hands the importers the SAME
 * transaction handle the sync stores write through.
 */

import { describe, expect, it } from 'vitest';
import { fakeDb, whereColumns } from '../../../test/fakeDb';
import type { SyncNamedImporters, SyncReferenceReader } from '../../application/sync/syncPorts';
import type { Db, Tx } from '../database/connection';
import { createSyncRepository } from './SyncRepository';

const references: SyncReferenceReader = {
  projectInTenant: async () => true,
  taskInTenant: async () => true,
  tenantMember: async () => true,
  chatOwnedBy: async () => true,
};

const noImporters = (): SyncNamedImporters => {
  const refuse = async () => ({ status: 'rejected' as const, detail: 'unused' });
  return {
    importSyncedTicket: refuse,
    importSyncedProject: refuse,
    importSyncedChat: refuse,
    importSyncedMessage: refuse,
    importSyncedUsage: refuse,
    importMirrorRecord: refuse,
  };
};

function repo(results: Array<unknown[] | Error> = [], importersFor = (_tx: Tx) => noImporters()) {
  const db = fakeDb(results);
  return { db, stores: createSyncRepository(db as unknown as Db, importersFor, references) };
}

describe('SyncRepository — pull reads', () => {
  it('reads the tenant tip as one MAX aggregate, 0 when the log is empty', async () => {
    const { db, stores } = repo([[{ seq: '12' }], [{ seq: null }]]);
    expect(await stores.maxChangeSeq(7)).toBe(12);
    expect(await stores.maxChangeSeq(7)).toBe(0);
    expect(db.calls).toHaveLength(2);
    expect(whereColumns(db.calls[0]?.where)).toEqual(['tenant_id']);
    expect(db.calls[0]?.chain).not.toContain('limit');
  });

  it('scopes the per-destination minimum and delta page by tenant AND destination', async () => {
    const record = { id: 'c', entityType: 'chat' };
    const { db, stores } = repo([[{ seq: 4 }], [{ seq: 5, record }]]);
    expect(await stores.minChangeSeq(7, 'k')).toBe(4);
    expect(await stores.changesAfter(7, 'k', 4, 10)).toEqual([{ seq: 5, record }]);
    for (const call of db.calls) {
      expect(whereColumns(call.where)).toEqual(expect.arrayContaining(['tenant_id', 'destination_key']));
    }
    expect(db.calls[1]?.chain).toEqual(['from', 'where', 'orderBy', 'limit']);
  });

  it('keysets the snapshot after the last served pair, tenant- and destination-scoped', async () => {
    const { db, stores } = repo([[]]);
    await stores.snapshotAfter(7, 'k', { entityType: 'chat', clientEntityId: 'b' }, 25);
    expect(whereColumns(db.calls[0]?.where)).toEqual(
      expect.arrayContaining(['tenant_id', 'destination_key', 'entity_type', 'client_entity_id']),
    );
  });
});

describe('SyncRepository — the unit of work', () => {
  it('hands the importers the same transaction the stores write through', async () => {
    const seen: unknown[] = [];
    const { db, stores } = repo([[]], (tx) => {
      seen.push(tx);
      return noImporters();
    });
    await stores.transact(async ({ stores: tx }) => {
      await tx.insertEvent({
        tenantId: 7, deviceId: 'd', eventId: 'e', batchId: 'b', clientEntityId: 'c', entityType: 'chat',
        operation: 'create', schemaVersion: 1, localSequence: 1, occurredAt: new Date(0), receivedAt: new Date(0),
        baseVersion: null, dependsOn: [], destination: {}, payload: {}, payloadHash: 'h', status: 'accepted',
        serverId: 'c', serverVersion: 1, detail: null,
      });
    });
    // `inTransaction` on a handle without a connection string uses its own
    // `transaction()`, which the double runs against itself.
    expect(seen).toEqual([db]);
    expect(db.calls.map((c) => c.kind)).toEqual(['insert']);
    expect(db.calls[0]?.payload).toMatchObject({ tenantId: 7, eventId: 'e', status: 'accepted', payloadHash: 'h' });
  });

  it('upserts mapping and projection on their unique keys', async () => {
    const { db, stores } = repo([[], []]);
    await stores.transact(async ({ stores: tx }) => {
      await tx.upsertMapping({
        tenantId: 7, entityType: 'chat', clientEntityId: 'c', serverId: 's', serverVersion: 2,
        destinationKey: 'k', payloadHash: 'h', createdByDevice: 'd', now: new Date(0),
      });
      await tx.upsertRecord({
        tenantId: 7, entityType: 'chat', clientEntityId: 'c', serverId: 's', schemaVersion: 1, version: 2,
        destinationKey: 'k', occurredAt: new Date(0), updatedAt: new Date(0), deletedAt: null, payload: {},
        provenance: {}, receivedAt: new Date(0), payloadHash: 'h',
      });
    });
    expect(db.calls.map((c) => c.chain)).toEqual([['values', 'onConflictDoUpdate'], ['values', 'onConflictDoUpdate']]);
  });

  it('reads a mapping with the projection tombstone, tenant-scoped', async () => {
    const deletedAt = new Date(5);
    const { db, stores } = repo([[{ serverId: '9', serverVersion: 3, payloadHash: 'h', destinationKey: 'k', deletedAt }]]);
    expect(await stores.findMapping(7, 'ticket', 'c')).toEqual({ serverId: '9', serverVersion: 3, payloadHash: 'h', destinationKey: 'k', deletedAt });
    expect(db.calls[0]?.chain).toContain('leftJoin');
    expect(whereColumns(db.calls[0]?.where)).toEqual(expect.arrayContaining(['tenant_id', 'entity_type', 'client_entity_id']));
  });

  it('answers no accepted ids without a query for an empty list', async () => {
    const { db, stores } = repo();
    expect(await stores.acceptedEventIds(7, [])).toEqual(new Set());
    expect(db.calls).toHaveLength(0);
  });
});
