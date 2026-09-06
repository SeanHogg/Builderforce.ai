import { Hono } from 'hono';
import { AuditService } from '../../application/audit/AuditService';
import type { HonoEnv } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/requirePermission';
import { PERMISSIONS } from '../../domain/permissions/permissionRegistry';
import { TenantRole, asTenantId } from '../../domain/shared/types';
import { limitParam, offsetParam } from './queryParams';

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
  // Refines the role tier with the registry permission, so an operator revoking
  // `audit:read` from one manager actually takes effect.
  router.use('*', requirePermission(PERMISSIONS.AUDIT_READ));

  // GET /api/audit/events?limit=100&offset=0
  router.get('/events', async (c) => {
    const limit  = limitParam(c.req.query('limit'), 100, 500);
    const offset = offsetParam(c.req.query('offset'));
    const eventType = c.req.query('eventType')?.trim() || undefined;
    const resourceType = c.req.query('resourceType')?.trim() || undefined;
    const events = await auditService.query(
      { tenantId: asTenantId(c.get('tenantId')), limit, offset, ...(eventType ? { eventType } : {}), ...(resourceType ? { resourceType } : {}) },
      c.get('role'),
    );
    // Enveloped, as the typed client (`auditApi.list`) has always read it — the bare
    // array this used to return made that client resolve to an empty list every time.
    return c.json({ events: events.map(e => e.toPlain()) });
  });

  // GET /api/audit/users/:userId/activity?limit=50
  router.get('/users/:userId/activity', async (c) => {
    const userId = c.req.param('userId');
    const limit  = limitParam(c.req.query('limit'), 50, 500);
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
