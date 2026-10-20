/**
 * /api/sync/v1 routes — the HTTP edge only: the tenant comes from the token,
 * the body is read without trusting it, and the response envelope is what
 * `packages/local-first/src/httpSyncTransport.ts` reads.
 */

import { describe, expect, it, vi } from 'vitest';
import { SYNC_PROTOCOL_VERSION, hashSyncPayload } from '../../domain/sync/syncProtocol';
import { createMemorySyncStores } from '../../application/sync/__fixtures__/memorySyncStores';
import type { SyncMutationImporter } from '../../application/sync/syncPorts';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set('tenantId', 7);
    c.set('userId', 'user-7');
    c.set('role', 'developer');
    await next();
  },
}));

const DB = { handle: 'request-db' };
vi.mock('../../application/shared/dbHandle', () => ({ requestDb: () => DB }));

import { SYNC_PULL_PATH, SYNC_PUSH_PATH, SYNC_ROUTE_BASE, createSyncRoutes } from './syncRoutes';

const apply: SyncMutationImporter = async (event, ctx) => ({
  status: 'applied',
  serverId: event.clientEntityId,
  serverVersion: 1,
  payloadHash: hashSyncPayload(event.payload),
  destinationKey: ctx.destinationKey,
  payload: event.payload,
});

function app() {
  const stores = createMemorySyncStores({
    importers: { importSyncedTicket: apply, importSyncedProject: apply, importMirrorRecord: apply },
  });
  const seen: unknown[] = [];
  const routes = createSyncRoutes((db) => {
    seen.push(db);
    return stores;
  });
  return { routes, stores, seen };
}

const post = (routes: ReturnType<typeof app>['routes'], path: string, body: unknown) =>
  routes.request(path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('sync routes', () => {
  it('mounts push and pull under /api/sync/v1', () => {
    expect([SYNC_ROUTE_BASE, SYNC_PUSH_PATH, SYNC_PULL_PATH]).toEqual(['/api/sync/v1', '/api/sync/v1/push', '/api/sync/v1/pull']);
  });

  it('answers a push with the per-event receipt envelope, as the authenticated tenant', async () => {
    const { routes, stores, seen } = app();
    const payload = { title: 'standup' };
    const res = await post(routes, '/push', {
      batchId: 'b',
      protocolVersion: SYNC_PROTOCOL_VERSION,
      deviceId: 'd',
      destination: { kind: 'bound' },
      events: [{
        eventId: '11111111-1111-4111-8111-111111111111',
        clientEntityId: '22222222-2222-4222-8222-222222222222',
        entityType: 'chat',
        operation: 'create',
        schemaVersion: 1,
        localSequence: 1,
        occurredAt: '2026-01-01T00:00:00.000Z',
        dependsOn: [],
        destination: { kind: 'bound' },
        payload,
        payloadHash: hashSyncPayload(payload),
      }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { receipts: Array<{ status: string }> };
    expect(body.receipts.map((r) => r.status)).toEqual(['accepted']);
    expect(stores.state().events[0]?.tenantId).toBe(7);
    expect(seen).toEqual([DB]);
  });

  it('refuses another tenant with 400 { error } and a non-JSON body as invalid_batch', async () => {
    const { routes } = app();
    const foreign = await post(routes, '/push', {
      batchId: 'b', protocolVersion: SYNC_PROTOCOL_VERSION, deviceId: 'd', destination: { kind: 'bound', tenantId: '8' }, events: [],
    });
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toEqual({ error: 'destination_tenant_mismatch' });
    const garbled = await post(routes, '/push', '{not json');
    expect(garbled.status).toBe(400);
    expect(await garbled.json()).toEqual({ error: 'invalid_batch' });
  });

  it('serves a pull page as a SyncPullResult', async () => {
    const { routes } = app();
    const res = await post(routes, '/pull', { destination: { kind: 'bound' }, limit: 10 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { records: unknown[]; cursor: string };
    expect(body.records).toEqual([]);
    expect(typeof body.cursor).toBe('string');
  });
});
