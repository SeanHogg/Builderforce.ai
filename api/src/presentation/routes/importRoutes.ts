/**
 * Record import — /api/import/*
 *
 * THE import surface. The /import page (guided wizard + bulk file) and the
 * Brain's `board_data.*` tools both speak this contract and nothing else does:
 *
 *   GET  /kinds        { kinds: [{ key, columns: [{ name, type, required, example? }] }] }
 *                      Any workspace member — it is the registry, not data.
 *                      Cached on the registry fingerprint: static per deploy.
 *   POST /:kind        body { rows, dryRun?, rowOffset? }
 *                      → ImportResult { inserted, skipped, errors, dryRun }
 *                      Manager-gated. 201 when rows were written; 200 for a dry
 *                      run (nothing is written, so the report IS the success);
 *                      400 when nothing could be written, or the kind is unknown.
 *
 * `rowOffset` exists for the page's batching: it posts ≤500 rows at a time and
 * the server numbers `row N` errors from the offset, so a reader sees the
 * position in their file rather than in the batch.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import {
  IMPORT_REGISTRY_FINGERPRINT, importBoardRows, isImportDataset, listImportKinds,
} from '../../application/insights/boardImport';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { scope } from './segmentTrackerRoutes';

/** The registry cannot change without a deploy, and the key carries its
 *  fingerprint, so a long TTL is honest. */
const KINDS_TTL = { kvTtlSeconds: 86_400, l1TtlMs: 3_600_000 };

interface ImportBody {
  rows?: Array<Record<string, unknown>>;
  dryRun?: boolean;
  rowOffset?: number;
}

export function createImportRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/kinds', async (c) => {
    const key = `import:kinds:v:${IMPORT_REGISTRY_FINGERPRINT}`;
    return c.json(await getOrSetCached(c.env as Env | undefined, key, async () => ({ kinds: listImportKinds() }), KINDS_TTL));
  });

  router.post('/:kind', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const kind = c.req.param('kind');
    if (!isImportDataset(kind)) return c.json({ error: `unknown kind "${kind}"` }, 400);
    const body = await c.req.json<ImportBody>().catch(() => ({}) as ImportBody);
    const result = await importBoardRows(db, c.env as Env, tenantId, kind, body.rows ?? [], {
      dryRun: body.dryRun === true,
      rowOffset: typeof body.rowOffset === 'number' ? body.rowOffset : 0,
    });
    if (result.dryRun) return c.json(result, 200);
    return c.json(result, result.inserted > 0 ? 201 : 400);
  });

  return router;
}
