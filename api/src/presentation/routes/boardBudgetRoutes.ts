/**
 * Board budget route — GET /api/boards/:boardId/budget
 *
 * The board's earned budget: balance (points earned by Done tickets), run spend
 * (USD cents, a rollup of the cost already recorded), the recent statement and the
 * milestones the board has reached. Read-only; the earn happens in the ticket
 * lifecycle, not here.
 */
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireTenantId } from '../middleware/tenantContext';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { isUuid } from '../../domain/replay/replayScope';
import { readBoardBudget } from '../../application/delivery/boardBudget';

export function createBoardBudgetRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/:boardId/budget', authMiddleware, async (c) => {
    const tenantId = requireTenantId(c);
    const boardId = c.req.param('boardId');
    if (!isUuid(boardId)) return c.json({ error: 'Board not found' }, 404);
    const budget = await readBoardBudget(db, c.env as Env, tenantId, boardId);
    if (!budget) return c.json({ error: 'Board not found' }, 404);
    return c.json(budget);
  });

  return router;
}
