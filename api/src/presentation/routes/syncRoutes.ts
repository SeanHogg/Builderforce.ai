/**
 * Sync routes — mounted under /api/sync/v1 (offline-first batch protocol, G15–G18).
 *
 *   POST /push  → one receipt per event (`handleSyncPush`)
 *   POST /pull  → one cursor page (`handleSyncPull`)
 *
 * The tenant, user and role come from the authenticated token ONLY; a body that
 * names another tenant is refused by the use case, and one that names none is
 * bound to the caller's. This file reads the request and writes the response —
 * the protocol lives in `application/sync/`, persistence behind `SyncStores`.
 *
 * Response contract (what `packages/local-first/src/httpSyncTransport.ts` reads):
 *   push 200 `{ receipts: SyncReceipt[] }` · pull 200 `SyncPullResult`
 *   refusal 400/403 `{ error: code }` — nothing was applied.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { HonoEnv } from '../../env';
import { requestDb, type DbHandle } from '../../application/shared/dbHandle';
import { handleSyncPull } from '../../application/sync/handleSyncPull';
import { handleSyncPush } from '../../application/sync/handleSyncPush';
import { readSyncBody } from '../../application/sync/syncEnvelope';
import type { SyncAuthContext, SyncStores } from '../../application/sync/syncPorts';

export const SYNC_ROUTE_BASE = '/api/sync/v1';
export const SYNC_PUSH_PATH = `${SYNC_ROUTE_BASE}/push`;
export const SYNC_PULL_PATH = `${SYNC_ROUTE_BASE}/pull`;

/** Builds the persistence port for a request's database handle (composition root supplies it). */
export type SyncStoresFor = (db: DbHandle) => SyncStores;

export function createSyncRoutes(storesFor: SyncStoresFor): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  r.use('*', authMiddleware);

  const auth = (c: { get: (key: string) => unknown }): SyncAuthContext => ({
    tenantId: c.get('tenantId') as number,
    userId: c.get('userId') as string,
    role: String(c.get('role') ?? ''),
  });

  r.post('/push', async (c) => {
    const body = readSyncBody(await c.req.text());
    const response = await handleSyncPush(body, { auth: auth(c), now: new Date(), stores: storesFor(requestDb(c)) });
    if (!response.ok) return c.json({ error: response.code }, response.status);
    return c.json({ receipts: response.receipts }, 200);
  });

  r.post('/pull', async (c) => {
    const body = readSyncBody(await c.req.text());
    const response = await handleSyncPull(body, { auth: auth(c), now: new Date(), stores: storesFor(requestDb(c)) });
    if (!response.ok) return c.json({ error: response.code }, response.status);
    return c.json(response.result, 200);
  });

  return r;
}
