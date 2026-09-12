import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
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
 *   POST /api/security/internal/web-scan-stage   container → API stage ingest (HMAC)
 *
 * Access config + audit results are manager-gated: they name what the Security agent
 * found, which is exactly the need-to-know surface the config restricts. The one
 * exception is `/internal/web-scan-stage`, which sits ABOVE authMiddleware because
 * its caller is the Node container running the TLS/CVE stages — it carries no tenant
 * JWT and authenticates with a per-scan HMAC token instead.
 */
import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { SecurityReviewService } from '../../application/security/SecurityReviewService';
import { SecurityTicketAccessService } from '../../application/security/SecurityTicketAccessService';
import { SecurityAuditService } from '../../application/security/SecurityAuditService';
import { dispatchSecurityAudit } from '../../application/security/securityDispatch';
import {
  runWebScan,
  resolveScanProject,
  getProjectScanTarget,
  setProjectScanTarget,
} from '../../application/security/webSecurityScan';
import { ScanTargetError } from '../../application/security/WebSecurityScanner';
import { availableAdvisoryFeeds } from '../../application/security/advisoryFeed';
import { ingestWebScanStage } from '../../application/security/webScanContainerStages';
import { WEB_SCAN_STAGE_IDS } from '../../application/security/webScanStages';
import type { TlsObservation } from '../../application/security/tlsCertificateScan';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { parseBody, parseOptionalBody, z, zNumberLike } from './requestBody';

/**
 * What the web-scan container posts back — {@link WebScanStageIngestPayload}, which
 * the ingest owns. `tls` is handed whole to the TLS evaluator, which reads its
 * nested certificate description; it is admitted as an object and never stripped.
 */
const WebScanStageBody = z.object({
  auditId: z.number(),
  token: z.string(),
  stage: z.enum(WEB_SCAN_STAGE_IDS),
  error: z.string().optional(),
  tls: z.custom<TlsObservation>((value) => typeof value === 'object' && value !== null).optional(),
  cve: z.object({ headers: z.record(z.string(), z.string()), body: z.string() }).optional(),
});

/** `code` stays optional so the handler's own "code is required" answer wins. */
const CodeReviewBody = z.object({ code: z.string().nullish(), context: z.string().optional() });

/** Audience flags are read with `!!`, and ids are `String()`ed. */
const AccessConfigBody = z.object({
  audiences: z.object({
    humans: z.unknown().optional(),
    hired: z.unknown().optional(),
    talent: z.unknown().optional(),
  }).nullish(),
  allowUserIds: z.array(zNumberLike).nullish(),
  allowAgentRefs: z.array(zNumberLike).nullish(),
});

const AuditRunBody = z.object({ projectId: z.number().nullish() });

/** Shared by the scan-target config and the run-now scan. */
const ScanTargetBody = z.object({ url: z.string().nullish(), projectId: z.number().nullish() });

export function createSecurityReviewRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // POST /internal/web-scan-stage — the container reports one web-scan stage
  // (dispatched by application/security/webScanContainerStages.dispatchWebScanStages;
  // posted by the `/web-scan` handler in api/container/server.mjs).
  //
  // Mounted ABOVE authMiddleware on purpose, exactly like runtimeRoutes'
  // `/internal/container-op`: the Node container that runs the TLS handshake and the
  // CVE fingerprint holds no tenant JWT. It authenticates with the per-scan HMAC
  // token minted at dispatch, and the TENANT is read off the audit row rather than
  // from the request body — a container is never asked which workspace it is in, so
  // it can never claim the wrong one.
  router.post('/internal/web-scan-stage', async (c) => {
    const body = await parseBody(c, WebScanStageBody);
    const result = await ingestWebScanStage(db, c.env as Env, body);
    if (!result.ok) return c.json({ error: result.reason }, result.status);
    return c.json(result);
  });

  router.use('*', authMiddleware);

  // POST /review — not cached: each call reviews caller-supplied code (unbounded,
  // one-shot compute), so there is nothing stable to cache.
  router.post('/review', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, CodeReviewBody);
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
    const body = await parseOptionalBody(c, AccessConfigBody);
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
    const body = await parseOptionalBody(c, AuditRunBody);
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
    // Which advisory feed the scan's dependency lookup will actually use, and
    // whether it is usable here — so "every scan says the lookup did not run" has
    // a visible cause instead of a silent one.
    const advisoryFeeds = availableAdvisoryFeeds(c.env as Env);
    if (projectId == null) return c.json({ projectId: null, targetUrl: null, advisoryFeeds });
    const targetUrl = await getProjectScanTarget(db, tenantId, projectId);
    return c.json({ projectId, targetUrl, advisoryFeeds });
  });

  // PUT /web-scan/config — set the website this project scans (manager+).
  router.put('/web-scan/config', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseOptionalBody(c, ScanTargetBody);
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
    const body = await parseOptionalBody(c, ScanTargetBody);
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
      // Carries the container binding + JWT_SECRET the TLS/CVE stage dispatch needs.
      env: c.env as Env,
    });
    if (!result.ok) {
      const status = result.code === 'no_project' ? 409 : 400;
      return c.json({ error: result.reason, code: result.code }, status);
    }
    // Persist the just-scanned URL as the project's target when it came in via `url`.
    if (body.url?.trim()) await setProjectScanTarget(db, tenantId, projectId, result.targetUrl).catch((error) => {
      reportCaughtError(error, { source: "presentation/routes/securityReviewRoutes.ts", operation: "createSecurityReviewRoutes" });
    });
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
