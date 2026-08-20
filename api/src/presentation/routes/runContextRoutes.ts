/**
 * Run-context route — the serialized {@link RunContextEnvelope} the two CLIENT surfaces
 * fetch so they assemble their prompt from the same source the cloud engine does.
 *
 * ONE router, mounted at two paths for the two callers' conventions:
 *   • `/api/projects/:projectId/run-context`        — VS Code / web (tenant JWT)
 *   • `/api/agent/projects/:projectId/run-context`  — the on-prem runner (host API key)
 *
 * Both doors run through `hostOrTenantAuth`, the ONE middleware that already speaks both
 * languages, so there is no second auth spelling here and no per-door handler to drift.
 *
 * The api OWNS the data; the client renders it with `@builderforce/run-context`. Neither
 * client imports api infrastructure, and there is no fourth sharing mechanism — the
 * contract package holds the shape, this route holds the transport. Every read (project
 * ownership, the ticket, the blocks) belongs to `application/runtime/runContextService`;
 * this file only parses the request.
 *
 * GET ?taskId=&scope=&query=&agentRef=&reconcile=0&elide=1
 *   `reconcile=0` returns the FULL assembly (a cold start, or a caller that wants the
 *   whole picture). `elide=1` additionally drops blocks the scope already holds verbatim —
 *   correct ONLY for a surface that appends to a retained conversation rather than
 *   rebuilding its prompt each turn, which is why it is off by default.
 */
import { Hono } from 'hono';
import { hostOrTenantAuth } from '../middleware/hostOrTenantAuth';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { resolveRunContextRequest } from '../../application/runtime/runContextService';

export function createRunContextRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', hostOrTenantAuth(db));

  router.get('/:projectId/run-context', async (c) => {
    const taskIdQ = Number(c.req.query('taskId'));
    const result = await resolveRunContextRequest(c.env as Env, db, {
      tenantId: c.get('tenantId') as number,
      projectId: Number(c.req.param('projectId')),
      ...(Number.isInteger(taskIdQ) && taskIdQ > 0 ? { taskId: taskIdQ } : {}),
      ...(c.req.query('scope') ? { scope: c.req.query('scope')!.slice(0, 160) } : {}),
      ...(c.req.query('query') ? { query: c.req.query('query')!.slice(0, 2000) } : {}),
      ...(c.req.query('agentRef') ? { agentRef: c.req.query('agentRef')!.slice(0, 128) } : {}),
      reconcile: c.req.query('reconcile') !== '0',
      elideUnchanged: c.req.query('elide') === '1',
    });
    if (!result) return c.json({ error: 'project not found' }, 404);
    return c.json({
      envelope: result.envelope,
      unchanged: result.unchanged,
      reconciled: result.reconciled !== undefined,
    });
  });

  return router;
}
