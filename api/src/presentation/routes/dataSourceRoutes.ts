/**
 * Canvas data sources — /api/data-sources
 *
 * The presentation half of {@link ../../application/integrations/dataSourcePort}.
 * Three reads, no writes:
 *
 *   GET  /                    connected warehouses this canvas may bind to
 *   GET  /:id/schema          the live schema, for reverse-engineering an ERD
 *   POST /:id/query           one read query, materialized onto the board
 *
 * ROLE: MANAGER+. A data source holds a credential that reads a production
 * database; that is not a surface a member who can open a ticket should reach.
 *
 * CACHING. The list and the schema are slow-changing and expensive, and the port
 * serves both through the canonical read-through cache — this file only hands it
 * the request's env. A query is NOT cached: the point of a live source is that it
 * is live, and a stale answer to "how many orders today" is worse than a slow one.
 */

import { Hono, type Context } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import {
  DataSourceError,
  introspectDataSource,
  listDataSources,
  queryDataSource,
  type DataSourceDeps,
} from '../../application/integrations/dataSourcePort';

function fail(c: Context<HonoEnv>, error: unknown) {
  if (error instanceof DataSourceError) return c.json({ error: error.message }, error.status);
  reportCaughtError(error, { source: 'presentation/routes/dataSourceRoutes.ts', operation: 'handler' });
  return c.json({ error: error instanceof Error ? error.message : 'Data source request failed' }, 500);
}

export function createDataSourceRoutes(db: Db, encryptionSecret: string): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  const deps = (c: Context<HonoEnv>): DataSourceDeps => ({
    db,
    tenantId: c.get('tenantId') as number,
    encryptionSecret,
    env: c.env as Env,
  });

  // GET / — connected data sources, with what each can actually do here.
  router.get('/', async (c) => {
    try {
      return c.json({ sources: await listDataSources(deps(c)) });
    } catch (error) {
      return fail(c, error);
    }
  });

  // GET /:id/schema — tables, columns, keys and foreign keys.
  router.get('/:id/schema', async (c) => {
    try {
      const dataset = (c.req.query('dataset') ?? '').trim();
      const schema = await introspectDataSource(deps(c), c.req.param('id'), dataset ? { dataset } : {});
      return c.json(schema);
    } catch (error) {
      return fail(c, error);
    }
  });

  // POST /:id/query — one read statement. The port refuses anything else.
  router.post('/:id/query', async (c) => {
    try {
      const body = await c.req.json<{ sql?: unknown; limit?: unknown }>().catch(() => ({} as { sql?: unknown; limit?: unknown }));
      const result = await queryDataSource(deps(c), c.req.param('id'), {
        sql: typeof body.sql === 'string' ? body.sql : '',
        ...(Number.isFinite(Number(body.limit)) ? { limit: Number(body.limit) } : {}),
      });
      return c.json(result);
    } catch (error) {
      return fail(c, error);
    }
  });

  return router;
}
