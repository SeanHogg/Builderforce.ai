import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const readBoardBudget = vi.fn();
vi.mock('../../application/delivery/boardBudget', () => ({ readBoardBudget }));

const { createBoardBudgetRoutes } = await import('./boardBudgetRoutes');

function app() {
  const a = new Hono<HonoEnv>();
  a.use('*', async (c, next) => {
    c.set('isEmulation', true);
    c.set('tenantId', 5);
    c.set('userId', 'user-1');
    c.set('role', 'developer');
    await next();
  });
  a.route('/', createBoardBudgetRoutes({} as unknown as Db));
  return a;
}

describe('GET /:boardId/budget', () => {
  beforeEach(() => readBoardBudget.mockReset());

  it('answers 404 for a non-uuid board id without touching the database', async () => {
    const res = await app().request('/not-a-uuid/budget');
    expect(res.status).toBe(404);
    expect(readBoardBudget).not.toHaveBeenCalled();
  });

  it('reads the budget for a uuid board id', async () => {
    readBoardBudget.mockResolvedValue({ balance: 3 });
    const res = await app().request('/11111111-1111-4111-8111-111111111111/budget');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ balance: 3 });
  });
});
