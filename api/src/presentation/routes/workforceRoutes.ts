/**
 * Public workforce registry routes — /api/workforce/*
 *
 * Browse-only, no authentication required. Mirrors the subset of
 * /api/ide/agents endpoints that the marketing marketplace page
 * needs for unauthenticated visitors.
 */
import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import type { HonoEnv } from '../../env';

export function createWorkforceRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  const sql = (env: HonoEnv['Bindings']) => neon(env.NEON_DATABASE_URL);

  // GET /api/workforce/agents — list active published agents
  router.get('/agents', async (c) => {
    const rows = await sql(c.env)`
      SELECT *
      FROM ide_agents
      WHERE status = 'active'
      ORDER BY hire_count DESC, created_at DESC
      LIMIT 200
    `;
    return c.json(rows);
  });

  // GET /api/workforce/agents/:id — public agent detail
  router.get('/agents/:id', async (c) => {
    const [row] = await sql(c.env)`
      SELECT *
      FROM ide_agents
      WHERE id = ${c.req.param('id')} AND status = 'active'
    `;
    if (!row) return c.json({ error: 'Agent not found' }, 404);
    return c.json(row);
  });

  return router;
}
