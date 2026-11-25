// @vitest-environment jsdom
/** Web work management adopts the one sync driver: opt in, and its journal is pushed. */
import { indexedDB } from 'fake-indexeddb';
import { createPlatformPolicy, type EntityDestination, type HttpSyncFetch } from '@builderforce/local-first';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootLocalWorkManagement, type LocalWorkManagementBoot } from './workManagementBoot';
import { createWebSyncLease } from './webSyncLease';

const DEST: EntityDestination = { kind: 'bound', platformInstance: 'https://builderforce.example', accountId: 'a', tenantId: 't' };
const AT = '2026-11-24T12:00:00.000Z';
const booted: LocalWorkManagementBoot[] = [];
afterEach(() => { for (const boot of booted.splice(0)) boot.close(); });

function syncOptions(fetch: HttpSyncFetch, deviceId: string) {
  return {
    policy: createPlatformPolicy({ synchronize: true }), fetch, baseUrl: 'https://api.example', headers: { authorization: 'Bearer t' },
    events: new EventTarget(), debounceMs: 0, lease: createWebSyncLease({ deviceId, locks: null }), report: () => undefined,
  };
}

describe('work management boot with sync', () => {
  it('pushes a project it files, with no further call from the composer', async () => {
    const sent: string[] = [];
    const fetch: HttpSyncFetch = async (_url, init) => {
      const { events } = JSON.parse(init.body) as { events: Array<{ eventId: string; entityType: string }> };
      sent.push(...events.map((event) => event.entityType));
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ receipts: events.map((event) => ({ eventId: event.eventId, status: 'accepted', receivedAt: AT, serverVersion: 1 })) }),
      };
    };
    const deviceId = `boot-${crypto.randomUUID()}`;
    const boot = await bootLocalWorkManagement({ indexedDB, dbName: `sync-${crypto.randomUUID()}`, deviceId, destination: DEST, sync: syncOptions(fetch, deviceId) });
    booted.push(boot);
    expect(boot.sync).toBeDefined();

    await boot.work!.createProject({ name: 'Pushed' });
    await vi.waitFor(() => expect(sent).toEqual(['project']));
    await vi.waitFor(() => expect(boot.sync!.status().pending).toBe(0));
  });

  it('does not sync unless asked, and never for an unbound destination', async () => {
    const fetch: HttpSyncFetch = async () => { throw new Error('no request expected'); };
    const plain = await bootLocalWorkManagement({ indexedDB, dbName: `sync-${crypto.randomUUID()}`, deviceId: 'd1', destination: DEST });
    const unbound = await bootLocalWorkManagement({ indexedDB, dbName: `sync-${crypto.randomUUID()}`, deviceId: 'd2', sync: syncOptions(fetch, 'd2') });
    booted.push(plain, unbound);
    expect(plain.sync).toBeUndefined();
    expect(unbound.sync).toBeUndefined();
    await unbound.work!.createProject({ name: 'Local only' });
  });
});
