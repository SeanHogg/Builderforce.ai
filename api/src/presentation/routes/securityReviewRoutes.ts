/**
 * Security routes – /api/security
 *
 * The Security agent's control surface plus the legacy per-diff review:
 *
 *   POST /api/security/review              { code, context? } → { findings, summary, model }
 *   GET  /api/security/access              → who can see SECURITY tickets (config)
 *   PUT  /api/security/access              set the visibility config (manager+)
 *   GET  /api/security/audits              → recent SOC 2 audit runs (results)
 *   GET  /api/security/audits/:id          → one audit run + its finding tickets
 *   POST /api/security/audits/run          { projectId? } dispatch an audit now (manager+)
 *
 * Access config + audit results are manager-gated: they name what the Security agent
 * found, which is exactly the need-to-know surface the config restricts.
 */
import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { SecurityReviewService } from '../../application/security/SecurityReviewService';
import { SecurityTicketAccessService, type SecurityAudiences } from '../../application/security/SecurityTicketAccessService';
import { SecurityAuditService } from '../../application/security/SecurityAuditService';
import { dispatchSecurityAudit } from '../../application/security/securityDispatch';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createSecurityReviewRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // POST /review — not cached: each call reviews caller-supplied code (unbounded,
  // one-shot compute), so there is nothing stable to cache.
  router.post('/review', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ code?: string; context?: string }>();
    if (!body.code?.trim()) return c.json({ error: 'code is required' }, 400);

    const svc = new SecurityReviewService(db, c.env as Env);
    const result = await svc.review(tenantId, { code: body.code, context: body.context });
    return c.json(result);
  });

  // GET /access — the current visibility configuration (manager+).
  router.get('/access', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const cfg = await new SecurityTicketAccessService(db, c.env as Env).getConfig(tenantId);
    return c.json(cfg);
  });

  // PUT /access — set who can see SECURITY tickets (manager+).
  router.put('/access', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const body = await c.req.json<{
      audiences?: Partial<SecurityAudiences>;
      allowUserIds?: string[];
      allowAgentRefs?: string[];
    }>().catch(() => ({} as {
      audiences?: Partial<SecurityAudiences>;
      allowUserIds?: string[];
      allowAgentRefs?: string[];
    }));
    const audiences = body.audiences
      ? { humans: !!body.audiences.humans, hired: !!body.audiences.hired, talent: !!body.audiences.talent }
      : undefined;
    const cfg = await new SecurityTicketAccessService(db, c.env as Env).setConfig(tenantId, {
      audiences,
      allowUserIds: Array.isArray(body.allowUserIds) ? body.allowUserIds.map(String) : undefined,
      allowAgentRefs: Array.isArray(body.allowAgentRefs) ? body.allowAgentRefs.map(String) : undefined,
    }, userId ?? null);
    return c.json(cfg);
  });

  // GET /audits — recent audit runs, newest first (manager+).
  router.get('/audits', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const audits = await new SecurityAuditService(db).listAudits(tenantId);
    return c.json({ audits });
  });

  // GET /audits/:id — one run + its finding tickets (manager+).
  router.get('/audits/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'invalid audit id' }, 400);
    const result = await new SecurityAuditService(db).getAudit(tenantId, id);
    if (!result) return c.json({ error: 'Audit not found' }, 404);
    return c.json(result);
  });

  // POST /audits/run — dispatch an on-demand SOC 2 audit (manager+).
  router.post('/audits/run', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const body = await c.req.json<{ projectId?: number }>().catch(() => ({} as { projectId?: number }));
    const auditId = await dispatchSecurityAudit(c.env as Env, db, {
      tenantId,
      projectId: typeof body.projectId === 'number' ? body.projectId : undefined,
      trigger: 'manual',
      submittedBy: userId ? `user:${userId}` : undefined,
    });
    if (auditId == null) {
      return c.json({ error: 'Could not start an audit — no Security agent or no repo-linked project.' }, 409);
    }
    return c.json({ auditId }, 202);
  });

  return router;
}
