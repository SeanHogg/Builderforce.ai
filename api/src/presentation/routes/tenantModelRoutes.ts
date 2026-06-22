/**
 * Tenant model ("LLM") routes — /api/llm/models/*
 *
 * CRUD over the tenant_models table (migration 0211): a tenant defines named,
 * reusable model configs ({ base model + system prompt + params + optional persona
 * / BYO key }) that any cloud agent, on-prem host, or the Designer Brain selects by
 * the ref `tenant_model:<slug>`. All routes are tenant-scoped via the tenant JWT.
 *
 *   GET    /api/llm/models        This tenant's models
 *   POST   /api/llm/models        Create a model
 *   PATCH  /api/llm/models/:id    Update a model
 *   DELETE /api/llm/models/:id    Delete a model
 */
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  listTenantModels,
  createTenantModel,
  updateTenantModel,
  deleteTenantModel,
  type TenantModelInput,
} from '../../application/llm/tenantModelService';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';

export function createTenantModelRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const models = await listTenantModels(c.env as Env, db, tenantId);
    return c.json({ models });
  });

  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const body = await c.req.json<Partial<TenantModelInput>>().catch((): Partial<TenantModelInput> => ({}));
    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const model = await createTenantModel(c.env as Env, db, tenantId, userId ?? null, body as TenantModelInput);
    if (!model) return c.json({ error: 'Failed to create model' }, 500);
    return c.json(model, 201);
  });

  router.patch('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await c.req.json<Partial<TenantModelInput>>().catch((): Partial<TenantModelInput> => ({}));
    const model = await updateTenantModel(c.env as Env, db, tenantId, id, body);
    if (!model) return c.json({ error: 'Model not found' }, 404);
    return c.json(model);
  });

  router.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const ok = await deleteTenantModel(c.env as Env, db, tenantId, id);
    if (!ok) return c.json({ error: 'Model not found' }, 404);
    return c.json({ deleted: true });
  });

  return router;
}
