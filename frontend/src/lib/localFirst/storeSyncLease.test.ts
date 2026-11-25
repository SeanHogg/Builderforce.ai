// @vitest-environment jsdom
/**
 * The lease on `WebLocalFirstStoreHandle` must let a REAL coordinator commit through the same
 * IndexedDB store. The IndexedDB partition lease did not: it was held for the whole run, so the
 * coordinator's own `transact` waited on it and failed with `local_first_store_busy`.
 */
import { indexedDB } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { createPlatformPolicy, createSyncCoordinator, type EntityDestination, type SyncTransport } from '@builderforce/local-first';
import { openWebLocalFirstStore, type WebLocalFirstStoreHandle } from './store';

const DEST: EntityDestination = { kind: 'bound', platformInstance: 'https://builderforce.example', accountId: 'a', tenantId: 't' };
const AT = '2026-11-24T12:00:00.000Z';
const handles: WebLocalFirstStoreHandle[] = [];
afterEach(() => { for (const handle of handles.splice(0)) handle.store?.close(); });

describe('store handle sync lease with a real coordinator', () => {
  it('pushes, acknowledges and records the mapping without local_first_store_busy', async () => {
    const handle = await openWebLocalFirstStore({ indexedDB, dbName: `lease-${crypto.randomUUID()}`, destination: DEST, deviceId: 'device-lease' });
    handles.push(handle);
    expect(handle.storage.state).toBe('durable');
    const { store, lease } = handle;
    const clientEntityId = crypto.randomUUID();
    await store!.transact((tx) => tx.append({
      idempotencyKey: `project:${clientEntityId}:v1`, clientEntityId, entityType: 'project', operation: 'create',
      schemaVersion: 1, occurredAt: AT, dependsOn: [], destination: DEST, payload: { name: 'p' },
    }));

    const pushed: string[] = [];
    const transport: SyncTransport = {
      async push(batch) {
        pushed.push(...batch.events.map((event) => event.eventId));
        return batch.events.map((event) => ({ eventId: event.eventId, status: 'accepted' as const, receivedAt: AT, serverVersion: 1 }));
      },
      async pull() { return { records: [] }; },
    };
    const coordinator = createSyncCoordinator({
      store: store!, transport, policy: createPlatformPolicy({ synchronize: true }), deviceId: 'device-lease', lease: lease!,
    });

    const summary = await coordinator.synchronize(DEST, { pull: false });

    expect(summary).toMatchObject({ pushed: 1 });
    expect(pushed).toHaveLength(1);
    expect(await store!.read((tx) => tx.pending(DEST))).toEqual([]);
    const mapping = await store!.read((tx) => tx.mapping('project', clientEntityId, DEST));
    expect(mapping?.serverVersion).toBe(1);
  });
});
