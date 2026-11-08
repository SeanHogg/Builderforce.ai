/**
 * G18 — `handleSyncPull` cursor pages against the in-memory `SyncStores`.
 *
 * The cursor defects this pins shut:
 * (a) a destination with no changes of its own must not resnapshot forever
 *     while the GLOBAL sequence moves — its cursor rides the database `xmin`;
 * (b) a change written while a snapshot pages must still be delivered — the `xmin`
 *     is captured on the FIRST snapshot page and carried in the cursor;
 * (c) that `xmin` is one read (`databaseXmin`), never a walk of the log;
 * (d) a transaction that commits LATE (its seq is lower than an already-delivered
 *     one) is delivered, not skipped — the cursor is the commit-ordered (txid, seq);
 * (e) a legacy (seq only) cursor S resumes at ('0', S) (re-delivering real-txid rows,
 *     harmless), and resnapshots only when the expiry check says the rows were swept.
 */

import { describe, expect, it, vi } from 'vitest';
import { decodeSyncCursor } from '../../domain/sync/cursorCodec';
import { SYNC_PROTOCOL_VERSION, hashSyncPayload, type EntityDestination } from '../../domain/sync/syncProtocol';
import { createMemorySyncStores, type MemorySyncStores } from './__fixtures__/memorySyncStores';
import { handleSyncPull } from './handleSyncPull';
import { handleSyncPush } from './handleSyncPush';
import { normalisedKeyOf } from './syncDestination';
import type { SyncMutationImporter, SyncNamedImporters } from './syncPorts';

const T0 = new Date('2026-02-01T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const AUTH = { tenantId: 7, userId: 'user-7', role: 'developer' };
const A: EntityDestination = { kind: 'bound', tenantId: '7', repository: 'repo-a' };
const B: EntityDestination = { kind: 'bound', tenantId: '7', repository: 'repo-b' };

/** Applies everything; an existing mapping bumps the version. */
const apply: SyncMutationImporter = async (event, ctx, stores) => {
  const mapping = await stores.findMapping(ctx.auth.tenantId, event.entityType, event.clientEntityId);
  return {
    status: 'applied',
    serverId: mapping?.serverId ?? event.clientEntityId,
    serverVersion: (mapping?.serverVersion ?? 0) + 1,
    payloadHash: hashSyncPayload(event.payload),
    destinationKey: ctx.destinationKey,
    payload: event.payload,
  };
};
const IMPORTERS: SyncNamedImporters = {
  importSyncedTicket: apply,
  importSyncedProject: apply,
  importSyncedChat: apply,
  importSyncedMessage: apply,
  importSyncedUsage: apply,
  importSyncedChatTicketLink: apply,
  importMirrorRecord: apply,
};

/** A v1 cursor as a pre-1304 server minted it (the codec no longer mints one). */
const forge = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const legacyCursor = (seq: number) => forge({ v: 1, kind: 'delta', seq, issuedAt: T0.getTime() });

let counter = 0;
const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

function harness() {
  let now = T0;
  const stores: MemorySyncStores = createMemorySyncStores({ importers: IMPORTERS, now: () => now });
  const deps = () => ({ auth: AUTH, now, stores });
  return {
    stores,
    setNow(next: Date) {
      now = next;
    },
    async write(destination: EntityDestination, clientEntityId: string, title: string, operation = 'create', baseVersion?: number) {
      counter += 1;
      const payload = { title };
      const response = await handleSyncPush({
        batchId: `b-${counter}`,
        protocolVersion: SYNC_PROTOCOL_VERSION,
        deviceId: 'device-a',
        destination,
        events: [{
          eventId: uuid(counter),
          clientEntityId,
          entityType: 'chat',
          operation,
          schemaVersion: 1,
          localSequence: counter,
          occurredAt: T0.toISOString(),
          ...(baseVersion !== undefined ? { baseVersion } : {}),
          dependsOn: [],
          destination,
          payload,
          payloadHash: hashSyncPayload(payload),
        }],
      }, deps());
      expect(response.ok && response.receipts[0]?.status).toBe('accepted');
    },
    pull: (body: Record<string, unknown>) => handleSyncPull(body, deps()),
  };
}

const C1 = 'aaaaaaa1-0000-4000-8000-000000000000';
const C2 = 'aaaaaaa2-0000-4000-8000-000000000000';
const C3 = 'aaaaaaa3-0000-4000-8000-000000000000';
const C4 = 'aaaaaaa4-0000-4000-8000-000000000000';

describe('handleSyncPull — snapshot, then delta', () => {
  it('serves a snapshot first, then only the changes after the cursor', async () => {
    const h = harness();
    await h.write(A, C1, 'one');
    await h.write(A, C2, 'two');

    const first = await h.pull({ destination: A, limit: 50 });
    expect(first.ok && first.result.records.map((r) => r.id)).toEqual([C1, C2]);
    const cursor = first.ok ? first.result.cursor : undefined;
    // Two committed transactions (txid 100, 101): the snapshot hands over at (xmin = 102, 0).
    expect(decodeSyncCursor(cursor)).toMatchObject({ v: 2, kind: 'delta', txid: '102', seq: 0 });

    await h.write(A, C3, 'three');
    const delta = await h.pull({ destination: A, cursor, limit: 50 });
    expect(delta.ok && delta.result.records.map((r) => r.id)).toEqual([C3]);
    expect(delta.ok && delta.result.resnapshotRequired).toBeFalsy();
  });

  it('(a) moves an idle destination with the database xmin instead of resnapshotting forever', async () => {
    const h = harness();
    await h.write(A, C1, 'one');
    const first = await h.pull({ destination: B, limit: 50 });
    expect(first.ok && first.result.records).toEqual([]);
    let cursor = first.ok ? first.result.cursor : undefined;

    // Other tenants and other destinations keep writing for weeks.
    for (let day = 1; day <= 3; day += 1) {
      h.stores.advanceGlobalSeq(1_000);
      await h.write(A, uuid(9_000 + day), `a-${day}`);
      h.setNow(new Date(T0.getTime() + day * 7 * DAY));
      const next = await h.pull({ destination: B, cursor, limit: 50 });
      expect(next.ok && next.result.resnapshotRequired).toBeFalsy();
      expect(next.ok && next.result.records).toEqual([]);
      cursor = next.ok ? next.result.cursor : undefined;
    }
    expect(decodeSyncCursor(cursor)).toMatchObject({ kind: 'delta', txid: await h.stores.databaseXmin(), seq: 0 });

    await h.write(B, C2, 'finally');
    const caught = await h.pull({ destination: B, cursor, limit: 50 });
    expect(caught.ok && caught.result.records.map((r) => r.id)).toEqual([C2]);
  });

  it('(b) delivers a change written while the snapshot was paging', async () => {
    const h = harness();
    await h.write(A, C1, 'one');
    await h.write(A, C2, 'two');
    await h.write(A, C3, 'three');

    const page1 = await h.pull({ destination: A, limit: 2 });
    const snapshotCursor = page1.ok ? page1.result.cursor : undefined;
    expect(decodeSyncCursor(snapshotCursor)).toMatchObject({ kind: 'snapshot', tipTxid: '103' });

    // Written mid-snapshot: an edit to a row ALREADY served, and a new row.
    await h.write(A, C1, 'one, edited', 'update', 1);
    await h.write(A, C4, 'four');

    const page2 = await h.pull({ destination: A, cursor: snapshotCursor, limit: 3 });
    expect(page2.ok && page2.result.records.map((r) => r.id)).toEqual([C3, C4]);
    const handover = page2.ok ? page2.result.cursor : undefined;
    expect(decodeSyncCursor(handover)).toMatchObject({ kind: 'delta', txid: '103', seq: 0 });

    const delta = await h.pull({ destination: A, cursor: handover, limit: 50 });
    expect(delta.ok && delta.result.records.map((r) => [r.id, r.payload])).toEqual([
      [C1, { title: 'one, edited' }],
      [C4, { title: 'four' }],
    ]);
  });

  it('(c) reads the xmin as one read, never by paging the log', async () => {
    const h = harness();
    await h.write(A, C1, 'one');
    const changesAfter = vi.spyOn(h.stores, 'changesAfter');
    const databaseXmin = vi.spyOn(h.stores, 'databaseXmin');
    await h.pull({ destination: A, limit: 50 });
    expect(changesAfter).not.toHaveBeenCalled();
    expect(databaseXmin).toHaveBeenCalledTimes(1);
  });

  it('(d) delivers a change that commits LATE instead of skipping it', async () => {
    const h = harness();
    // A change on ANOTHER destination, only to borrow a well-formed record and destination key.
    await h.write(B, C3, 'template');
    const template = h.stores.state().changes[0]!;
    const start = await h.pull({ destination: A, limit: 50 });
    const cursor0 = start.ok ? start.result.cursor : undefined;

    // A takes the LOWER seq and stays open; B takes the higher seq and commits first.
    const lateWriter = h.stores.beginForeignTransaction();
    const lateSeq = lateWriter.write(7, normalisedKeyOf(A, AUTH)!,{ ...template.record, id: C1 });
    await h.write(A, C2, 'committed first');
    const committedSeq = h.stores.state().changes.at(-1)!.seq;
    expect(committedSeq).toBeGreaterThan(lateSeq);

    // B is above xmin (A holds it back): withheld, not skipped past.
    const first = await h.pull({ destination: A, cursor: cursor0, limit: 50 });
    expect(first.ok && first.result.records).toEqual([]);
    const cursor1 = first.ok ? first.result.cursor : undefined;

    lateWriter.commit();
    const second = await h.pull({ destination: A, cursor: cursor1, limit: 50 });
    expect(second.ok && second.result.records.map((r) => r.id)).toEqual([C1, C2]);

    const third = await h.pull({ destination: A, cursor: second.ok ? second.result.cursor : undefined, limit: 50 });
    expect(third.ok && third.result.records).toEqual([]);
  });

  it('advances a full delta page to its last row, not to the tip', async () => {
    const h = harness();
    const start = await h.pull({ destination: A, limit: 50 });
    const cursor = start.ok ? start.result.cursor : undefined;
    await h.write(A, C1, 'one');
    await h.write(A, C2, 'two');
    await h.write(A, C3, 'three');
    const page = await h.pull({ destination: A, cursor, limit: 2 });
    expect(page.ok && page.result.records.map((r) => r.id)).toEqual([C1, C2]);
    const next = await h.pull({ destination: A, cursor: page.ok ? page.result.cursor : undefined, limit: 2 });
    expect(next.ok && next.result.records.map((r) => r.id)).toEqual([C3]);
  });

  it('serves a deleted entity as a tombstone in the snapshot', async () => {
    const h = harness();
    await h.write(A, C1, 'one');
    await h.write(A, C1, 'gone', 'delete', 1);
    const snapshot = await h.pull({ destination: A, limit: 50 });
    expect(snapshot.ok && snapshot.result.records[0]?.deletedAt).toBe(T0.toISOString());
  });
});

describe('handleSyncPull — expired and foreign cursors resnapshot, never a partial page', () => {
  it('answers a cursor this codec did not mint with a resnapshot', async () => {
    const h = harness();
    for (const cursor of ['not-a-cursor', 42, { seq: 1 }]) {
      const response = await h.pull({ destination: A, cursor, limit: 50 });
      expect(response.ok && response.result).toEqual({ records: [], resnapshotRequired: true });
    }
  });

  it('resnapshots an old cursor whose following rows were swept', async () => {
    const h = harness();
    await h.write(A, C1, 'one');
    const old = legacyCursor(0);
    h.setNow(new Date(T0.getTime() + 45 * DAY));
    h.stores.sweepChanges(new Date(T0.getTime() + 15 * DAY));
    await h.write(A, C2, 'two');
    const response = await h.pull({ destination: A, cursor: old, limit: 50 });
    expect(response.ok && response.result).toEqual({ records: [], resnapshotRequired: true });
  });

  it('keeps serving an old cursor while the destination still retains a row before it', async () => {
    const h = harness();
    await h.write(A, C1, 'one');
    const old = legacyCursor(1);
    h.setNow(new Date(T0.getTime() + 45 * DAY));
    await h.write(A, C2, 'two');
    const response = await h.pull({ destination: A, cursor: old, limit: 50 });
    // A legacy cursor resumes at (0, S): the C1 row (real txid) is re-delivered — harmless, a plain re-put.
    expect(response.ok && response.result.records.map((r) => r.id)).toEqual([C1, C2]);
  });
});

describe('handleSyncPull — a legacy (seq only) cursor is translated to (0, S)', () => {
  it('resumes at (0, S) — never at the txid of the seq row — so a migration-window row whose txid order differs from its seq order is delivered', async () => {
    const h = harness();
    await h.write(B, C3, 'template'); // borrow a well-formed record (txid 100)
    const template = h.stores.state().changes[0]!;
    // The previous Worker wrote with real txids: the LOWER seq (1) commits in the HIGHER txid.
    const slow = h.stores.beginForeignTransaction(); // txid 101
    const lowSeq = slow.write(7, normalisedKeyOf(A, AUTH)!, { ...template.record, id: C1 });
    await h.write(A, C2, 'two'); // txid 102, higher seq
    // Read BEFORE the commit: the committed foreign row is appended last, so it would be `at(-1)` after.
    const highSeq = h.stores.state().changes.at(-1)!.seq;
    expect(lowSeq).toBeLessThan(highSeq);
    slow.commit();

    // The v1 client had been served up to the high seq; translating to that row's txid would skip C1.
    const response = await h.pull({ destination: A, cursor: legacyCursor(highSeq), limit: 50 });
    expect(response.ok && response.result.records.map((r) => r.id)).toEqual([C1, C2]);
    expect(decodeSyncCursor(response.ok ? response.result.cursor : undefined))
      .toMatchObject({ v: 2, kind: 'delta', txid: '103', seq: 0 });
  });

  it('treats seq 0 as the origin: every change is delivered', async () => {
    const h = harness();
    await h.write(A, C1, 'one');
    const response = await h.pull({ destination: A, cursor: legacyCursor(0), limit: 50 });
    expect(response.ok && response.result.records.map((r) => r.id)).toEqual([C1]);
  });

  it('resnapshots a v1 snapshot cursor: its tenant tip has no txid', async () => {
    const h = harness();
    const v1 = forge({ v: 1, kind: 'snapshot', afterEntityType: 'chat', afterClientEntityId: C1, tip: 3, issuedAt: T0.getTime() });
    const response = await h.pull({ destination: A, cursor: v1, limit: 50 });
    expect(response.ok && response.result).toEqual({ records: [], resnapshotRequired: true });
  });
});

describe('handleSyncPull — request and destination checks', () => {
  it('refuses a destination that contradicts the authenticated tenant', async () => {
    const h = harness();
    expect(await h.pull({ destination: { kind: 'bound', tenantId: '999' }, limit: 50 }))
      .toEqual({ ok: false, status: 400, code: 'destination_tenant_mismatch' });
  });

  it('refuses a non-positive limit and clamps an oversized one to the server page', async () => {
    const h = harness();
    expect(await h.pull({ destination: A, limit: 0 })).toEqual({ ok: false, status: 400, code: 'invalid_limit' });
    const snapshotAfter = vi.spyOn(h.stores, 'snapshotAfter');
    const big = await h.pull({ destination: A, limit: 100_000 });
    expect(big.ok).toBe(true);
    expect(snapshotAfter.mock.calls[0]?.[3]).toBe(500);
  });

  it('lets any member read, and refuses a project the tenant does not own', async () => {
    const stores = createMemorySyncStores({ importers: IMPORTERS, references: { projectInTenant: async () => false } });
    const viewer = { ...AUTH, role: 'viewer' };
    expect((await handleSyncPull({ destination: A, limit: 10 }, { auth: viewer, now: T0, stores })).ok).toBe(true);
    expect(await handleSyncPull({ destination: { ...A, projectId: '12' }, limit: 10 }, { auth: viewer, now: T0, stores }))
      .toEqual({ ok: false, status: 400, code: 'destination_project_invalid' });
  });
});
