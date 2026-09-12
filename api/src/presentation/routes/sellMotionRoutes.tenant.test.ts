/**
 * The sell-motion acts resolve their board inside the CALLER'S workspace.
 *
 * The router used to be gated by `webAuthMiddleware`, which verifies the tenant
 * JWT the client sends but never publishes its `tid` — so every card lookup ran
 * scoped to tenant `undefined` and a seller's own board could never resolve.
 * These pin both halves of the fix: no workspace answers 401 before the port is
 * asked anything, and a workspace token reaches the port with its real tenant.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const auth = vi.hoisted(() => ({ tenantId: undefined as number | undefined }));
const port = vi.hoisted(() => ({ resolveSellMotionCard: vi.fn() }));

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/authMiddleware')>();
  return {
    ...actual,
    // Stands in for the workspace gate: publishes a tenant when the test gives one,
    // and otherwise lets the request through with none (a mis-mount, optional auth).
    authMiddleware: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      if (auth.tenantId !== undefined) {
        c.set('tenantId', auth.tenantId);
        c.set('userId', 'seller-1');
      }
      await next();
    },
  };
});

vi.mock('../../application/sales/sellMotionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../application/sales/sellMotionService')>();
  return { ...actual, resolveSellMotionCard: port.resolveSellMotionCard };
});

import { errorHandler } from '../middleware/errorHandler';
import { createSellMotionRoutes } from './sellMotionRoutes';

const SESSION = '11111111-2222-4333-8444-555555555555';
const OBJECT = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const ENV = { JWT_SECRET: 'test-secret', CORS_ORIGINS: '' } as never;

function app(): Hono<HonoEnv> {
  const root = new Hono<HonoEnv>();
  root.onError(errorHandler);
  root.route('/api/sell-motion', createSellMotionRoutes({} as Db));
  return root;
}

const readCall = () =>
  app().request(`/api/sell-motion/${SESSION}/objects/${OBJECT}/read-call`, { method: 'POST' }, ENV);

describe('sell-motion without / with a workspace', () => {
  beforeEach(() => {
    auth.tenantId = undefined;
    port.resolveSellMotionCard.mockReset();
    port.resolveSellMotionCard.mockResolvedValue({ ok: false, status: 404, error: 'Not found' });
  });

  it('answers 401 with no workspace, before the card port is asked anything', async () => {
    const res = await readCall();
    expect(res.status).toBe(401);
    expect(port.resolveSellMotionCard).not.toHaveBeenCalled();
  });

  it('resolves the card inside the caller\'s real tenant, not tenant undefined', async () => {
    auth.tenantId = 5;
    await readCall();
    expect(port.resolveSellMotionCard).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 5, userId: 'seller-1', sessionId: SESSION, objectId: OBJECT }),
    );
  });
});
