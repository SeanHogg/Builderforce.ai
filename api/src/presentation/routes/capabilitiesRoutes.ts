/**
 * Capability CRUD API routes.
 *
 *   POST /api/capabilities         — Create a new capability
 *   GET  /api/capabilities         — List capabilities for tenant
 *   GET  /api/capabilities/:id     — Get a capability by ID
 *   PATCH /api/capabilities/:id    — Update a capability (title, status)
 *   DELETE /api/capabilities/:id   — Delete a capability
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { CapabilityRepository } from '../../infrastructure/repositories/CapabilityRepository';
import { CapabilityService } from '../../application/capability/CapabilityService';
import type { Env, HonoEnv } from '../../env';

// Predefined values
const VALID_STATUSES = [
  'draft',
  'proposed',
  'in_progress',
  'completed',
  'deprecated',
  'retired',
];

const VALID_CATEGORIES = [
  'security',
  'performance',
  'usability',
  'accessibility',
  'compliance',
  'scalability',
  'reliability',
  'scalable_score',
];

export function createCapabilitiesRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const sql = (env: HonoEnv['Bindings']) => neon(env.NEON_DATABASE_URL);

  // Initialize service (would normally be injected via DI, but we'll create per-request)
  const createService = () => {
    const repo = new CapabilityRepository(sql);
    return new CapabilityService(repo);
  };

  // POST /api/capabilities — Create a new capability
  router.post('/', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;

    try {
      const body = await c.req.json<{ title: string; description?: string; category?: string; status?: string; priority?: string; tags?: string[] }>();

      // FR.4.2: Title required
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) {
        return c.json({ error: 'Title is required' }, 400);
      }

      // FR.4.2: Status must be valid
      const status = VALID_STATUSES.includes(body.status as string) ? (body.status as string) : 'draft';

      const category = VALID_CATEGORIES.includes(body.category as string) ? (body.category as string) : null;

      const service = createService();

      const capability = await service.create({
        title,
        description: body.description
          ? (typeof body.description === 'string' ? body.description.slice(0, 2000) : null)
          : null,
        category,
        status,
        priority: body.priority ? String(body.priority).slice(0, 50) : null,
        tags: Array.isArray(body.tags)
          ? body.tags.filter((t: unknown) => typeof t === 'string' && t.trim().length > 0).slice(0, 10)
          : null,
        tenantId: String(tenantId),
        created_by_user_id: actor,
      });

      return c.json(capability, 201);
    } catch (error: unknown) {
      console.error('[capabilities] create error:', error);
      return c.json({ error: 'Failed to create capability' }, 500);
    }
  });

  // GET /api/capabilities — List capabilities
  router.get('/', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;

    try {
      const searchParams = c.req.query();
      const status = searchParams.status || undefined;
      const category = searchParams.category || undefined;

      const service = createService();

      const capabilities = await service.list({
        tenantId: String(tenantId),
        status,
        category,
      });

      return c.json(capabilities);
    } catch (error: unknown) {
      console.error('[capabilities] list error:', error);
      return c.json({ error: 'Failed to list capabilities' }, 500);
    }
  });

  // DELETE /api/capabilities/:id — Delete a capability
  router.delete('/:id', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    try {
      const service = createService();

      // Verify ownership
      const capability = await service.getById(id);
      if (!capability) {
        return c.json({ error: 'Capability not found' }, 404);
      }
      if (capability.tenant_id !== String(tenantId)) {
        return c.json({ error: 'Access denied' }, 403);
      }

      await service.delete(id);

      return c.json({ ok: true });
    } catch (error: unknown) {
      console.error('[capabilities] delete error:', error);
      return c.json({ error: 'Failed to delete capability' }, 500);
    }
  });

  // PATCH /api/capabilities/:id — Update capability (title, status)
  router.patch('/:id', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    try {
      const body = await c.req.json<{ title?: string; status?: string; category?: string; description?: string; priority?: string; tags?: string[] }>();
      const service = createService();

      // Verify ownership
      const capability = await service.getById(id);
      if (!capability) {
        return c.json({ error: 'Capability not found' }, 404);
      }
      if (capability.tenant_id !== String(tenantId)) {
        return c.json({ error: 'Access denied' }, 403);
      }

      // FR.2.1, FR.2.2: Inline edit for title and status
      const dto: any = {};

      if (body.title !== undefined) {
        const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
        if (!title) {
          return c.json({ error: 'Title is required' }, 400);
        }
        dto.title = title;
      }

      if (body.status !== undefined) {
        if (!VALID_STATUSES.includes((body.status as string))) {
          return c.json({ error: `Invalid status. Valid values: ${VALID_STATUSES.join(', ')}` }, 400);
        }
        dto.status = body.status;
      }

      if (body.category !== undefined) {
        if (VALID_CATEGORIES.includes((body.category as string))) {
          dto.category = body.category;
        } else {
          dto.category = null;
        }
      }

      if (body.description !== undefined) {
        dto.description = body.description
          ? (typeof body.description === 'string' ? body.description.slice(0, 2000) : null)
          : null;
      }

      if (body.priority !== undefined) {
        dto.priority = body.priority
          ? (typeof body.priority === 'string' ? body.priority.slice(0, 50) : String(body.priority).slice(0, 50))
          : null;
      }

      if (body.tags !== undefined) {
        dto.tags = Array.isArray(body.tags)
          ? body.tags.filter((t: unknown) => typeof t === 'string' && t.trim().length > 0).slice(0, 10)
          : null;
      }

      const updated = await service.update(id, dto);

      return c.json(updated);
    } catch (error: unknown) {
      console.error('[capabilities] update error:', error);
      return c.json({ error: 'Failed to update capability' }, 500);
    }
  });

  return router;
}