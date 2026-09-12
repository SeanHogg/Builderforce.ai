/**
 * Board routes never query with a missing tenant.
 *
 * Every board handler reads its tenant through `requireTenantId`, so a request
 * that reaches a handler with no workspace — the real gate refusing a missing
 * token, OR a mis-mount that let an unauthenticated request through (optional
 * auth, a route registered above the blanket gate) — answers 401 before any
 * query is issued, instead of running `WHERE tenant_id = undefined`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const auth = vi.hoisted(() => ({ mode: 'real' as 'real' | 'passthrough' }));

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/authMiddleware')>();
  return {
    ...actual,
    // `passthrough` stands in for optional auth: the request continues with no
    // tenant published, exactly as `optionalAuthMiddleware` leaves it signed out.
    authMiddleware: async (c: Parameters<typeof actual.authMiddleware>[0], next: () => Promise<void>) =>
      auth.mode === 'passthrough' ? next() : actual.authMiddleware(c, next),
  };
});

import { errorHandler } from '../middleware/errorHandler';
import { createBoardRoutes } from './boardRoutes';

/** A Db that fails the test if any handler so much as touches it. */
const touched: string[] = [];
const untouchableDb = new Proxy({}, {
  get(_target, prop) {
    touched.push(String(prop));
    throw new Error(`db.${String(prop)} was reached without a tenant`);
  },
}) as unknown as Db;

function app(): Hono<HonoEnv> {
  const root = new Hono<HonoEnv>();
  root.onError(errorHandler);
  root.route('/api/boards', createBoardRoutes(untouchableDb));
  return root;
}

const ENV = { JWT_SECRET: 'test-secret' } as never;

describe('board routes without a tenant', () => {
  beforeEach(() => {
    touched.length = 0;
  });

  it('the real gate refuses a request with no token (401), no query issued', async () => {
    auth.mode = 'real';
    const res = await app().request('/api/boards', {}, ENV);
    expect(res.status).toBe(401);
    expect(touched).toEqual([]);
  });

  it('a handler reached with no tenant answers 401 instead of listing boards for tenant undefined', async () => {
    auth.mode = 'passthrough';
    const res = await app().request('/api/boards', {}, ENV);
    expect(res.status).toBe(401);
    expect(touched).toEqual([]);
  });

  it('board detail reached with no tenant answers 401, no query issued', async () => {
    auth.mode = 'passthrough';
    const res = await app().request('/api/boards/12', {}, ENV);
    expect(res.status).toBe(401);
    expect(touched).toEqual([]);
  });
});
