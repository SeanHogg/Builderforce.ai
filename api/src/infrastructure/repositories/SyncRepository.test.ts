/**
 * The Drizzle `SyncStores` adapter — the seams the use-case tests cannot see:
 * every read is tenant-scoped, the delta page reads in commit-ordered
 * (txid, seq) below xmin in ONE statement, the destination reads filter by
 * destination, and `transact` opens one transaction per batch whose savepoint
 * hands the importers the transaction handle the sync stores write through.
 */

import { describe, expect, it, vi } from 'vitest';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { fakeDb, whereColumns } from '../../../test/fakeDb';
import type { SyncNamedImporters, SyncReferenceReader } from '../../application/sync/syncPorts';
import type { Db, Tx } from '../database/connection';
import { createSyncRepository } from './SyncRepository';

vi.mock('../../application/observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

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
    importSyncedChatTicketLink: refuse,
    importMirrorRecord: refuse,
  };
};

function repo(results: Array<unknown[] | Error> = [], importersFor = (_tx: Tx) => noImporters()) {
  const db = fakeDb(results);
  return { db, stores: createSyncRepository(db as unknown as Db, importersFor, references) };
}

/** `db.execute` resolves to `{ rows }`; the fake hands back the queued value as-is. */
const rowsResult = (rows: unknown[]) => Object.assign([], { rows });

/** The literal SQL text of a Drizzle `sql` statement (column and parameter chunks are skipped). */
function sqlText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const record = node as { queryChunks?: unknown[]; value?: unknown };
  if (Array.isArray(record.queryChunks)) return record.queryChunks.map(sqlText).join('');
  if (Array.isArray(record.value) && record.value.every((part) => typeof part === 'string')) return record.value.join('');
  return '';
}

describe('SyncRepository — pull reads', () => {
  it('reads the database xmin in one statement', async () => {
    const { db, stores } = repo([rowsResult([{ xmin: '4242' }])]);
    expect(await stores.databaseXmin()).toBe('4242');
    expect(db.calls).toHaveLength(1);
    expect(sqlText(db.calls[0]?.args[0])).toContain('pg_snapshot_xmin(pg_current_snapshot())');
  });

  it('scopes the per-destination minimum watermark by tenant and destination', async () => {
    const { db, stores } = repo([[{ txid: '100', seq: 4 }]]);
    expect(await stores.minChangeWatermark(7, 'k')).toEqual({ txid: '100', seq: 4 });
    expect(whereColumns(db.calls[0]?.where)).toEqual(expect.arrayContaining(['tenant_id', 'destination_key']));
    // The minimum is the first row in WATERMARK order, not MIN(seq).
    expect(db.calls[0]?.chain).toEqual(['from', 'where', 'orderBy', 'limit']);
    expect(db.calls[0]?.orderBy).toHaveLength(2);
  });

  it('answers null when the destination has no retained row', async () => {
    const { stores } = repo([[]]);
    expect(await stores.minChangeWatermark(7, 'k')).toBeNull();
  });

  it('reports a long-held xmin (age over the threshold) through the caught-error seam, once per page', async () => {
    const { stores } = repo([rowsResult([{ xmin: '900', xmin_age: '50000', txid: null, seq: null, record: null }])]);
    const page = await stores.changesAfter(7, 'k', { txid: '0', seq: 0 }, 10);
    expect(page.xmin).toBe('900');
    expect(reportCaughtError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: 'syncPull:xminHeldBack', level: 'warning' }),
    );
  });

  it('stays quiet when the xmin is fresh', async () => {
    vi.mocked(reportCaughtError).mockClear();
    const { stores } = repo([rowsResult([{ xmin: '900', xmin_age: '12', txid: null, seq: null, record: null }])]);
    await stores.changesAfter(7, 'k', { txid: '0', seq: 0 }, 10);
    expect(reportCaughtError).not.toHaveBeenCalled();
  });

  it('reads a delta page in (txid, seq) order below xmin, tenant- and destination-scoped, with xmin from the same statement', async () => {
    const record = { id: 'c', entityType: 'chat' };
    const { db, stores } = repo([rowsResult([{ xmin: '900', txid: '100', seq: '5', record }])]);
    expect(await stores.changesAfter(7, 'k', { txid: '90', seq: 4 }, 10))
      .toEqual({ rows: [{ txid: '100', seq: 5, record }], xmin: '900' });
    expect(db.calls).toHaveLength(1);
    const call = db.calls[0]!;
    expect(call.kind).toBe('execute');
    expect(whereColumns(call.args[0])).toEqual(
      expect.arrayContaining(['tenant_id', 'destination_key', 'txid', 'seq']),
    );
    const text = sqlText(call.args[0]);
    expect(text).toContain('> (');
    expect(text).toContain('::xid8');
    expect(text).toContain('< x.xmin');
    expect(text).toContain('pg_snapshot_xmin(pg_current_snapshot())');
    expect(text).toMatch(/ORDER BY[\s\S]*LIMIT/);
  });

  it('keeps the xmin when the page is empty (the LEFT JOIN row has null columns)', async () => {
    const { stores } = repo([rowsResult([{ xmin: '900', txid: null, seq: null, record: null }])]);
    expect(await stores.changesAfter(7, 'k', { txid: '0', seq: 0 }, 10)).toEqual({ rows: [], xmin: '900' });
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

  it('opens ONE transaction for the batch and a nested transaction (SAVEPOINT) per event', async () => {
    const seen: unknown[] = [];
    const { db, stores } = repo([[]], (tx) => {
      seen.push(tx);
      return noImporters();
    });
    const transaction = vi.spyOn(db, 'transaction');
    await stores.transact(async (batch) => {
      await batch.savepoint(async ({ stores: tx }) => {
        await tx.insertEvent({
          tenantId: 7, deviceId: 'd', eventId: 'e', batchId: 'b', clientEntityId: 'c', entityType: 'chat',
          operation: 'create', schemaVersion: 1, localSequence: 1, occurredAt: new Date(0), receivedAt: new Date(0),
          baseVersion: null, dependsOn: [], destination: {}, payload: {}, payloadHash: 'h', status: 'accepted',
          serverId: 'c', serverVersion: 1, detail: null,
        });
      });
    });
    expect(transaction).toHaveBeenCalledTimes(2);
    // Importers are bound to the batch handle once and to each savepoint handle.
    expect(seen).toHaveLength(2);
    expect(db.calls.map((c) => c.kind)).toEqual(['insert']);
  });

  it('rolls a savepoint back by rethrowing, leaving the batch usable', async () => {
    const { stores } = repo([[]]);
    const outcome = await stores.transact(async (batch) => {
      const failure = await batch.savepoint(async () => { throw new Error('event failed'); }).catch((error: Error) => error);
      const after = await batch.savepoint(async () => 'next event ran');
      return { failure: (failure as Error).message, after };
    });
    expect(outcome).toEqual({ failure: 'event failed', after: 'next event ran' });
  });

  it('binds the chat-ownership reader to the batch transaction when one is supplied', async () => {
    const inTx: SyncReferenceReader = { ...references, chatOwnedBy: async () => false };
    const db = fakeDb([]);
    const stores = createSyncRepository(db as unknown as Db, () => noImporters(), references, () => inTx);
    await stores.transact(async (batch) => {
      expect(batch.references).toBe(inTx);
    });
    expect(stores.references).toBe(references);
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
