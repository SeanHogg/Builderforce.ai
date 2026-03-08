import { Hono } from 'hono';
import { AuditService } from '../../application/audit/AuditService';
import type { HonoEnv } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole, asTenantId } from '../../domain/shared/types';

/**
 * Audit routes – compliance & access review.
 *
 * GET /api/audit/events                       – tenant-wide event log (MANAGER+)
 * GET /api/audit/users/:userId/activity       – user activity log (MANAGER+)
 */
export function createAuditRoutes(auditService: AuditService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  // GET /api/audit/events?limit=100&offset=0
  router.get('/events', async (c) => {
    const limit  = Number(c.req.query('limit')  ?? '100');
    const offset = Number(c.req.query('offset') ?? '0');
    const events = await auditService.query(
      { tenantId: asTenantId(c.get('tenantId')), limit, offset },
      c.get('role'),
    );
    return c.json(events.map(e => e.toPlain()));
  });

  // GET /api/audit/users/:userId/activity?limit=50
  router.get('/users/:userId/activity', async (c) => {
    const userId = c.req.param('userId');
    const limit  = Number(c.req.query('limit') ?? '50');
    const events = await auditService.userActivity(
      userId,
      c.get('tenantId'),
      c.get('role'),
      limit,
    );
    return c.json(events.map(e => e.toPlain()));
  });

  return router;
}
