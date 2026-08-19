/**
 * RFP / RFQ Response — /api/rfp (PRD 15).
 *
 * A tenant answers an incoming RFQ/RFP. A request captures the asking business's brand +
 * requirements (greenfield or grounded on an existing project); generating a response
 * produces a co-branded proposal (capability roster, P&L, phase plan, risks, branded doc).
 * Reads are cached against a per-tenant version token bumped on every write.
 *
 *   GET    /                          list requests + response summaries        [viewer]
 *   POST   /requests                  create an RFP request                     [developer]
 *   GET    /requests/:id              request detail                            [viewer]
 *   PATCH  /requests/:id              edit a request                            [developer]
 *   POST   /requests/:id/generate     run the response generator                [developer]
 *   GET    /responses/:id             response detail (body)                    [viewer]
 *   GET    /responses/:id/document    branded doc — HTML, or `?format=pdf`      [viewer]
 *   POST   /responses/:id/reground    poll the deep analysis, re-ground roster  [developer]
 *   GET    /risks                     risk/dependency register + roll-up        [viewer]
 *   PATCH  /risks/:id                 register lifecycle (status/owner/detail)  [developer]
 *   GET    /brand                     the responder tenant's own palette        [viewer]
 *   PUT    /brand                     set it                                    [manager]
 *   POST   /brand/extract             derive a palette from a website URL       [developer]
 *   POST   /portfolio-match           rank similar projects for requirements    [viewer]
 */
import { Hono } from 'hono';
import { and, eq, desc } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { rfpRequests, rfpResponses, tenants } from '../../infrastructure/database/schema';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { generateRfpResponse, matchPortfolio, regroundRfpResponse, type RfpGenerateDeps } from '../../application/rfp/rfpService';
import { readRiskRegister, updateRegisterEntry } from '../../application/rfp/rfpRegister';
import { renderRfpDocPdf, normalizePalette, DEFAULT_TENANT_PALETTE } from '../../application/rfp/rfpBranding';
import { extractSitePalette } from '../../application/rfp/brandExtraction';
import type { RfpResponseBody } from '../../application/rfp/types';
import type { TaskService } from '../../application/task/TaskService';
import type { ToolService } from '../../application/tools/ToolService';
import type { AuditRunner } from '../../application/tools/AuditRunner';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SHORT_TTL = { kvTtlSeconds: 120, l1TtlMs: 15_000 };

function rfpVersionKey(tenantId: number): string {
  return `rfp:t:${tenantId}`;
}

interface RequestBody {
  title?: string;
  requesterOrgName?: string | null;
  requesterBrand?: unknown;
  requirements?: string | null;
  sourceMode?: 'new' | 'existing_project';
  basedOnProjectId?: number | null;
  marginPct?: number | null;
  marketingPct?: number | null;
  contingencyPct?: number | null;
  dueDate?: string | null;
}

async function listRfp(db: Db, tenantId: number) {
  const requests = await db
    .select()
    .from(rfpRequests)
    .where(eq(rfpRequests.tenantId, tenantId))
    .orderBy(desc(rfpRequests.updatedAt))
    .limit(200);
  const responses = await db
    .select({
      id: rfpResponses.id,
      requestId: rfpResponses.requestId,
      status: rfpResponses.status,
      quotedPriceUsdCents: rfpResponses.quotedPriceUsdCents,
      marginPct: rfpResponses.marginPct,
      scanRefreshed: rfpResponses.scanRefreshed,
      createdAt: rfpResponses.createdAt,
    })
    .from(rfpResponses)
    .where(eq(rfpResponses.tenantId, tenantId))
    .orderBy(desc(rfpResponses.createdAt))
    .limit(400);
  // Latest response per request.
  const latestByRequest = new Map<string, (typeof responses)[number]>();
  for (const r of responses) if (!latestByRequest.has(r.requestId)) latestByRequest.set(r.requestId, r);
  return {
    requests: requests.map((req) => ({ ...req, latestResponse: latestByRequest.get(req.id) ?? null })),
  };
}

export function createRfpRoutes(db: Db, toolService: ToolService, auditRunner: AuditRunner, taskService: TaskService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // List requests + latest response summaries.
  router.get('/', requireRole(TenantRole.VIEWER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const ver = await getCacheVersion(env, rfpVersionKey(tenantId));
    const key = `rfp:list:t:${tenantId}:v:${ver}`;
    return c.json(await getOrSetCached(env, key, () => listRfp(db, tenantId), SHORT_TTL));
  });

  // Create a request.
  router.post('/requests', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const userId = c.get('userId') as string | undefined;
    const body = await c.req.json<RequestBody>().catch(() => ({} as RequestBody));
    if (!body.title?.trim()) return c.json({ error: 'title is required' }, 400);
    const sourceMode = body.sourceMode === 'existing_project' ? 'existing_project' : 'new';
    const [row] = await db.insert(rfpRequests).values({
      tenantId,
      segmentId: segmentId ?? null,
      title: body.title.trim().slice(0, 255),
      requesterOrgName: body.requesterOrgName?.toString().trim().slice(0, 255) || null,
      requesterBrand: body.requesterBrand ?? null,
      requirements: body.requirements?.toString() || null,
      sourceMode,
      basedOnProjectId: sourceMode === 'existing_project' ? (body.basedOnProjectId ?? null) : null,
      marginPct: body.marginPct ?? null,
      marketingPct: body.marketingPct ?? null,
      contingencyPct: body.contingencyPct ?? null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      createdBy: userId ?? null,
    }).returning();
    if (!row) return c.json({ error: 'Failed to create request' }, 500);
    await bumpCacheVersion(c.env as Env, rfpVersionKey(tenantId));
    return c.json(row, 201);
  });

  // Request detail.
  router.get('/requests/:id', requireRole(TenantRole.VIEWER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [row] = await db.select().from(rfpRequests).where(and(eq(rfpRequests.id, id), eq(rfpRequests.tenantId, tenantId))).limit(1);
    if (!row) return c.json({ error: 'Request not found' }, 404);
    const responses = await db.select().from(rfpResponses).where(and(eq(rfpResponses.requestId, id), eq(rfpResponses.tenantId, tenantId))).orderBy(desc(rfpResponses.createdAt)).limit(20);
    return c.json({ request: row, responses });
  });

  // Edit a request.
  router.patch('/requests/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await c.req.json<RequestBody>().catch(() => ({} as RequestBody));
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) set.title = String(body.title).trim().slice(0, 255);
    if (body.requesterOrgName !== undefined) set.requesterOrgName = body.requesterOrgName?.toString().trim().slice(0, 255) || null;
    if (body.requesterBrand !== undefined) set.requesterBrand = body.requesterBrand ?? null;
    if (body.requirements !== undefined) set.requirements = body.requirements?.toString() || null;
    if (body.sourceMode !== undefined) set.sourceMode = body.sourceMode === 'existing_project' ? 'existing_project' : 'new';
    if (body.basedOnProjectId !== undefined) set.basedOnProjectId = body.basedOnProjectId ?? null;
    if (body.marginPct !== undefined) set.marginPct = body.marginPct ?? null;
    if (body.marketingPct !== undefined) set.marketingPct = body.marketingPct ?? null;
    if (body.contingencyPct !== undefined) set.contingencyPct = body.contingencyPct ?? null;
    if (body.dueDate !== undefined) set.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    const [row] = await db.update(rfpRequests).set(set).where(and(eq(rfpRequests.id, id), eq(rfpRequests.tenantId, tenantId))).returning();
    if (!row) return c.json({ error: 'Request not found' }, 404);
    await bumpCacheVersion(c.env as Env, rfpVersionKey(tenantId));
    return c.json(row);
  });

  /** One dependency bundle for both the generator and the re-grounder, so a
   *  deployment cannot end up firing the Architect from one and not the other. */
  const generateDeps = (env: Env): RfpGenerateDeps => ({
    env,
    db,
    toolService,
    auditRunner,
    taskService,
    secret: env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '',
  });

  // Generate a response.
  router.post('/requests/:id/generate', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const env = c.env as Env;
    const deps = generateDeps(env);
    const result = await generateRfpResponse(deps, { tenantId, requestId: id, userId });
    if (!result) return c.json({ error: 'Request not found' }, 404);
    await bumpCacheVersion(env, rfpVersionKey(tenantId));
    return c.json(result, 201);
  });

  // Response detail.
  router.get('/responses/:id', requireRole(TenantRole.VIEWER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [row] = await db.select().from(rfpResponses).where(and(eq(rfpResponses.id, id), eq(rfpResponses.tenantId, tenantId))).limit(1);
    if (!row) return c.json({ error: 'Response not found' }, 404);
    return c.json(row);
  });

  // Branded document. `?format=pdf` renders real PDF bytes server-side - the
  // attachment a proposal is actually sent as; anything else returns the
  // self-contained HTML, which is the preview and the emailable single file.
  // Both render the SAME body, so the two can never quote different numbers.
  router.get('/responses/:id/document', requireRole(TenantRole.VIEWER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const wantsPdf = c.req.query('format') === 'pdf';

    const [row] = await db
      .select({ docHtml: rfpResponses.docHtml, body: rfpResponses.body, requestId: rfpResponses.requestId, createdAt: rfpResponses.createdAt })
      .from(rfpResponses)
      .where(and(eq(rfpResponses.id, id), eq(rfpResponses.tenantId, tenantId)))
      .limit(1);
    if (!row) return c.json({ error: 'Document not found' }, 404);

    if (!wantsPdf) {
      if (!row.docHtml) return c.json({ error: 'Document not found' }, 404);
      return c.html(row.docHtml);
    }

    const body = row.body as RfpResponseBody | null;
    if (!body) return c.json({ error: 'Document not found' }, 404);
    const [request] = await db
      .select({ title: rfpRequests.title, requesterOrgName: rfpRequests.requesterOrgName })
      .from(rfpRequests).where(and(eq(rfpRequests.id, row.requestId), eq(rfpRequests.tenantId, tenantId))).limit(1);
    const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);

    const bytes = renderRfpDocPdf({
      title: request?.title ?? 'Proposal',
      requesterOrgName: request?.requesterOrgName ?? '',
      tenantName: tenant?.name ?? 'Our team',
      body,
      generatedAtIso: row.createdAt.toISOString().slice(0, 10),
    });
    const name = (request?.title ?? 'proposal').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'proposal';
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${name}-proposal.pdf"`,
        'cache-control': 'no-store',
      },
    });
  });

  // Poll the deep `architecture-analysis` run the freshness gate fired, and
  // re-ground the roster + document the moment it lands. Developer+ because it
  // WRITES the response when the run has finished.
  router.post('/responses/:id/reground', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const result = await regroundRfpResponse(generateDeps(env), { tenantId, responseId: c.req.param('id') });
    if (!result) return c.json({ error: 'Response not found' }, 404);
    if (result.regrounded) await bumpCacheVersion(env, rfpVersionKey(tenantId));
    return c.json(result);
  });

  // The risk / dependency register.
  //
  // Deliberately NOT served through the tenant version token like the list
  // above: the register is written by the lifecycle PATCH as well as by
  // generation, and the whole point of the surface is that someone closing a
  // risk sees it closed. A 120s stale read would undo that.
  router.get('/risks', requireRole(TenantRole.VIEWER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const q = c.req.query();
    return c.json(await readRiskRegister(db, tenantId, {
      ...(q.kind === 'risk' || q.kind === 'dependency' ? { kind: q.kind } : {}),
      ...(q.status === 'open' || q.status === 'accepted' || q.status === 'mitigated' || q.status === 'closed' ? { status: q.status } : {}),
      ...(q.severity === 'low' || q.severity === 'medium' || q.severity === 'high' ? { severity: q.severity } : {}),
      ...(q.requestId ? { requestId: q.requestId } : {}),
      ...(q.responseId ? { responseId: q.responseId } : {}),
      ...(q.limit ? { limit: Number(q.limit) } : {}),
    }));
  });

  router.patch('/risks/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ status?: string; ownerUserId?: string | null; detail?: string | null }>().catch(() => ({} as { status?: string; ownerUserId?: string | null; detail?: string | null }));
    const row = await updateRegisterEntry(db, tenantId, c.req.param('id'), {
      ...(body.status === 'open' || body.status === 'accepted' || body.status === 'mitigated' || body.status === 'closed' ? { status: body.status } : {}),
      ...(body.ownerUserId !== undefined ? { ownerUserId: body.ownerUserId } : {}),
      ...(body.detail !== undefined ? { detail: body.detail } : {}),
    });
    if (!row) return c.json({ error: 'Entry not found' }, 404);
    return c.json(row);
  });

  // The responder tenant's OWN brand - the other half of the co-branding, which
  // used to be a hard-coded default for every tenant on the platform.
  router.get('/brand', requireRole(TenantRole.VIEWER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const [row] = await db.select({ brandPalette: tenants.brandPalette }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return c.json({ palette: normalizePalette(row?.brandPalette ?? null, DEFAULT_TENANT_PALETTE), isDefault: !row?.brandPalette });
  });

  router.put('/brand', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ palette?: unknown }>().catch(() => ({} as { palette?: unknown }));
    // Normalised on the way in, so an invalid hex can never reach a rendered
    // document - the same guarantee the requester palette already had.
    const palette = normalizePalette(body.palette ?? null, DEFAULT_TENANT_PALETTE);
    await db.update(tenants).set({ brandPalette: palette }).where(eq(tenants.id, tenantId));
    await bumpCacheVersion(c.env as Env, rfpVersionKey(tenantId));
    return c.json({ palette });
  });

  // Derive a palette from a public website, so the asking business's colours are
  // READ rather than hand-entered off a screenshot. Server-side because a
  // browser cannot fetch a third-party origin's stylesheet.
  router.post('/brand/extract', requireRole(TenantRole.DEVELOPER), async (c) => {
    const body = await c.req.json<{ url?: string }>().catch(() => ({} as { url?: string }));
    const result = await extractSitePalette(String(body.url ?? ''));
    if ('error' in result) return c.json(result, 400);
    return c.json(result);
  });

  // Rank similar portfolio projects for a free-text requirements blob.
  router.post('/portfolio-match', requireRole(TenantRole.VIEWER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const body = await c.req.json<{ requirements?: string; excludeProjectId?: number | null }>().catch(() => ({} as { requirements?: string; excludeProjectId?: number | null }));
    const matches = await matchPortfolio(env, db, tenantId, body.requirements ?? '', body.excludeProjectId ?? null);
    return c.json({ matches });
  });

  return router;
}
