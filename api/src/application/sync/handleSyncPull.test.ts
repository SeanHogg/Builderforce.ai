/**
 * G18 — `handleSyncPull` cursor pages against the in-memory `SyncStores`.
 *
 * The three cursor defects this pins shut:
 * (a) a destination with no changes of its own must not resnapshot forever
 *     while the GLOBAL sequence moves — its cursor rides the tenant tip;
 * (b) a change written while a snapshot pages must still be delivered — the tip
 *     is captured on the FIRST snapshot page and carried in the cursor;
 * (c) the tip is one aggregate (`maxChangeSeq`), never a walk of the log.
 */

import { describe, expect, it, vi } from 'vitest';
import { decodeSyncCursor, encodeSyncCursor } from '../../domain/sync/cursorCodec';
import { SYNC_PROTOCOL_VERSION, hashSyncPayload, type EntityDestination } from '../../domain/sync/syncProtocol';
import { createMemorySyncStores, type MemorySyncStores } from './__fixtures__/memorySyncStores';
import { handleSyncPull } from './handleSyncPull';
import { handleSyncPush } from './handleSyncPush';
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
const IMPORTERS: SyncNamedImporters = { importSyncedTicket: apply, importSyncedProject: apply, importMirrorRecord: apply };

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
    expect(decodeSyncCursor(cursor)).toMatchObject({ kind: 'delta', seq: 2 });

    await h.write(A, C3, 'three');
    const delta = await h.pull({ destination: A, cursor, limit: 50 });
    expect(delta.ok && delta.result.records.map((r) => r.id)).toEqual([C3]);
    expect(delta.ok && delta.result.resnapshotRequired).toBeFalsy();
  });

  it('(a) moves an idle destination with the tenant tip instead of resnapshotting forever', async () => {
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
    expect(decodeSyncCursor(cursor)).toMatchObject({ kind: 'delta', seq: await h.stores.maxChangeSeq(7) });

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
    expect(decodeSyncCursor(snapshotCursor)).toMatchObject({ kind: 'snapshot', tip: 3 });

    // Written mid-snapshot: an edit to a row ALREADY served, and a new row.
    await h.write(A, C1, 'one, edited', 'update', 1);
    await h.write(A, C4, 'four');

    const page2 = await h.pull({ destination: A, cursor: snapshotCursor, limit: 3 });
    expect(page2.ok && page2.result.records.map((r) => r.id)).toEqual([C3, C4]);
    const handover = page2.ok ? page2.result.cursor : undefined;
    expect(decodeSyncCursor(handover)).toMatchObject({ kind: 'delta', seq: 3 });

    const delta = await h.pull({ destination: A, cursor: handover, limit: 50 });
    expect(delta.ok && delta.result.records.map((r) => [r.id, r.payload])).toEqual([
      [C1, { title: 'one, edited' }],
      [C4, { title: 'four' }],
    ]);
  });

  it('(c) reads the tip as one aggregate, never by paging the log', async () => {
    const h = harness();
    await h.write(A, C1, 'one');
    const changesAfter = vi.spyOn(h.stores, 'changesAfter');
    const maxChangeSeq = vi.spyOn(h.stores, 'maxChangeSeq');
    await h.pull({ destination: A, limit: 50 });
    expect(changesAfter).not.toHaveBeenCalled();
    expect(maxChangeSeq).toHaveBeenCalledTimes(1);
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
    const old = encodeSyncCursor({ v: 1, kind: 'delta', seq: 0, issuedAt: T0.getTime() });
    h.setNow(new Date(T0.getTime() + 45 * DAY));
    h.stores.sweepChanges(new Date(T0.getTime() + 15 * DAY));
    await h.write(A, C2, 'two');
    const response = await h.pull({ destination: A, cursor: old, limit: 50 });
    expect(response.ok && response.result).toEqual({ records: [], resnapshotRequired: true });
  });

  it('keeps serving an old cursor while the destination still retains a row before it', async () => {
    const h = harness();
    await h.write(A, C1, 'one');
    const old = encodeSyncCursor({ v: 1, kind: 'delta', seq: 1, issuedAt: T0.getTime() });
    h.setNow(new Date(T0.getTime() + 45 * DAY));
    await h.write(A, C2, 'two');
    const response = await h.pull({ destination: A, cursor: old, limit: 50 });
    expect(response.ok && response.result.records.map((r) => r.id)).toEqual([C2]);
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
