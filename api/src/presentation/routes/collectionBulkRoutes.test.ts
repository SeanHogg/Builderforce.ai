/**
 * `POST /api/collections/:entity/bulk` — the ONE bulk endpoint (PRD 47 §8 api):
 * unknown entity, BULK_MAX + 1 → 400, merge without targetId → 400, dryRun
 * writes nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const bulk = vi.fn();
vi.mock('../../application/collections/runBulkAction', () => ({
  runBulkAction: (...args: unknown[]) => bulk(...args),
}));

import { createCollectionBulkRoutes } from './collectionBulkRoutes';
import { BULK_MAX } from '@builderforce/interaction-contract';

function app() {
  const a = new Hono();
  a.onError((err, c) => c.json({ error: err.message }, 500));
  a.route('/api/collections', createCollectionBulkRoutes());
  // The auth middleware sets the tenant context before the bulk router runs.
  a.use('/api/collections/*', async (c, next) => {
    c.set('tenantId' as never, 7 as never);
    c.set('userId' as never, 'u-1' as never);
    c.set('role' as never, 'manager' as never);
    await next();
  });
  return a;
}

const json = (body: unknown) =>
  ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  bulk.mockReset();
});

describe('collection bulk routes', () => {
  it('answers a valid delete with the BulkResult', async () => {
    bulk.mockResolvedValue({ action: 'delete', succeeded: ['a'], skipped: [] });
    const res = await app().request('/api/collections/task/bulk', json({ action: 'delete', ids: ['a'] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ action: 'delete', succeeded: ['a'], skipped: [] });
    expect(bulk).toHaveBeenCalledWith(expect.anything(), { entity: 'task', action: 'delete', ids: ['a'], targetId: undefined, dryRun: undefined });
  });

  it('400s a body over BULK_MAX ids before the handler runs', async () => {
    const ids = Array.from({ length: BULK_MAX + 1 }, (_, i) => `t${i}`);
    const res = await app().request('/api/collections/task/bulk', json({ action: 'delete', ids }));
    expect(res.status).toBe(400);
    expect(bulk).not.toHaveBeenCalled();
  });

  it('400s a merge without a targetId, and a targetId not in ids', async () => {
    for (const body of [{ action: 'merge', ids: ['a', 'b'] }, { action: 'merge', ids: ['a', 'b'], targetId: 'z' }]) {
      const res = await app().request('/api/collections/task/bulk', json(body));
      expect(res.status).toBe(400);
    }
    expect(bulk).not.toHaveBeenCalled();
  });

  it('400s a malformed body', async () => {
    const res = await app().request('/api/collections/task/bulk', json({ action: 'explode', ids: ['a'] }));
    expect(res.status).toBe(400);
    expect(bulk).not.toHaveBeenCalled();
  });

  it('passes dryRun through untouched (a preview writes nothing server-side)', async () => {
    bulk.mockResolvedValue({ action: 'merge', succeeded: [], skipped: [], preview: { tasks: 12 } });
    const res = await app().request('/api/collections/task/bulk', json({ action: 'merge', ids: ['a', 'b'], targetId: 'a', dryRun: true }));
    expect(res.status).toBe(200);
    expect(bulk).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dryRun: true, targetId: 'a' }));
  });
});
