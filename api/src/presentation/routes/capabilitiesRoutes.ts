/**
 * Capability CRUD API routes.
 *
 *   POST /api/capabilities         — Create a new capability
 *   GET  /api/capabilities         — List capabilities for tenant
 *   GET  /api/capabilities/:id     — Get a capability by ID
 *   PATCH /api/capabilities/:id    — Update a capability (title, status)
 *   DELETE /api/capabilities/:id   — Delete a capability
 *
 * Sends explicit success/error feedback for each operation.
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

  const sendSuccess = (c: any, message: string, data?: any) => {
    return c.json({ success: true, message, ...data }, 200);
  };

  const sendError = (c: any, message: string, status: number = 400) => {
    return c.json({ success: false, error: message }, status);
  };

  // POST /api/capabilities — Create a new capability
  router.post('/', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;

    try {
      const body = await c.req.json<{
        title: string;
        description?: string;
        category?: string;
        status?: string;
        priority?: string;
        tags?: string[];
      }>();

      // FR.4.1: Title required
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) {
        return sendError(c, 'Title is required', 400);
      }

      // FR.4.2: Status must be valid
      const status = VALID_STATUSES.includes(body.status as string)
        ? (body.status as string)
        : 'draft';

      const category = VALID_CATEGORIES.includes(body.category as string)
        ? (body.category as string)
        : null;

      const service = createService();

      const capability = await service.create({
        title,
        description:
          body.description && typeof body.description === 'string'
            ? body.description.slice(0, 2000)
            : null,
        category,
        status,
        priority:
          body.priority
            ? (typeof body.priority === 'string'
                ? body.priority.slice(0, 50)
                : String(body.priority).slice(0, 50))
            : null,
        tags:
          Array.isArray(body.tags)
            ? body.tags.filter(
                (t: unknown) => typeof t === 'string' && t.trim().length > 0
              ).slice(0, 10)
            : null,
        tenantId: String(tenantId),
        created_by_user_id: actor,
      });

      // Explicit success feedback for operation
      return sendSuccess(c, 'Capability created successfully', capability);
    } catch (error: unknown) {
      console.error('[capabilities] create error:', error);
      return sendError(
        c,
        `Error saving capability: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        500
      );
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

      return sendSuccess(
        c,
        `Retrieved ${capabilities.length} capability${capabilities.length !== 1 ? 's' : ''}`,
        capabilities
      );
    } catch (error: unknown) {
      console.error('[capabilities] list error:', error);
      return sendError(c, 'Failed to list capabilities', 500);
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
        return sendError(c, 'Capability not found', 404);
      }
      if (capability.tenant_id !== String(tenantId)) {
        return sendError(c, 'Access denied', 403);
      }

      await service.delete(id);

      // Explicit success feedback for operation
      return sendSuccess(c, 'Capability deleted successfully');
    } catch (error: unknown) {
      console.error('[capabilities] delete error:', error);
      return sendError(
        c,
        `Error deleting capability: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        500
      );
    }
  });

  // PATCH /api/capabilities/:id — Update capability (title, status)
  router.patch('/:id', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    try {
      const body = await c.req.json<{
        title?: string;
        status?: string;
        category?: string;
        description?: string;
        priority?: string;
        tags?: string[];
      }>();
      const service = createService();

      // Verify ownership
      const capability = await service.getById(id);
      if (!capability) {
        return sendError(c, 'Capability not found', 404);
      }
      if (capability.tenant_id !== String(tenantId)) {
        return sendError(c, 'Access denied', 403);
      }

      // FR.2.1, FR.2.2: Inline edit validation ensures valid statuses for title/status-only updates
      const dto: any = {};

      if (body.title !== undefined) {
        const title = typeof body.title === 'string'
            ? body.title.trim().slice(0, 200)
            : '';
        if (!title) {
          return sendError(c, 'Title cannot be empty', 400);
        }
        // Validate maxlength per backend-maxlength
        dto.title = title;
        // Ensure storage stays within frontend maxlength (200)
        // No additional server-side truncation needed—dto.title already sliced to 200 char limit.
      }

      if (body.status !== undefined) {
        // Strict status validation (required for UI-driven PATCH; not optional)
        const normalizedStatus = body.status.toLowerCase() as string;
        if (!VALID_STATUSES.includes(normalizedStatus)) {
          // Provide actionable feedback for invalid status choices.
          return sendError(
            c,
            `Invalid status value: ${body.status}. Valid values: ${VALID_STATUSES.map(s => s.replace('_', ' ')).join(', ')}`,
            400
          );
        }
        dto.status = normalizedStatus;
      }

      // For optional fields (category, description, priority, tags) only set if provided
      // We allow any string for category/priority/etc and resolve undefined → null in update()
      if (body.category !== undefined) {
        // strip only whitespace; categories don't require strict validation on update
        dto.category = typeof body.category === 'string' ? body.category.trim() : null;
      }
      if (body.description !== undefined) {
        dto.description =
          body.description && typeof body.description === 'string'
            ? body.description.slice(0, 2000)
            : null;
      }
      if (body.priority !== undefined) {
        dto.priority =
          body.priority
            ? (typeof body.priority === 'string'
                ? body.priority.slice(0, 50)
                : String(body.priority).slice(0, 50))
            : null;
      }
      if (body.tags !== undefined) {
        dto.tags =
          Array.isArray(body.tags)
            ? body.tags
                .filter((t: unknown) => typeof t === 'string' && t.trim().length > 0)
                .slice(0, 10)
            : null;
      }

      const updated = await service.update(id, dto);

      if (!updated) {
        return sendError(c, 'Failed to update capability', 400);
      }

      // Explicit success feedback for operation
      return sendSuccess(c, 'Capability updated successfully', updated);
    } catch (error: unknown) {
      console.error('[capabilities] update error:', error);
      return sendError(
        c,
        `Error updating capability: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        500
      );
    }
  });

  return router;
}