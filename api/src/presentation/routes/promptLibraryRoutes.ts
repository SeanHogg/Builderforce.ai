/**
 * Prompt Library routes – /api/prompts
 *
 * Versioned prompt templates with a PUBLIC gallery. Public browse/use endpoints
 * require no auth (so the library can be shared openly); everything that reads or
 * mutates tenant-owned prompts requires a tenant JWT.
 *
 * PUBLIC (no auth):
 *   GET  /api/prompts/public                 Browse published prompts (q, category, tag, sort)
 *   GET  /api/prompts/public/:slug           Public prompt detail + current body
 *   POST /api/prompts/public/:slug/use       Record a "use" and return the body
 *
 * AUTH (tenant JWT):
 *   GET    /api/prompts                       List this tenant's prompts
 *   POST   /api/prompts                       Create a prompt (+ version 1)
 *   GET    /api/prompts/:id                   Prompt detail + all versions
 *   PATCH  /api/prompts/:id                   Update metadata / publish (visibility)
 *   POST   /api/prompts/:id/versions          Add a new version (bumps current)
 *   DELETE /api/prompts/:id                   Delete a prompt
 *   POST   /api/prompts/:id/star              Star a prompt
 *   DELETE /api/prompts/:id/star              Unstar a prompt
 */

import { Hono } from 'hono';
import { and, asc, desc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  promptLibraryEntries,
  promptLibraryVersions,
  promptLibraryStars,
} from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

function slugify(s: string): string {
  return (
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'prompt'
  );
}

/** A slug unique within the tenant (appends -2, -3, … on collision). */
async function uniqueTenantSlug(db: Db, tenantId: number, base: string): Promise<string> {
  let slug = base;
  let n = 1;
  // Bounded loop — practically returns on the first or second try.
  while (n < 1000) {
    const [hit] = await db
      .select({ id: promptLibraryEntries.id })
      .from(promptLibraryEntries)
      .where(and(eq(promptLibraryEntries.tenantId, tenantId), eq(promptLibraryEntries.slug, slug)));
    if (!hit) return slug;
    n++;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

export function createPromptLibraryRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ───────────────────────────── PUBLIC ──────────────────────────────────────
  // Defined BEFORE the auth middleware so they stay open to the world.

  // GET /api/prompts/public
  router.get('/public', async (c) => {
    const q = c.req.query('q')?.trim();
    const category = c.req.query('category')?.trim();
    const tag = c.req.query('tag')?.trim();
    const sort = c.req.query('sort') ?? 'popular';
    const limit = Math.min(Number(c.req.query('limit') ?? '60'), 100);
    const offset = Math.max(Number(c.req.query('offset') ?? '0'), 0);

    const conds = [eq(promptLibraryEntries.visibility, 'public')];
    if (q) {
      const like = `%${q}%`;
      conds.push(
        or(
          ilike(promptLibraryEntries.title, like),
          ilike(promptLibraryEntries.description, like),
        )!,
      );
    }
    if (category) conds.push(eq(promptLibraryEntries.category, category));
    if (tag) conds.push(ilike(promptLibraryEntries.tags, `%"${tag}"%`));

    const order =
      sort === 'recent' ? desc(promptLibraryEntries.createdAt)
      : sort === 'featured' ? desc(promptLibraryEntries.isFeatured)
      : desc(promptLibraryEntries.usageCount);

    const rows = await db
      .select({
        id: promptLibraryEntries.id,
        slug: promptLibraryEntries.slug,
        title: promptLibraryEntries.title,
        description: promptLibraryEntries.description,
        category: promptLibraryEntries.category,
        tags: promptLibraryEntries.tags,
        authorName: promptLibraryEntries.authorName,
        currentVersion: promptLibraryEntries.currentVersion,
        usageCount: promptLibraryEntries.usageCount,
        starCount: promptLibraryEntries.starCount,
        isFeatured: promptLibraryEntries.isFeatured,
        updatedAt: promptLibraryEntries.updatedAt,
      })
      .from(promptLibraryEntries)
      .where(and(...conds))
      .orderBy(order, desc(promptLibraryEntries.starCount))
      .limit(limit)
      .offset(offset);

    return c.json({ prompts: rows.map((r) => ({ ...r, tags: safeTags(r.tags) })) });
  });

  // GET /api/prompts/public/:slug
  router.get('/public/:slug', async (c) => {
    const slug = c.req.param('slug');
    const [entry] = await db
      .select()
      .from(promptLibraryEntries)
      .where(and(eq(promptLibraryEntries.slug, slug), eq(promptLibraryEntries.visibility, 'public')));
    if (!entry) return c.json({ error: 'Prompt not found' }, 404);

    const [version] = await db
      .select()
      .from(promptLibraryVersions)
      .where(and(
        eq(promptLibraryVersions.entryId, entry.id),
        eq(promptLibraryVersions.version, entry.currentVersion),
      ));

    return c.json(publicView(entry, version));
  });

  // POST /api/prompts/public/:slug/use — record usage, return the body to use.
  router.post('/public/:slug/use', async (c) => {
    const slug = c.req.param('slug');
    const [entry] = await db
      .select()
      .from(promptLibraryEntries)
      .where(and(eq(promptLibraryEntries.slug, slug), eq(promptLibraryEntries.visibility, 'public')));
    if (!entry) return c.json({ error: 'Prompt not found' }, 404);

    await db
      .update(promptLibraryEntries)
      .set({ usageCount: sql`${promptLibraryEntries.usageCount} + 1` })
      .where(eq(promptLibraryEntries.id, entry.id));

    const [version] = await db
      .select()
      .from(promptLibraryVersions)
      .where(and(
        eq(promptLibraryVersions.entryId, entry.id),
        eq(promptLibraryVersions.version, entry.currentVersion),
      ));

    return c.json({ ...publicView(entry, version), usageCount: entry.usageCount + 1 });
  });

  // ───────────────────────────── AUTHENTICATED ───────────────────────────────
  router.use('*', authMiddleware);

  // GET /api/prompts — this tenant's prompts (all visibilities).
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await db
      .select()
      .from(promptLibraryEntries)
      .where(eq(promptLibraryEntries.tenantId, tenantId))
      .orderBy(desc(promptLibraryEntries.updatedAt));
    return c.json({ prompts: rows.map((r) => ({ ...r, tags: safeTags(r.tags) })) });
  });

  // POST /api/prompts — create entry + version 1.
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const body = await c.req.json<{
      title: string;
      description?: string;
      category?: string;
      tags?: string[];
      visibility?: 'private' | 'tenant' | 'public';
      authorName?: string;
      body: string;
      variables?: Array<{ name: string; description?: string; default?: string }>;
      model?: string;
      notes?: string;
    }>();

    if (!body.title?.trim() || !body.body?.trim()) {
      return c.json({ error: 'title and body are required' }, 400);
    }

    const visibility = body.visibility ?? 'private';
    let slug = await uniqueTenantSlug(db, tenantId, slugify(body.title));
    // Public slugs are globally unique (enforced by a partial index); de-collide.
    if (visibility === 'public') slug = await publicSafeSlug(db, slug, null);

    const [entry] = await db
      .insert(promptLibraryEntries)
      .values({
        tenantId,
        slug,
        title: body.title.trim(),
        description: body.description ?? null,
        category: body.category ?? null,
        tags: JSON.stringify(body.tags ?? []),
        visibility,
        authorUserId: userId ?? null,
        authorName: body.authorName ?? null,
        currentVersion: 1,
      })
      .returning();
    if (!entry) return c.json({ error: 'Failed to create prompt' }, 500);

    await db.insert(promptLibraryVersions).values({
      entryId: entry.id,
      version: 1,
      body: body.body,
      variables: JSON.stringify(body.variables ?? []),
      model: body.model ?? null,
      notes: body.notes ?? null,
      createdBy: userId ?? null,
    });

    return c.json({ ...entry, tags: safeTags(entry.tags) }, 201);
  });

  // GET /api/prompts/:id — detail + all versions.
  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [entry] = await db
      .select()
      .from(promptLibraryEntries)
      .where(and(eq(promptLibraryEntries.id, id), eq(promptLibraryEntries.tenantId, tenantId)));
    if (!entry) return c.json({ error: 'Prompt not found' }, 404);

    const versions = await db
      .select()
      .from(promptLibraryVersions)
      .where(eq(promptLibraryVersions.entryId, id))
      .orderBy(asc(promptLibraryVersions.version));

    return c.json({
      ...entry,
      tags: safeTags(entry.tags),
      versions: versions.map((v) => ({ ...v, variables: safeJson(v.variables) })),
    });
  });

  // PATCH /api/prompts/:id — update metadata / publish.
  router.patch('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [entry] = await db
      .select()
      .from(promptLibraryEntries)
      .where(and(eq(promptLibraryEntries.id, id), eq(promptLibraryEntries.tenantId, tenantId)));
    if (!entry) return c.json({ error: 'Prompt not found' }, 404);

    const body = await c.req.json<Partial<{
      title: string;
      description: string | null;
      category: string | null;
      tags: string[];
      visibility: 'private' | 'tenant' | 'public';
    }>>();

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) set.title = body.title;
    if (body.description !== undefined) set.description = body.description;
    if (body.category !== undefined) set.category = body.category;
    if (body.tags !== undefined) set.tags = JSON.stringify(body.tags);
    if (body.visibility !== undefined) {
      set.visibility = body.visibility;
      // Publishing: guarantee a globally-unique public slug.
      if (body.visibility === 'public') {
        set.slug = await publicSafeSlug(db, entry.slug, entry.id);
      }
    }

    const [updated] = await db
      .update(promptLibraryEntries)
      .set(set)
      .where(and(eq(promptLibraryEntries.id, id), eq(promptLibraryEntries.tenantId, tenantId)))
      .returning();
    if (!updated) return c.json({ error: 'Update failed' }, 500);

    return c.json({ ...updated, tags: safeTags(updated.tags) });
  });

  // POST /api/prompts/:id/versions — add a new version, bump current.
  router.post('/:id/versions', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const id = c.req.param('id');
    const [entry] = await db
      .select()
      .from(promptLibraryEntries)
      .where(and(eq(promptLibraryEntries.id, id), eq(promptLibraryEntries.tenantId, tenantId)));
    if (!entry) return c.json({ error: 'Prompt not found' }, 404);

    const body = await c.req.json<{
      body: string;
      variables?: Array<{ name: string; description?: string; default?: string }>;
      model?: string;
      notes?: string;
    }>();
    if (!body.body?.trim()) return c.json({ error: 'body is required' }, 400);

    const nextVersion = entry.currentVersion + 1;
    await db.insert(promptLibraryVersions).values({
      entryId: id,
      version: nextVersion,
      body: body.body,
      variables: JSON.stringify(body.variables ?? []),
      model: body.model ?? null,
      notes: body.notes ?? null,
      createdBy: userId ?? null,
    });

    const [updated] = await db
      .update(promptLibraryEntries)
      .set({ currentVersion: nextVersion, updatedAt: new Date() })
      .where(eq(promptLibraryEntries.id, id))
      .returning();
    if (!updated) return c.json({ error: 'Version bump failed' }, 500);

    return c.json({ ...updated, tags: safeTags(updated.tags), version: nextVersion }, 201);
  });

  // DELETE /api/prompts/:id
  router.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    await db
      .delete(promptLibraryEntries)
      .where(and(eq(promptLibraryEntries.id, id), eq(promptLibraryEntries.tenantId, tenantId)));
    return c.json({ deleted: true });
  });

  // POST /api/prompts/:id/star
  router.post('/:id/star', async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const inserted = await db
      .insert(promptLibraryStars)
      .values({ entryId: id, userId })
      .onConflictDoNothing()
      .returning({ entryId: promptLibraryStars.entryId });
    if (inserted.length > 0) {
      await db
        .update(promptLibraryEntries)
        .set({ starCount: sql`${promptLibraryEntries.starCount} + 1` })
        .where(eq(promptLibraryEntries.id, id));
    }
    return c.json({ starred: true });
  });

  // DELETE /api/prompts/:id/star
  router.delete('/:id/star', async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const removed = await db
      .delete(promptLibraryStars)
      .where(and(eq(promptLibraryStars.entryId, id), eq(promptLibraryStars.userId, userId)))
      .returning({ entryId: promptLibraryStars.entryId });
    if (removed.length > 0) {
      await db
        .update(promptLibraryEntries)
        .set({ starCount: sql`GREATEST(${promptLibraryEntries.starCount} - 1, 0)` })
        .where(eq(promptLibraryEntries.id, id));
    }
    return c.json({ starred: false });
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeJson(s: string | null): unknown {
  if (!s) return [];
  try { return JSON.parse(s); } catch { return []; }
}

function safeTags(s: string | null): string[] {
  const v = safeJson(s);
  return Array.isArray(v) ? (v as string[]) : [];
}

type EntryRow = typeof promptLibraryEntries.$inferSelect;
type VersionRow = typeof promptLibraryVersions.$inferSelect;

function publicView(entry: EntryRow, version: VersionRow | undefined) {
  return {
    id: entry.id,
    slug: entry.slug,
    title: entry.title,
    description: entry.description,
    category: entry.category,
    tags: safeTags(entry.tags),
    authorName: entry.authorName,
    currentVersion: entry.currentVersion,
    usageCount: entry.usageCount,
    starCount: entry.starCount,
    isFeatured: entry.isFeatured,
    body: version?.body ?? '',
    variables: safeJson(version?.variables ?? '[]'),
    model: version?.model ?? null,
    updatedAt: entry.updatedAt,
  };
}

/**
 * Return `base` if no OTHER public entry uses it, else a de-collided variant.
 * `excludeId` lets an entry keep its own slug when re-publishing.
 */
async function publicSafeSlug(db: Db, base: string, excludeId: string | null): Promise<string> {
  const conds = [eq(promptLibraryEntries.slug, base), eq(promptLibraryEntries.visibility, 'public')];
  if (excludeId) conds.push(ne(promptLibraryEntries.id, excludeId));
  const [clash] = await db
    .select({ id: promptLibraryEntries.id })
    .from(promptLibraryEntries)
    .where(and(...conds));
  if (!clash) return base;
  const suffix = (excludeId ?? `${Date.now()}`).replace(/-/g, '').slice(0, 6);
  return `${base}-${suffix}`;
}
