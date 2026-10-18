/**
 * Specs routes – /api/specs
 *
 * Specs are structured planning documents produced by the BuilderForce Agents /spec command.
 * They store PRD, architecture spec, and task list as structured fields.
 *
 * P1-1: Spec / Planning Storage API
 *
 * POST   /api/specs                    Create or upsert a spec (agentHost API key or tenant JWT)
 * POST   /api/specs/import             Import a spec from GitHub / Linear / Jira (tenant JWT)
 * GET    /api/specs                    List specs for tenant (tenant JWT)
 * GET    /api/specs/:id                Get spec detail (tenant JWT)
 * PATCH  /api/specs/:id                Update spec status/content (tenant JWT)
 * DELETE /api/specs/:id                Archive spec (tenant JWT)
 * GET    /api/specs/:id/workflows      List workflows linked to this spec (tenant JWT)
 * POST   /api/specs/:id/workflows      Link an existing workflow to a spec (tenant JWT)
 */
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { hostOrTenantAuth, requestAgentHostId } from '../middleware/hostOrTenantAuth';
import { publicSpecImportResult, SpecImportError } from '../../application/prd/importSpec';
import {
  SPEC_STATUSES, deleteSpec, getSpec, importSpec, linkWorkflowToSpec, listSpecWorkflows, listSpecs, patchSpec, upsertSpec,
} from '../../application/prd/specStore';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { parseBody, z } from './requestBody';

/** `goal` stays optional so the handler's own "goal is required" wins; `taskList` is
 *  stored as JSON exactly as sent. */
const UpsertSpecBody = z.object({
  id: z.string().nullish(),
  projectId: z.number().nullish(),
  goal: z.string().nullish(),
  status: z.enum(SPEC_STATUSES).nullish(),
  kind: z.string().optional(),
  prd: z.string().nullish(),
  archSpec: z.string().nullish(),
  taskList: z.unknown().optional(),
  /** When present, link this spec to the task as its primary PRD (agent write-back). */
  taskId: z.number().nullish(),
});
const PatchSpecBody = z.object({
  goal: z.string().optional(),
  status: z.enum(SPEC_STATUSES).optional(),
  prd: z.string().nullish(),
  archSpec: z.string().nullish(),
  taskList: z.unknown().optional(),
});
/** `workflowId` stays optional so the handler's own "workflowId is required" wins. */
const LinkWorkflowBody = z.object({ workflowId: z.string().nullish() });
const ImportSpecBody = z.object({
  projectId: z.number().nullish(),
  externalId: z.string().nullish(),
  provider: z.string().nullish(),
  connectionId: z.string().nullish(),
  taskId: z.number().nullish(),
});

type SpecsHonoEnv = HonoEnv;

export function createSpecRoutes(db: Db): Hono<SpecsHonoEnv> {
  const router = new Hono<SpecsHonoEnv>();

  // POST /api/specs – create/upsert a spec
  // Accepts either tenant JWT (from portal) or agentHost API key, via the shared
  // dual-auth middleware (Bearer + X-AgentHost-Id, or ?agentHostId=&key=).
  router.post('/', hostOrTenantAuth(db), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, UpsertSpecBody);
    if (!body.goal?.trim()) return c.json({ error: 'goal is required' }, 400);

    const row = await upsertSpec(db, c.env as Env, { tenantId, agentHostId: requestAgentHostId(c) }, { ...body, goal: body.goal });
    if (!row) return c.json({ error: 'Spec not found' }, 404);
    return c.json(row, 201);
  });

  // All remaining routes require tenant JWT
  router.use('*', authMiddleware);

  // POST /api/specs/import — pull a GitHub / Linear / Jira ticket into a spec.
  // Must be registered before /:id so "import" is not captured as an id.
  router.post('/import', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, ImportSpecBody);
    if (body.projectId == null) return c.json({ error: 'projectId is required' }, 400);
    if (!body.externalId?.trim()) return c.json({ error: 'externalId is required' }, 400);
    try {
      const result = await importSpec(db, c.env as Env, {
        tenantId,
        projectId: body.projectId,
        externalId: body.externalId,
        provider: body.provider,
        connectionId: body.connectionId,
        taskId: body.taskId,
      });
      return c.json(publicSpecImportResult(result.spec, { created: result.created, linkedTaskId: result.linkedTaskId }), result.created ? 201 : 200);
    } catch (err) {
      if (err instanceof SpecImportError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });

  // GET /api/specs?projectId=&kind=
  router.get('/', async (c) => {
    const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;
    const rows = await listSpecs(db, c.get('tenantId') as number, { projectId, kind: c.req.query('kind') || null });
    return c.json({ specs: rows });
  });

  // GET /api/specs/:id
  router.get('/:id', async (c) => {
    const row = await getSpec(db, c.get('tenantId') as number, c.req.param('id'));
    if (!row) return c.json({ error: 'Spec not found' }, 404);
    return c.json(row);
  });

  // PATCH /api/specs/:id
  router.patch('/:id', async (c) => {
    const body = await parseBody(c, PatchSpecBody);
    const row = await patchSpec(db, c.get('tenantId') as number, c.req.param('id'), body);
    if (!row) return c.json({ error: 'Spec not found' }, 404);
    return c.json(row);
  });

  // DELETE /api/specs/:id — idempotent: 204 whether or not a row went.
  router.delete('/:id', async (c) => {
    await deleteSpec(db, c.get('tenantId') as number, c.req.param('id'));
    return c.body(null, 204);
  });

  // GET /api/specs/:id/workflows
  router.get('/:id/workflows', async (c) => {
    const rows = await listSpecWorkflows(db, c.get('tenantId') as number, c.req.param('id'));
    if (!rows) return c.json({ error: 'Spec not found' }, 404);
    return c.json({ workflows: rows });
  });

  // POST /api/specs/:id/workflows – link an existing workflow to a spec
  router.post('/:id/workflows', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const specId = c.req.param('id');
    if (!(await getSpec(db, tenantId, specId))) return c.json({ error: 'Spec not found' }, 404);

    const body = await parseBody(c, LinkWorkflowBody);
    if (!body.workflowId) return c.json({ error: 'workflowId is required' }, 400);

    await linkWorkflowToSpec(db, tenantId, specId, body.workflowId);
    return c.json({ ok: true });
  });

  return router;
}
