/**
 * Run deltas (PRD 41 §C14) — what an agent run changed, per repository, read back for the web (WS10).
 * Mounted at `/api`:
 *
 *   GET /projects/:projectId/run-deltas?limit=50&cursor=   { items: RunDeltaSummary[]; nextCursor?: string }, newest first
 *   GET /run-deltas/:runId                                 { deltas: StoredRunDelta[] }, one per repo key
 *
 * Any tenant member may read. A project id in the path is user input: it is gated to the caller's tenant
 * (`projectInTenantCached`) before anything is read, and a project of another tenant answers 404. A run id
 * is matched only inside the caller's tenant. Writes arrive through the sync push, never here.
 *
 * Auth is attached PER ROUTE: this router is mounted at `/api`, and a `use('*')` here would run for every
 * `/api/*` request.
 */

import { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import { authMiddleware } from '../middleware/authMiddleware';
import { projectInTenantCached } from '../../application/project/projectOwnership';
import { runDeltaEvidenceStore } from '../../application/runDelta/runDeltaEvidence';
import {
  decodeRunDeltaCursor,
  listRunDeltasForProject,
  runDeltasForRun,
  RUN_DELTA_PAGE_DEFAULT,
  RUN_DELTA_PAGE_MAX,
} from '../../application/runDelta/runDeltaReads';
import { limitParam, positiveIntOrNull } from './queryParams';

/** A run id is the shared run-id space (`cloud:<n>` or a device id); bounded like the column. */
const RUN_ID = /^[A-Za-z0-9:._-]{1,128}$/;

export function createRunDeltaRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/projects/:projectId/run-deltas', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const projectId = positiveIntOrNull(c.req.param('projectId'));
    if (projectId === null || !(await projectInTenantCached(env, db, tenantId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const rawCursor = c.req.query('cursor');
    const cursor = decodeRunDeltaCursor(rawCursor);
    if (rawCursor && !cursor) return c.json({ error: 'Invalid cursor' }, 400);
    const limit = limitParam(c.req.query('limit'), RUN_DELTA_PAGE_DEFAULT, RUN_DELTA_PAGE_MAX);
    return c.json(await listRunDeltasForProject(env, db, tenantId, projectId, { limit, cursor }));
  });

  router.get('/run-deltas/:runId', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const runId = c.req.param('runId');
    if (!RUN_ID.test(runId)) return c.json({ error: 'Invalid run id' }, 400);
    return c.json(await runDeltasForRun(env, db, runDeltaEvidenceStore(env), tenantId, runId));
  });

  return router;
}
