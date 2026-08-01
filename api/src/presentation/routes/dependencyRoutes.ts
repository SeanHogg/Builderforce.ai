/**
 * Dependency Resolution API Routes
 *
 * Provides endpoints for dependency analysis, blocker detection, and resolution suggestions.
 * Uses Hono framework (Cloudflare Workers compatible).
 */
import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { scope } from './segmentTrackerRoutes';
import { TenantRole } from '../../domain/shared/types';
import { DependencyResolutionService } from '../../application/dependency/DependencyResolutionService';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { DependencyReport } from '../../application/dependency/types';

export function createDependencyRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // Health check - no auth required
  router.get('/health', (c) => {
    return c.json({ status: 'ok', service: 'dependency-resolution' });
  });

  // Get dependency report for a project
  router.get('/projects/:projectId/dependencies/report', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const projectId = Number(c.req.param('projectId'));
    const stalenessDays = c.req.query('stalenessDays') ? Number(c.req.query('stalenessDays')) : 3;

    const service = new DependencyResolutionService(db);
    const report = await service.generateReport(tenantId, projectId, { stalenessDays });

    return c.json(report);
  });

  // Get critical path for a project
  router.get('/projects/:projectId/dependencies/critical-path', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const projectId = Number(c.req.param('projectId'));

    const service = new DependencyResolutionService(db);
    const criticalPath = await service.computeCriticalPath(tenantId, projectId);

    return c.json(criticalPath);
  });

  // Get blockers for a project
  router.get('/projects/:projectId/dependencies/blockers', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const projectId = Number(c.req.param('projectId'));
    const stalenessDays = c.req.query('stalenessDays') ? Number(c.req.query('stalenessDays')) : 3;

    const service = new DependencyResolutionService(db);
    const blockers = await service.detectBlockers(tenantId, projectId, { stalenessDays });

    return c.json(blockers);
  });

  // Get resolution suggestions for a blocker
  router.get('/dependencies/blockers/:blockerId/suggestions', requireRole(TenantRole.DEVELOPER), async (c) => {
    const blockerId = Number(c.req.param('blockerId'));
    const service = new DependencyResolutionService(db);
    const suggestions = await service.generateSuggestions(blockerId);

    return c.json(suggestions);
  });

  // Record resolution
  router.post('/dependencies/blockers/:blockerId/resolve', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const blockerId = Number(c.req.param('blockerId'));
    const body = await c.req.json<{
      resolutionType: string;
      notes?: string;
      resolutionDurationMinutes?: number;
    }>();

    const service = new DependencyResolutionService(db);
    const result = await service.recordResolution(tenantId, blockerId, body);

    return c.json(result, 201);
  });

  // Get resolution history for a project
  router.get('/projects/:projectId/dependencies/history', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const projectId = Number(c.req.param('projectId'));
    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 50;

    const service = new DependencyResolutionService(db);
    const history = await service.getResolutionHistory(tenantId, projectId, limit);

    return c.json(history);
  });

  // Get cached critical path
  router.get('/projects/:projectId/dependencies/critical-path/cached', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const projectId = Number(c.req.param('projectId'));

    const service = new DependencyResolutionService(db);
    const cached = await service.getCachedCriticalPath(tenantId, projectId);

    return c.json(cached);
  });

  // Trigger recomputation
  router.post('/projects/:projectId/dependencies/recompute', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const projectId = Number(c.req.param('projectId'));

    const service = new DependencyResolutionService(db);
    const result = await service.recomputeCriticalPath(tenantId, projectId);

    return c.json(result);
  });

  return router;
}
