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
 *
 * ERRORS. A `DataSourceError` carries its own status and is rendered by the global
 * handler through `statusOf`; anything else is an invariant failure the handler
 * reports and answers generically. No mapping happens here.
 */

import { Hono, type Context } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  introspectDataSource,
  listDataSources,
  queryDataSource,
  type DataSourceDeps,
} from '../../application/integrations/dataSourcePort';
import { parseBody, z, zNonEmptyString, zPositiveInt } from './requestBody';

const QueryBody = z.object({
  sql: zNonEmptyString,
  limit: zPositiveInt.optional(),
});

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
  router.get('/', async (c) => c.json({ sources: await listDataSources(deps(c)) }));

  // GET /:id/schema — tables, columns, keys and foreign keys.
  router.get('/:id/schema', async (c) => {
    const dataset = (c.req.query('dataset') ?? '').trim();
    const schema = await introspectDataSource(deps(c), c.req.param('id'), dataset ? { dataset } : {});
    return c.json(schema);
  });

  // POST /:id/query — one read statement. The port refuses anything else.
  router.post('/:id/query', async (c) => {
    const body = await parseBody(c, QueryBody);
    const result = await queryDataSource(deps(c), c.req.param('id'), {
      sql: body.sql,
      ...(body.limit !== undefined ? { limit: body.limit } : {}),
    });
    return c.json(result);
  });

  return router;
}
