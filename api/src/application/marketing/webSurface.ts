/**
 * The tenant's own web surface — landing pages, the website, and programmatic SEO.
 *
 * ── WHY THIS IS ONE SERVICE AND NOT THREE ───────────────────────────────────
 * `landing_pages`, `website_pages` and `marketing_seo_pages` were three of the
 * targets PRD 19 §9 found with schema but no feature path. They are ONE feature
 * because they are one question — "what does this tenant publish on the web" —
 * and because the three tables are deliberately NOT merged with each other. The
 * `landing_pages` docstring already argues that pairing: a landing page has a
 * campaign, a conversion goal and a lifespan in weeks; a website page has a
 * navigation position and a permanent URL that SEO depends on; merging them is
 * how a campaign page ends up in the sitemap. Three tables, one owner, one
 * service — the alternative is three services that each learn `shell_kind` and
 * publication separately and then disagree about what "live" means.
 *
 * ── THE MERGE, AND WHICH SIDE WON ───────────────────────────────────────────
 * This consolidates BurnRateOS's `landingPages` route module INTO the existing
 * Builderforce owner rather than porting it beside one. Builderforce was the more
 * mature side and keeps what it already had:
 *
 *   · kernel `objects` registration — `landing_page` is a registered kind, so a
 *     page is addressable by the same id every other object uses, and Canvas,
 *     activity and permissions reach it without a second identity;
 *   · `shell_kind`, so the renderer is RESOLVED rather than remembered;
 *   · `campaign_id` + `goal_metric`, which is what makes a landing page an
 *     attributable part of a campaign instead of a standalone document;
 *   · the publish/release pipeline, custom domains and traffic that
 *     `publishStaticSite.ts` / `siteReleases.ts` / `siteManageRoutes.ts` already
 *     own for a project's hosted site.
 *
 * BurnRateOS contributed the behaviour Builderforce had schema for and no path to:
 * the block-based builder (ordered, individually hidable blocks), the website
 * page's navigation tree (`nav_label` / `nav_position` / `parent_path`) and its
 * canonical-path decision, and the unauthenticated read of a PUBLISHED page. Its
 * plain per-table CRUD and its second notion of a "site" did not come across —
 * that is what merging means here.
 *
 * ── PUBLICATION IS A TRANSITION, NOT A COLUMN WRITE ─────────────────────────
 * {@link publishLandingPage} and {@link unpublishLandingPage} are the only ways
 * `status` reaches `live` or leaves it, because publication has to stamp
 * `published_at` and, on the way out, decide whether the page ENDED or went back
 * to draft. A caller allowed to PATCH `status` directly would eventually ship a
 * page that is live with no publication time, which is the row every analytics
 * join then has to special-case.
 *
 * ── WHY THE PUBLIC READS ARE HERE AND NOT IN A ROUTE ────────────────────────
 * {@link publicLandingPage} and {@link publicWebsitePage} take no actor and check
 * no session, so the danger is that a future caller reuses them for the authoring
 * view and quietly serves drafts. They therefore filter on `status`/`published_at`
 * INSIDE the query rather than returning a row for the caller to check, and they
 * never return a draft under any argument. One function, one guarantee.
 *
 * ── TENANCY ─────────────────────────────────────────────────────────────────
 * `landing_pages` is `tenant_id NOT NULL` — a landing page always belongs to
 * someone. `website_pages` and `marketing_seo_pages` are NULLABLE on purpose:
 * they carry the platform's own marketing site as well as a tenant's, so they use
 * `scopedToNullableTenant`, which resolves `null` to `IS NULL` rather than to
 * "any tenant". Passing a tenant id never reaches platform rows and passing
 * `null` never reaches a tenant's.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  landingPageBlocks,
  landingPages,
  marketingSeoPages,
  websitePages,
} from '../../infrastructure/database/schema';
import { scopedToNullableTenant, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { registerObject } from '../kernel/ObjectRegistry';

/** `landing_pages.status`. `ended` is terminal-by-intent and `archived` is
 *  terminal-by-housekeeping; both are off the live surface, and keeping them
 *  apart is what lets a campaign report say why a page stopped. */
export type LandingPageStatus = 'draft' | 'live' | 'ended' | 'archived';

const LIVE: LandingPageStatus = 'live';

export type LandingPageInput = {
  slug: string;
  title: string;
  campaignId?: number | null;
  goalMetric?: string | null;
  shellKind?: string;
  endsAt?: Date | null;
};

export type BlockInput = {
  kind: string;
  content?: unknown;
  position?: number;
  isVisible?: boolean;
};

export type WebsitePageInput = {
  path: string;
  title: string;
  navLabel?: string | null;
  navPosition?: number | null;
  parentPath?: string | null;
  bodyMarkdown?: string | null;
  canonicalPath?: string | null;
  shellKind?: string;
};

export type SeoPageInput = {
  pattern: string;
  path: string;
  title: string;
  metaDescription?: string | null;
  params?: unknown;
  structuredData?: unknown;
};

/** A slug/path the URL layer can actually carry. Rejected rather than coerced:
 *  silently rewriting a slug means the page the author saved is not the page at
 *  the address they were shown. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PATH = /^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/;

export class WebSurfaceError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'WebSurfaceError';
  }
}

const requireSlug = (slug: string): string => {
  const s = slug.trim().toLowerCase();
  if (!SLUG.test(s) || s.length > 200) {
    throw new WebSurfaceError('slug must be lowercase alphanumeric words separated by single hyphens');
  }
  return s;
};

const requirePath = (path: string): string => {
  const p = path.trim();
  if (!PATH.test(p) || p.length > 500) {
    throw new WebSurfaceError('path must be an absolute URL path with no query or fragment');
  }
  // '/a/' and '/a' are the same page; storing both is how two rows end up
  // fighting over one canonical URL.
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
};

const requireTitle = (title: string): string => {
  const t = title.trim();
  if (!t) throw new WebSurfaceError('title is required');
  return t.slice(0, 300);
};

// ── Landing pages ───────────────────────────────────────────────────────────

/** Every landing page for the tenant, newest first, with its block count. One
 *  query: a per-page block fan-out is the N+1 that only appears once a tenant
 *  runs more than a handful of campaigns. */
export async function listLandingPages(db: Db, tenantId: number) {
  return db
    .select({
      id: landingPages.id,
      objectId: landingPages.objectId,
      slug: landingPages.slug,
      title: landingPages.title,
      campaignId: landingPages.campaignId,
      goalMetric: landingPages.goalMetric,
      status: landingPages.status,
      shellKind: landingPages.shellKind,
      publishedAt: landingPages.publishedAt,
      endsAt: landingPages.endsAt,
      viewCount: landingPages.viewCount,
      conversionCount: landingPages.conversionCount,
      updatedAt: landingPages.updatedAt,
      blockCount: sql<number>`(
        select count(*)::int from ${landingPageBlocks}
        where ${landingPageBlocks.pageId} = ${landingPages.id}
      )`,
    })
    .from(landingPages)
    .where(scopedToTenant(landingPages, tenantId))
    .orderBy(desc(landingPages.updatedAt));
}

/** One landing page with its blocks in render order. */
export async function landingPageDetail(db: Db, tenantId: number, id: number) {
  const [page] = await db
    .select()
    .from(landingPages)
    .where(scopedToTenant(landingPages, tenantId, eq(landingPages.id, id)))
    .limit(1);
  if (!page) throw new WebSurfaceError('landing page not found', 404);

  const blocks = await db
    .select()
    .from(landingPageBlocks)
    .where(scopedToTenant(landingPageBlocks, tenantId, eq(landingPageBlocks.pageId, id)))
    .orderBy(asc(landingPageBlocks.position));

  return { ...page, blocks };
}

export async function createLandingPage(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  input: LandingPageInput,
) {
  const slug = requireSlug(input.slug);
  const title = requireTitle(input.title);

  const [existing] = await db
    .select({ id: landingPages.id })
    .from(landingPages)
    .where(scopedToTenant(landingPages, tenantId, eq(landingPages.slug, slug)))
    .limit(1);
  if (existing) throw new WebSurfaceError(`a landing page already uses /${slug}`, 409);

  // Insert, then register, then backfill `object_id` — the same order
  // `companyObjectId` uses, and it is forced rather than chosen: `registerObject`
  // keys on `refId`, which is the row's serial id and therefore does not exist
  // until the insert has run.
  const [inserted] = await db
    .insert(landingPages)
    .values({
      tenantId,
      slug,
      title,
      campaignId: input.campaignId ?? null,
      goalMetric: input.goalMetric ?? null,
      shellKind: input.shellKind ?? 'public',
      endsAt: input.endsAt ?? null,
      status: 'draft',
    })
    .returning();
  if (!inserted) throw new WebSurfaceError('could not create landing page');

  const registered = await registerObject(db, env, {
    tenantId,
    kind: 'landing_page',
    refId: inserted.id,
    domain: 'growth',
    title,
  });
  const [row] = await db
    .update(landingPages)
    .set({ objectId: registered.id, updatedAt: new Date() })
    .where(scopedToTenant(landingPages, tenantId, eq(landingPages.id, inserted.id)))
    .returning();
  if (!row) throw new WebSurfaceError('could not create landing page');

  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: 'landing_page.created',
    targetType: 'landing_page',
    targetId: String(row.id),
    metadata: { slug, title },
  });
  return row;
}

export async function updateLandingPage(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  id: number,
  patch: Partial<LandingPageInput>,
) {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.slug !== undefined) values.slug = requireSlug(patch.slug);
  if (patch.title !== undefined) values.title = requireTitle(patch.title);
  if (patch.campaignId !== undefined) values.campaignId = patch.campaignId;
  if (patch.goalMetric !== undefined) values.goalMetric = patch.goalMetric;
  if (patch.shellKind !== undefined) values.shellKind = patch.shellKind;
  if (patch.endsAt !== undefined) values.endsAt = patch.endsAt;

  const [row] = await db
    .update(landingPages)
    .set(values)
    .where(scopedToTenant(landingPages, tenantId, eq(landingPages.id, id)))
    .returning();
  if (!row) throw new WebSurfaceError('landing page not found', 404);

  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: 'landing_page.updated',
    targetType: 'landing_page',
    targetId: String(id),
    metadata: { fields: Object.keys(values).filter((k) => k !== 'updatedAt') },
  });
  return row;
}

/** The only way `status` reaches `live`. Stamps `published_at` in the same write,
 *  so a live page without a publication time is unrepresentable. */
export async function publishLandingPage(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  id: number,
) {
  const [row] = await db
    .update(landingPages)
    .set({ status: LIVE, publishedAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(landingPages, tenantId, eq(landingPages.id, id)))
    .returning();
  if (!row) throw new WebSurfaceError('landing page not found', 404);

  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: 'landing_page.published',
    targetType: 'landing_page',
    targetId: String(id),
    metadata: { slug: row.slug },
  });
  return row;
}

/** Leaving `live` is two different events and the caller has to say which:
 *  `ended` means the campaign is over and the numbers are final; `draft` means it
 *  is coming back. Collapsing them loses the only signal a campaign report has. */
export async function unpublishLandingPage(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  id: number,
  to: 'draft' | 'ended' | 'archived',
) {
  const [row] = await db
    .update(landingPages)
    .set({ status: to, updatedAt: new Date() })
    .where(scopedToTenant(landingPages, tenantId, eq(landingPages.id, id)))
    .returning();
  if (!row) throw new WebSurfaceError('landing page not found', 404);

  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: 'landing_page.unpublished',
    targetType: 'landing_page',
    targetId: String(id),
    metadata: { slug: row.slug, to },
  });
  return row;
}

export async function deleteLandingPage(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  id: number,
) {
  // Blocks go with it through the FK's ON DELETE CASCADE — deleting them here as
  // well would be a second, racier answer to the same question.
  const [row] = await db
    .delete(landingPages)
    .where(scopedToTenant(landingPages, tenantId, eq(landingPages.id, id)))
    .returning({ id: landingPages.id, slug: landingPages.slug });
  if (!row) throw new WebSurfaceError('landing page not found', 404);

  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: 'landing_page.deleted',
    targetType: 'landing_page',
    targetId: String(id),
    metadata: { slug: row.slug },
  });
  return row;
}

// ── Blocks ──────────────────────────────────────────────────────────────────

/** Append a block, or insert it at `position`. Position is UNIQUE per page, so an
 *  insert in the middle shifts the tail rather than colliding — done in SQL for
 *  the same reason the shift is not done client-side: two authors adding a block
 *  at once must not produce two blocks claiming slot 3. */
export async function addBlock(
  db: Db,
  tenantId: number,
  pageId: number,
  input: BlockInput,
) {
  const [page] = await db
    .select({ id: landingPages.id })
    .from(landingPages)
    .where(scopedToTenant(landingPages, tenantId, eq(landingPages.id, pageId)))
    .limit(1);
  if (!page) throw new WebSurfaceError('landing page not found', 404);

  const [tail] = await db
    .select({ next: sql<number>`coalesce(max(${landingPageBlocks.position}) + 1, 0)` })
    .from(landingPageBlocks)
    .where(scopedToTenant(landingPageBlocks, tenantId, eq(landingPageBlocks.pageId, pageId)));
  const next = tail?.next ?? 0;

  const at = input.position === undefined ? next : Math.max(0, Math.min(input.position, next));
  if (at < next) {
    await db
      .update(landingPageBlocks)
      .set({ position: sql`${landingPageBlocks.position} + 1` })
      .where(scopedToTenant(
        landingPageBlocks,
        tenantId,
        and(eq(landingPageBlocks.pageId, pageId), sql`${landingPageBlocks.position} >= ${at}`),
      ));
  }

  const [row] = await db
    .insert(landingPageBlocks)
    .values({
      tenantId,
      pageId,
      kind: input.kind,
      content: input.content ?? null,
      position: at,
      isVisible: input.isVisible ?? true,
    })
    .returning();
  return row;
}

export async function updateBlock(
  db: Db,
  tenantId: number,
  pageId: number,
  blockId: number,
  patch: Partial<Omit<BlockInput, 'position'>>,
) {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.kind !== undefined) values.kind = patch.kind;
  if (patch.content !== undefined) values.content = patch.content;
  if (patch.isVisible !== undefined) values.isVisible = patch.isVisible;

  const [row] = await db
    .update(landingPageBlocks)
    .set(values)
    .where(scopedToTenant(
      landingPageBlocks,
      tenantId,
      and(eq(landingPageBlocks.id, blockId), eq(landingPageBlocks.pageId, pageId)),
    ))
    .returning();
  if (!row) throw new WebSurfaceError('block not found', 404);
  return row;
}

/**
 * Reorder a page's blocks to exactly `order`.
 *
 * Two writes, not N: every block is first parked at a negative position, then
 * written to its final one. `position` is UNIQUE per page, so a naive
 * "set each block to its new index" collides the moment two blocks swap — the
 * first UPDATE lands on a slot the second still holds. Negative parking is
 * outside the range any real block occupies, so the window is always free.
 */
export async function reorderBlocks(
  db: Db,
  tenantId: number,
  pageId: number,
  order: number[],
) {
  const current = await db
    .select({ id: landingPageBlocks.id })
    .from(landingPageBlocks)
    .where(scopedToTenant(landingPageBlocks, tenantId, eq(landingPageBlocks.pageId, pageId)));

  const known = new Set(current.map((b) => b.id));
  if (order.length !== known.size || order.some((id) => !known.has(id)) || new Set(order).size !== order.length) {
    throw new WebSurfaceError('order must list every block on the page exactly once');
  }
  if (order.length === 0) return [];

  await db.transaction(async (tx) => {
    for (const [i, id] of order.entries()) {
      await tx
        .update(landingPageBlocks)
        .set({ position: -(i + 1) })
        .where(scopedToTenant(landingPageBlocks, tenantId, eq(landingPageBlocks.id, id)));
    }
    for (const [i, id] of order.entries()) {
      await tx
        .update(landingPageBlocks)
        .set({ position: i, updatedAt: new Date() })
        .where(scopedToTenant(landingPageBlocks, tenantId, eq(landingPageBlocks.id, id)));
    }
  });

  return db
    .select()
    .from(landingPageBlocks)
    .where(scopedToTenant(landingPageBlocks, tenantId, eq(landingPageBlocks.pageId, pageId)))
    .orderBy(asc(landingPageBlocks.position));
}

/** Remove a block and close the gap, so positions stay 0..n-1 with no hole for
 *  the unique index to trip over on the next insert. */
export async function deleteBlock(
  db: Db,
  tenantId: number,
  pageId: number,
  blockId: number,
) {
  const [row] = await db
    .delete(landingPageBlocks)
    .where(scopedToTenant(
      landingPageBlocks,
      tenantId,
      and(eq(landingPageBlocks.id, blockId), eq(landingPageBlocks.pageId, pageId)),
    ))
    .returning({ position: landingPageBlocks.position });
  if (!row) throw new WebSurfaceError('block not found', 404);

  await db
    .update(landingPageBlocks)
    .set({ position: sql`${landingPageBlocks.position} - 1` })
    .where(scopedToTenant(
      landingPageBlocks,
      tenantId,
      and(eq(landingPageBlocks.pageId, pageId), sql`${landingPageBlocks.position} > ${row.position}`),
    ));
  return { deleted: blockId };
}

// ── Website pages ───────────────────────────────────────────────────────────

/** The website as a navigation TREE, which is the shape the nav renders and the
 *  shape `parent_path` exists to describe. Built in memory from one query: the
 *  alternative is a recursive CTE for a structure that is a few dozen rows. */
export async function websiteTree(db: Db, tenantId: number | null) {
  const rows = await db
    .select()
    .from(websitePages)
    .where(scopedToNullableTenant(websitePages, tenantId))
    .orderBy(asc(websitePages.navPosition), asc(websitePages.path));

  type Node = (typeof rows)[number] & { children: Node[] };
  const byPath = new Map<string, Node>(rows.map((r) => [r.path, { ...r, children: [] as Node[] }]));
  const roots: Node[] = [];
  for (const node of byPath.values()) {
    const parent = node.parentPath ? byPath.get(node.parentPath) : undefined;
    // A page whose parent was deleted becomes a root rather than disappearing —
    // an orphan that renders nowhere is how a page silently leaves the site.
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function createWebsitePage(
  db: Db,
  env: Env,
  tenantId: number | null,
  actor: ActorIdentity,
  input: WebsitePageInput,
) {
  const path = requirePath(input.path);
  const [existing] = await db
    .select({ id: websitePages.id })
    .from(websitePages)
    .where(scopedToNullableTenant(websitePages, tenantId, eq(websitePages.path, path)))
    .limit(1);
  if (existing) throw new WebSurfaceError(`a website page already uses ${path}`, 409);

  const [row] = await db
    .insert(websitePages)
    .values({
      tenantId,
      path,
      title: requireTitle(input.title),
      navLabel: input.navLabel ?? null,
      navPosition: input.navPosition ?? null,
      parentPath: input.parentPath ? requirePath(input.parentPath) : null,
      bodyMarkdown: input.bodyMarkdown ?? null,
      canonicalPath: input.canonicalPath ? requirePath(input.canonicalPath) : null,
      shellKind: input.shellKind ?? 'public',
    })
    .returning();
  if (!row) throw new WebSurfaceError('could not create website page');

  if (tenantId !== null) {
    await recordActivity(env, db, {
      tenantId,
      actor,
      verb: 'website_page.created',
      targetType: 'website_page',
      targetId: String(row.id),
      metadata: { path },
    });
  }
  return row;
}

export async function updateWebsitePage(
  db: Db,
  env: Env,
  tenantId: number | null,
  actor: ActorIdentity,
  id: number,
  patch: Partial<WebsitePageInput>,
) {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.path !== undefined) values.path = requirePath(patch.path);
  if (patch.title !== undefined) values.title = requireTitle(patch.title);
  if (patch.navLabel !== undefined) values.navLabel = patch.navLabel;
  if (patch.navPosition !== undefined) values.navPosition = patch.navPosition;
  if (patch.parentPath !== undefined) values.parentPath = patch.parentPath ? requirePath(patch.parentPath) : null;
  if (patch.bodyMarkdown !== undefined) values.bodyMarkdown = patch.bodyMarkdown;
  if (patch.canonicalPath !== undefined) values.canonicalPath = patch.canonicalPath ? requirePath(patch.canonicalPath) : null;
  if (patch.shellKind !== undefined) values.shellKind = patch.shellKind;

  const [row] = await db
    .update(websitePages)
    .set(values)
    .where(scopedToNullableTenant(websitePages, tenantId, eq(websitePages.id, id)))
    .returning();
  if (!row) throw new WebSurfaceError('website page not found', 404);

  if (tenantId !== null) {
    await recordActivity(env, db, {
      tenantId,
      actor,
      verb: 'website_page.updated',
      targetType: 'website_page',
      targetId: String(id),
      metadata: { path: row.path },
    });
  }
  return row;
}

/** Deleting a page re-parents its children onto ITS parent rather than orphaning
 *  them. A section head being removed should collapse the level, not delete the
 *  pages underneath it from the navigation. */
export async function deleteWebsitePage(
  db: Db,
  env: Env,
  tenantId: number | null,
  actor: ActorIdentity,
  id: number,
) {
  const [page] = await db
    .select({ path: websitePages.path, parentPath: websitePages.parentPath })
    .from(websitePages)
    .where(scopedToNullableTenant(websitePages, tenantId, eq(websitePages.id, id)))
    .limit(1);
  if (!page) throw new WebSurfaceError('website page not found', 404);

  await db.transaction(async (tx) => {
    await tx
      .update(websitePages)
      .set({ parentPath: page.parentPath ?? null, updatedAt: new Date() })
      .where(scopedToNullableTenant(websitePages, tenantId, eq(websitePages.parentPath, page.path)));
    await tx
      .delete(websitePages)
      .where(scopedToNullableTenant(websitePages, tenantId, eq(websitePages.id, id)));
  });

  if (tenantId !== null) {
    await recordActivity(env, db, {
      tenantId,
      actor,
      verb: 'website_page.deleted',
      targetType: 'website_page',
      targetId: String(id),
      metadata: { path: page.path },
    });
  }
  return { deleted: id, path: page.path };
}

// ── Programmatic SEO ────────────────────────────────────────────────────────

/** SEO pages grouped by the pattern that generates them, which is the unit a
 *  marketer actually operates on — "/salary/:jobSlug is 400 pages" — rather than
 *  a flat list nobody can act on. */
export async function seoPatternSummary(db: Db, tenantId: number | null) {
  return db
    .select({
      pattern: marketingSeoPages.pattern,
      pageCount: sql<number>`count(*)::int`,
      published: sql<number>`count(*) filter (where ${marketingSeoPages.status} = 'published')::int`,
      impressions: sql<number>`coalesce(sum(${marketingSeoPages.impressionCount}), 0)::int`,
      lastRenderedAt: sql<Date | null>`max(${marketingSeoPages.lastRenderedAt})`,
    })
    .from(marketingSeoPages)
    .where(scopedToNullableTenant(marketingSeoPages, tenantId))
    .groupBy(marketingSeoPages.pattern)
    .orderBy(desc(sql`count(*)`));
}

/**
 * Create or refresh one generated page.
 *
 * UPSERT on `path`, because generation is re-run: a pattern that produced 400
 * pages last month produces 412 this month, and the 400 must be UPDATED rather
 * than duplicated. `uq_marketing_seo_pages_path` is global, not per-tenant —
 * two tenants cannot both own `/salary/engineer/london`, since there is one
 * public URL space — so the conflict target is the path alone.
 */
export async function upsertSeoPage(
  db: Db,
  tenantId: number | null,
  input: SeoPageInput,
) {
  const path = requirePath(input.path);
  const [row] = await db
    .insert(marketingSeoPages)
    .values({
      tenantId,
      pattern: input.pattern,
      path,
      title: requireTitle(input.title),
      metaDescription: input.metaDescription ?? null,
      params: input.params ?? null,
      structuredData: input.structuredData ?? null,
      status: 'published',
      lastRenderedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: marketingSeoPages.path,
      set: {
        pattern: input.pattern,
        title: requireTitle(input.title),
        metaDescription: input.metaDescription ?? null,
        params: input.params ?? null,
        structuredData: input.structuredData ?? null,
        status: 'published',
        lastRenderedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

/** Retire every page a pattern generated, without deleting them: an unpublished
 *  page still holds its impression history, and a deleted one takes the evidence
 *  of what the pattern was worth with it. */
export async function retireSeoPattern(db: Db, tenantId: number | null, pattern: string) {
  const rows = await db
    .update(marketingSeoPages)
    .set({ status: 'retired', updatedAt: new Date() })
    .where(scopedToNullableTenant(marketingSeoPages, tenantId, eq(marketingSeoPages.pattern, pattern)))
    .returning({ id: marketingSeoPages.id });
  return { retired: rows.length };
}

// ── Public reads ────────────────────────────────────────────────────────────

/**
 * A PUBLISHED landing page and its VISIBLE blocks, by slug. No actor, no session.
 *
 * The status filter is in the query rather than applied by the caller, and the
 * function has no argument that relaxes it, so there is no call site that can
 * accidentally serve a draft to the public. `ends_at` is enforced here too — a
 * campaign that ended yesterday is not live today just because nothing has run
 * a sweep to change its status.
 */
export async function publicLandingPage(db: Db, tenantId: number, slug: string) {
  const [page] = await db
    .select({
      id: landingPages.id,
      slug: landingPages.slug,
      title: landingPages.title,
      shellKind: landingPages.shellKind,
      goalMetric: landingPages.goalMetric,
      publishedAt: landingPages.publishedAt,
    })
    .from(landingPages)
    .where(scopedToTenant(
      landingPages,
      tenantId,
      and(
        eq(landingPages.slug, slug.toLowerCase()),
        eq(landingPages.status, LIVE),
        sql`${landingPages.endsAt} is null or ${landingPages.endsAt} > now()`,
      ),
    ))
    .limit(1);
  if (!page) return null;

  const blocks = await db
    .select({
      id: landingPageBlocks.id,
      kind: landingPageBlocks.kind,
      content: landingPageBlocks.content,
      position: landingPageBlocks.position,
    })
    .from(landingPageBlocks)
    .where(scopedToTenant(
      landingPageBlocks,
      tenantId,
      and(eq(landingPageBlocks.pageId, page.id), eq(landingPageBlocks.isVisible, true)),
    ))
    .orderBy(asc(landingPageBlocks.position));

  return { ...page, blocks };
}

/** One published website page by path. `canonical_path` is returned rather than
 *  followed: the renderer emits the canonical link tag, and a service that
 *  silently redirected would make the two decisions indistinguishable. */
export async function publicWebsitePage(db: Db, tenantId: number | null, path: string) {
  const [row] = await db
    .select({
      id: websitePages.id,
      path: websitePages.path,
      title: websitePages.title,
      bodyMarkdown: websitePages.bodyMarkdown,
      canonicalPath: websitePages.canonicalPath,
      shellKind: websitePages.shellKind,
    })
    .from(websitePages)
    .where(scopedToNullableTenant(websitePages, tenantId, eq(websitePages.path, requirePath(path))))
    .limit(1);
  return row ?? null;
}

/** A landing page view. Counter-only and deliberately not an `activity_log` row:
 *  anonymous page views are high-volume and belong in the counter the campaign
 *  report reads, not in the audit trail a person is expected to scroll. */
export async function recordLandingPageView(db: Db, tenantId: number, id: number) {
  await db
    .update(landingPages)
    .set({ viewCount: sql`${landingPages.viewCount} + 1` })
    .where(scopedToTenant(landingPages, tenantId, eq(landingPages.id, id)));
}

/** A conversion against the page's `goal_metric`. Separate from the view counter
 *  because the ratio between them IS the campaign result. */
export async function recordLandingPageConversion(db: Db, tenantId: number, id: number) {
  await db
    .update(landingPages)
    .set({ conversionCount: sql`${landingPages.conversionCount} + 1` })
    .where(scopedToTenant(landingPages, tenantId, eq(landingPages.id, id)));
}

/** An SEO page impression, by path, for pages that are still published. */
export async function recordSeoImpression(db: Db, tenantId: number | null, path: string) {
  await db
    .update(marketingSeoPages)
    .set({ impressionCount: sql`${marketingSeoPages.impressionCount} + 1` })
    .where(scopedToNullableTenant(
      marketingSeoPages,
      tenantId,
      and(eq(marketingSeoPages.path, requirePath(path)), eq(marketingSeoPages.status, 'published')),
    ));
}

/** Everything the sitemap needs, in one read: published website pages and live
 *  landing pages, plus published SEO pages. Landing pages are included ONLY when
 *  they have no `ends_at` in the past, for the same reason the public read
 *  filters on it — a sitemap that lists a dead campaign page earns a 404 from a
 *  crawler, which is worse than omitting it. */
export async function sitemapEntries(db: Db, tenantId: number | null) {
  const site = await db
    .select({ path: websitePages.path, updatedAt: websitePages.updatedAt })
    .from(websitePages)
    .where(scopedToNullableTenant(websitePages, tenantId))
    .orderBy(asc(websitePages.path));

  const seo = await db
    .select({ path: marketingSeoPages.path, updatedAt: marketingSeoPages.updatedAt })
    .from(marketingSeoPages)
    .where(scopedToNullableTenant(marketingSeoPages, tenantId, eq(marketingSeoPages.status, 'published')))
    .orderBy(asc(marketingSeoPages.path));

  const landing = tenantId === null ? [] : await db
    .select({ slug: landingPages.slug, updatedAt: landingPages.updatedAt })
    .from(landingPages)
    .where(scopedToTenant(
      landingPages,
      tenantId,
      and(
        eq(landingPages.status, LIVE),
        sql`${landingPages.endsAt} is null or ${landingPages.endsAt} > now()`,
      ),
    ))
    .orderBy(asc(landingPages.slug));

  return {
    website: site,
    seo,
    landing: landing.map((l) => ({ path: `/l/${l.slug}`, updatedAt: l.updatedAt })),
  };
}
