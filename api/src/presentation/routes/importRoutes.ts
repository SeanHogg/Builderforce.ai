/**
 * Import — /api/import/*
 *
 * THE import surface. Every registered importer (`application/import/importers.ts`)
 * is served here through the one sequence (`runImport`: parse → preview | commit):
 *
 *   GET  /kinds        { kinds: [{ key, columns: [{ name, type, required, example? }] }] }
 *                      The ROW kinds the /import wizard renders (any workspace
 *                      member — it is the registry, not data). Cached on the
 *                      registry fingerprint: static per deploy.
 *   POST /:kind        body { …importer payload, dryRun? }
 *                      Row kinds:      { rows, rowOffset? } → ImportResult
 *                      Document kinds: e.g. workflow-definition { yaml, name? },
 *                                      connector-openapi { key, spec | specUrl, … }
 *                      Gated by the importer's declared role. 201 when written;
 *                      200 for a dry run / a draft importer's proposal (nothing
 *                      written, so the report IS the success); 400 when nothing
 *                      could be written, the payload is refused, or the kind is
 *                      unknown.
 *
 * The historical document-import paths (`/api/workflow-definitions/import`,
 * `/api/connectors/import/openapi`) are adapters over {@link serveImport}, so a
 * path and its `/api/import/:kind` twin cannot answer differently.
 *
 * `rowOffset` exists for the page's batching: it posts ≤500 rows at a time and
 * the server numbers `row N` errors from the offset, so a reader sees the
 * position in their file rather than in the batch.
 */

import { Hono, type Context } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { legacyAliasNotice } from '../middleware/legacyAlias';
import { ForbiddenError } from '../../domain/shared/errors';
import { hasMinRole } from '../../domain/shared/types';
import { readImportKinds } from '../../application/insights/boardImport';
import { runImport, type Importer, type ImportOutcome } from '../../application/import/importer';
import { getImporter } from '../../application/import/importers';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { parseBody, zJsonObject } from './requestBody';

/** The one outcome → status mapping for every importer. */
const STATUS: Record<ImportOutcome['status'], 200 | 201 | 400> = { refused: 400, previewed: 200, committed: 201 };

/**
 * Serve one import for this request — the adapter every import path shares.
 * Assumes the caller's router authenticated the request; enforces the importer's
 * declared role. `dryRun` comes from the body unless the path fixes it.
 */
export async function serveImport(c: Context<HonoEnv>, importer: Importer<unknown>, db: Db): Promise<Response> {
  const role = c.get('role') as string | undefined;
  if (!hasMinRole(role, importer.minRole)) {
    throw new ForbiddenError(`Requires at least '${importer.minRole}' role, caller has '${role}'`);
  }
  const body = await parseBody(c, zJsonObject);
  const outcome = await runImport(importer, {
    db,
    env: c.env as Env,
    tenantId: c.get('tenantId') as number,
    segmentId: (c.get('segmentId') as string | undefined) ?? null,
    userId: (c.get('userId') as string | undefined) ?? null,
  }, body, { dryRun: body.dryRun === true });
  return c.json(outcome.body as object, STATUS[outcome.status]);
}

/**
 * A route handler serving one registered importer at its HISTORICAL path — kept
 * for deployed clients, stamped as a deprecated alias (the ONE
 * `legacyAliasNotice`) naming `/api/import/:kind` as the successor.
 */
export function importHandler(kind: string, db: Db) {
  const importer = getImporter(kind);
  if (!importer) throw new Error(`importHandler: no importer registered for "${kind}"`);
  const notice = legacyAliasNotice(`/api/import/${kind}`);
  return async (c: Context<HonoEnv>): Promise<Response> => {
    await notice(c, async () => { c.res = await serveImport(c, importer, db); });
    return c.res;
  };
}

export function createImportRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/kinds', async (c) => c.json(await readImportKinds(c.env as Env | undefined)));

  router.post('/:kind', async (c) => {
    const kind = c.req.param('kind');
    const importer = getImporter(kind);
    if (!importer) return c.json({ error: `unknown kind "${kind}"` }, 400);
    return serveImport(c, importer, db);
  });

  return router;
}
