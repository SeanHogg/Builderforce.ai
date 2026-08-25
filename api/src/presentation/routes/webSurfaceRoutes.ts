/**
 * The tenant's web surface — landing pages, the website tree, programmatic SEO.
 *
 * The authoring half sits under `authMiddleware`; the reading half cannot, because
 * the visitor a landing page exists to convert has no session. Same split as data
 * rooms, forms and signatures, and for the same reason. Every rule about what is
 * publishable and what a stranger may see lives in `webSurface.ts` — this
 * translates HTTP and nothing else.
 *
 *   GET    /api/web/landing-pages                     the pages, with block counts   member
 *   POST   /api/web/landing-pages                     create a draft                 MANAGER
 *   GET    /api/web/landing-pages/:id                 the page and its blocks        member
 *   PATCH  /api/web/landing-pages/:id                 edit metadata                  MANAGER
 *   DELETE /api/web/landing-pages/:id                 remove it (blocks cascade)     MANAGER
 *   POST   /api/web/landing-pages/:id/publish         draft -> live                  MANAGER
 *   POST   /api/web/landing-pages/:id/unpublish       live -> draft|ended|archived   MANAGER
 *   POST   /api/web/landing-pages/:id/blocks          add a block                    MANAGER
 *   PATCH  /api/web/landing-pages/:id/blocks/:blockId edit a block                   MANAGER
 *   DELETE /api/web/landing-pages/:id/blocks/:blockId remove it, close the gap       MANAGER
 *   PUT    /api/web/landing-pages/:id/blocks/order    reorder, one write             MANAGER
 *
 *   GET    /api/web/website                           the navigation TREE            member
 *   POST   /api/web/website                           add a page                     MANAGER
 *   PATCH  /api/web/website/:id                       edit it                        MANAGER
 *   DELETE /api/web/website/:id                       delete, re-parenting children  MANAGER
 *
 *   GET    /api/web/seo                               patterns, not 400 rows         member
 *   POST   /api/web/seo                               generate/refresh one page      MANAGER
 *   POST   /api/web/seo/retire                        retire a whole pattern         MANAGER
 *   GET    /api/web/sitemap                           everything publishable         member
 *
 *   GET    /api/public/web/l/:slug                    a LIVE landing page, no session
 *   POST   /api/public/web/l/:slug/view               count a view, no session
 *   POST   /api/public/web/l/:slug/convert            count a conversion, no session
 *
 * MANAGER on every write is the same bar `siteManageRoutes` already sets for the
 * project site: publishing a page puts words on the open internet under the
 * tenant's name, which is an outbound act rather than an internal edit.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { resolveActorFromContext } from '../../application/activity/activityLog';
import {
  WebSurfaceError,
  addBlock,
  createLandingPage,
  createWebsitePage,
  deleteBlock,
  deleteLandingPage,
  deleteWebsitePage,
  landingPageDetail,
  listLandingPages,
  publicLandingPage,
  publishLandingPage,
  recordLandingPageConversion,
  recordLandingPageView,
  reorderBlocks,
  retireSeoPattern,
  seoPatternSummary,
  sitemapEntries,
  unpublishLandingPage,
  updateBlock,
  updateLandingPage,
  updateWebsitePage,
  upsertSeoPage,
  websiteTree,
} from '../../application/marketing/webSurface';

const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof WebSurfaceError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};

const pageId = (raw: string): number => {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) throw new WebSurfaceError('That is not a page id.', 400);
  return Math.floor(id);
};

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A caller-supplied ISO date, or `null` to clear it. `undefined` means "leave it
 *  alone", which is why this cannot collapse to a single nullable return. */
const when = (v: unknown): Date | null | undefined => {
  if (v === null) return null;
  const s = str(v);
  if (s === undefined) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new WebSurfaceError('That is not a date.', 400);
  return d;
};

export function createWebSurfaceRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const manager = requireRole(TenantRole.MANAGER);
  const tenant = (c: { get: (k: string) => unknown }) => c.get('tenantId') as number;

  // ── Landing pages ─────────────────────────────────────────────────────────

  router.get('/landing-pages', (c) => handle(async () =>
    Response.json({ pages: await listLandingPages(db, tenant(c)) })));

  router.get('/landing-pages/:id', (c) => handle(async () =>
    Response.json(await landingPageDetail(db, tenant(c), pageId(c.req.param('id'))))));

  router.post('/landing-pages', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const page = await createLandingPage(
      db,
      c.env as Env,
      tenant(c),
      await resolveActorFromContext(c.env as Env, db, c),
      {
        slug: String(body.slug ?? ''),
        title: String(body.title ?? ''),
        campaignId: num(body.campaignId) ?? null,
        goalMetric: str(body.goalMetric) ?? null,
        ...(str(body.shellKind) !== undefined ? { shellKind: str(body.shellKind) as string } : {}),
        endsAt: when(body.endsAt) ?? null,
      },
    );
    return Response.json(page, { status: 201 });
  }));

  router.patch('/landing-pages/:id', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const patch: Parameters<typeof updateLandingPage>[5] = {};
    if (body.slug !== undefined) patch.slug = String(body.slug);
    if (body.title !== undefined) patch.title = String(body.title);
    if (body.campaignId !== undefined) patch.campaignId = num(body.campaignId) ?? null;
    if (body.goalMetric !== undefined) patch.goalMetric = str(body.goalMetric) ?? null;
    if (body.shellKind !== undefined) patch.shellKind = String(body.shellKind);
    if (body.endsAt !== undefined) patch.endsAt = when(body.endsAt) ?? null;
    return Response.json(await updateLandingPage(
      db, c.env as Env, tenant(c),
      await resolveActorFromContext(c.env as Env, db, c),
      pageId(c.req.param('id')), patch,
    ));
  }));

  router.delete('/landing-pages/:id', manager, (c) => handle(async () =>
    Response.json(await deleteLandingPage(
      db, c.env as Env, tenant(c),
      await resolveActorFromContext(c.env as Env, db, c),
      pageId(c.req.param('id')),
    ))));

  router.post('/landing-pages/:id/publish', manager, (c) => handle(async () =>
    Response.json(await publishLandingPage(
      db, c.env as Env, tenant(c),
      await resolveActorFromContext(c.env as Env, db, c),
      pageId(c.req.param('id')),
    ))));

  /** The caller must say WHICH exit this is — see `unpublishLandingPage`. An
   *  unrecognised target is rejected rather than defaulted, because defaulting
   *  here silently turns "this campaign is over" into "still editing". */
  router.post('/landing-pages/:id/unpublish', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
    const to = str(body.to);
    if (to !== 'draft' && to !== 'ended' && to !== 'archived') {
      throw new WebSurfaceError("to must be 'draft', 'ended' or 'archived'", 400);
    }
    return Response.json(await unpublishLandingPage(
      db, c.env as Env, tenant(c),
      await resolveActorFromContext(c.env as Env, db, c),
      pageId(c.req.param('id')), to,
    ));
  }));

  // ── Blocks ────────────────────────────────────────────────────────────────

  router.post('/landing-pages/:id/blocks', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const kind = str(body.kind);
    if (!kind) throw new WebSurfaceError('kind is required', 400);
    const block = await addBlock(db, tenant(c), pageId(c.req.param('id')), {
      kind,
      content: body.content,
      ...(num(body.position) !== undefined ? { position: num(body.position) as number } : {}),
      ...(typeof body.isVisible === 'boolean' ? { isVisible: body.isVisible } : {}),
    });
    return Response.json(block, { status: 201 });
  }));

  /** Declared BEFORE `/blocks/:blockId` — Hono matches in registration order, and
   *  a literal `order` would otherwise be swallowed as a block id. */
  router.put('/landing-pages/:id/blocks/order', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const order = Array.isArray(body.order) ? body.order : null;
    if (!order || !order.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      throw new WebSurfaceError('order must be an array of block ids', 400);
    }
    return Response.json({
      blocks: await reorderBlocks(db, tenant(c), pageId(c.req.param('id')), order as number[]),
    });
  }));

  router.patch('/landing-pages/:id/blocks/:blockId', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const patch: Parameters<typeof updateBlock>[4] = {};
    if (body.kind !== undefined) patch.kind = String(body.kind);
    if (body.content !== undefined) patch.content = body.content;
    if (typeof body.isVisible === 'boolean') patch.isVisible = body.isVisible;
    return Response.json(await updateBlock(
      db, tenant(c), pageId(c.req.param('id')), pageId(c.req.param('blockId')), patch,
    ));
  }));

  router.delete('/landing-pages/:id/blocks/:blockId', manager, (c) => handle(async () =>
    Response.json(await deleteBlock(
      db, tenant(c), pageId(c.req.param('id')), pageId(c.req.param('blockId')),
    ))));

  // ── Website ───────────────────────────────────────────────────────────────

  router.get('/website', (c) => handle(async () =>
    Response.json({ tree: await websiteTree(db, tenant(c)) })));

  router.post('/website', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const page = await createWebsitePage(
      db, c.env as Env, tenant(c),
      await resolveActorFromContext(c.env as Env, db, c),
      {
        path: String(body.path ?? ''),
        title: String(body.title ?? ''),
        navLabel: str(body.navLabel) ?? null,
        navPosition: num(body.navPosition) ?? null,
        parentPath: str(body.parentPath) ?? null,
        bodyMarkdown: str(body.bodyMarkdown) ?? null,
        canonicalPath: str(body.canonicalPath) ?? null,
        ...(str(body.shellKind) !== undefined ? { shellKind: str(body.shellKind) as string } : {}),
      },
    );
    return Response.json(page, { status: 201 });
  }));

  router.patch('/website/:id', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const patch: Parameters<typeof updateWebsitePage>[5] = {};
    if (body.path !== undefined) patch.path = String(body.path);
    if (body.title !== undefined) patch.title = String(body.title);
    if (body.navLabel !== undefined) patch.navLabel = str(body.navLabel) ?? null;
    if (body.navPosition !== undefined) patch.navPosition = num(body.navPosition) ?? null;
    if (body.parentPath !== undefined) patch.parentPath = str(body.parentPath) ?? null;
    if (body.bodyMarkdown !== undefined) patch.bodyMarkdown = str(body.bodyMarkdown) ?? null;
    if (body.canonicalPath !== undefined) patch.canonicalPath = str(body.canonicalPath) ?? null;
    if (body.shellKind !== undefined) patch.shellKind = String(body.shellKind);
    return Response.json(await updateWebsitePage(
      db, c.env as Env, tenant(c),
      await resolveActorFromContext(c.env as Env, db, c),
      pageId(c.req.param('id')), patch,
    ));
  }));

  router.delete('/website/:id', manager, (c) => handle(async () =>
    Response.json(await deleteWebsitePage(
      db, c.env as Env, tenant(c),
      await resolveActorFromContext(c.env as Env, db, c),
      pageId(c.req.param('id')),
    ))));

  // ── Programmatic SEO ──────────────────────────────────────────────────────

  router.get('/seo', (c) => handle(async () =>
    Response.json({ patterns: await seoPatternSummary(db, tenant(c)) })));

  router.post('/seo', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const pattern = str(body.pattern);
    if (!pattern) throw new WebSurfaceError('pattern is required', 400);
    return Response.json(await upsertSeoPage(db, tenant(c), {
      pattern,
      path: String(body.path ?? ''),
      title: String(body.title ?? ''),
      metaDescription: str(body.metaDescription) ?? null,
      params: body.params,
      structuredData: body.structuredData,
    }));
  }));

  router.post('/seo/retire', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const pattern = str(body.pattern);
    if (!pattern) throw new WebSurfaceError('pattern is required', 400);
    return Response.json(await retireSeoPattern(db, tenant(c), pattern));
  }));

  router.get('/sitemap', (c) => handle(async () =>
    Response.json(await sitemapEntries(db, tenant(c)))));

  return router;
}

/**
 * The public half. No `authMiddleware`, so the tenant cannot come from a session
 * and is named in the path instead — the same shape every other public tenant
 * surface uses. `publicLandingPage` refuses to return a draft regardless of who
 * asks, which is where the actual guarantee lives.
 */
export function createPublicWebSurfaceRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  const tenantParam = (raw: string): number => {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) throw new WebSurfaceError('That is not a workspace id.', 400);
    return Math.floor(id);
  };

  router.get('/:tenantId/l/:slug', (c) => handle(async () => {
    const page = await publicLandingPage(db, tenantParam(c.req.param('tenantId')), c.req.param('slug'));
    if (!page) return Response.json({ error: 'No published page at that address.' }, { status: 404 });
    return Response.json(page);
  }));

  /** Fire-and-forget counters. 204 with no body: a visitor's browser has nothing
   *  to do with the result, and returning the count would leak campaign
   *  performance to anyone who can load the page. */
  router.post('/:tenantId/l/:slug/view', (c) => handle(async () => {
    const tenantId = tenantParam(c.req.param('tenantId'));
    const page = await publicLandingPage(db, tenantId, c.req.param('slug'));
    if (page) await recordLandingPageView(db, tenantId, page.id);
    return new Response(null, { status: 204 });
  }));

  router.post('/:tenantId/l/:slug/convert', (c) => handle(async () => {
    const tenantId = tenantParam(c.req.param('tenantId'));
    const page = await publicLandingPage(db, tenantId, c.req.param('slug'));
    if (page) await recordLandingPageConversion(db, tenantId, page.id);
    return new Response(null, { status: 204 });
  }));

  return router;
}
