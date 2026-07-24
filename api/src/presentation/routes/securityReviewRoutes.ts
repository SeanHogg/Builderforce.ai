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
import {
  runWebScan,
  resolveScanProject,
  getProjectScanTarget,
  setProjectScanTarget,
} from '../../application/security/webSecurityScan';
import { ScanTargetError } from '../../application/security/WebSecurityScanner';
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

  // GET /audits — recent codebase (SOC 2) audit runs, newest first (manager+).
  // Scoped to scanKind='codebase' so web (URL) scans render on their own surface.
  router.get('/audits', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const audits = await new SecurityAuditService(db).listAudits(tenantId, { scanKind: 'codebase' });
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

  // ── Web (external URL) security scan ──────────────────────────────────────
  //
  // "Point at your live website → real findings now → they become board work."
  // A deterministic in-request HTTP scan (WebSecurityScanner) whose findings flow
  // through the SAME audit ledger + SECURITY-ticket pipeline as the SOC 2 agent.

  // GET /web-scan/config — the resolved project + its configured target URL (manager+).
  router.get('/web-scan/config', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const qp = c.req.query('projectId');
    const projectId = await resolveScanProject(db, tenantId, qp ? Number(qp) : undefined);
    if (projectId == null) return c.json({ projectId: null, targetUrl: null });
    const targetUrl = await getProjectScanTarget(db, tenantId, projectId);
    return c.json({ projectId, targetUrl });
  });

  // PUT /web-scan/config — set the website this project scans (manager+).
  router.put('/web-scan/config', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ url?: string | null; projectId?: number }>().catch(() => ({} as { url?: string | null; projectId?: number }));
    const projectId = await resolveScanProject(db, tenantId, typeof body.projectId === 'number' ? body.projectId : undefined);
    if (projectId == null) return c.json({ error: 'No project to configure — create a project first.' }, 409);
    try {
      const targetUrl = await setProjectScanTarget(db, tenantId, projectId, body.url ?? null);
      return c.json({ projectId, targetUrl });
    } catch (e) {
      if (e instanceof ScanTargetError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  // POST /web-scan/run — scan a URL now (body `url` overrides the configured target),
  // file findings, and return them + the baseline delta (manager+).
  router.post('/web-scan/run', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const body = await c.req.json<{ url?: string; projectId?: number }>().catch(() => ({} as { url?: string; projectId?: number }));
    const projectId = await resolveScanProject(db, tenantId, typeof body.projectId === 'number' ? body.projectId : undefined);
    if (projectId == null) return c.json({ error: 'No project to file findings into — create a project first.' }, 409);

    // Explicit url wins; otherwise use (and persist as) the project's configured target.
    const targetUrl = body.url?.trim() || (await getProjectScanTarget(db, tenantId, projectId));
    if (!targetUrl) return c.json({ error: 'No website configured to scan. Set a target URL first.' }, 400);

    const result = await runWebScan(db, tenantId, {
      targetUrl,
      projectId,
      trigger: 'manual',
      agentRef: userId ? `user:${userId}` : 'web-scanner',
    });
    if (!result.ok) {
      const status = result.code === 'no_project' ? 409 : 400;
      return c.json({ error: result.reason, code: result.code }, status);
    }
    // Persist the just-scanned URL as the project's target when it came in via `url`.
    if (body.url?.trim()) await setProjectScanTarget(db, tenantId, projectId, result.targetUrl).catch(() => {});
    return c.json(result, 201);
  });

  // GET /web-scan — recent web scan runs, newest first (manager+).
  // Not cached: this must reflect a just-completed scan immediately (freshness beats
  // caching a low-frequency, manager-only list that changes on every scan).
  router.get('/web-scan', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const scans = await new SecurityAuditService(db).listAudits(tenantId, { scanKind: 'web' });
    return c.json({ scans });
  });

  return router;
}
