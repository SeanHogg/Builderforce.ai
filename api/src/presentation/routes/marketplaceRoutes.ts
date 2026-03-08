/**
 * Marketplace routes – /marketplace/*
 *
 * Provides the public skills registry and user profiles for the builderforce.ai
 * marketing/community site. These routes own the `marketplace_skills`,
 * `marketplace_skill_likes` tables and the optional profile columns on `users`.
 *
 * Auth model: email + password → JWT  (separate from the API-key auth used
 * by the orchestration API). Marketplace JWTs carry { sub, tid: 0 }.
 */
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { eq, and, sql, desc } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import * as schema from '../../infrastructure/database/schema';
import { signWebJwt, verifyWebJwt } from '../../infrastructure/auth/JwtService';
import type { HonoEnv } from '../../env';

// ---------------------------------------------------------------------------
// Password hashing (PBKDF2 via Web Crypto – works in CF Workers)
// ---------------------------------------------------------------------------

async function hashPassword(password: string): Promise<string> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(saltBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const keyMat = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100_000, hash: 'SHA-256' },
    keyMat,
    256,
  );
  const hashHex = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(input: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  const saltBytes = new Uint8Array(
    (saltHex ?? '').match(/../g)?.map((h) => parseInt(h, 16)) ?? [],
  );
  const keyMat = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100_000, hash: 'SHA-256' },
    keyMat,
    256,
  );
  const inputHash = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return inputHash === hashHex;
}

// ---------------------------------------------------------------------------
// Marketplace-specific auth middleware
// ---------------------------------------------------------------------------

const requireMarketplaceAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or malformed Authorization header' }, 401);
  }
  const token = authHeader.slice(7);
  try {
    const payload = await verifyWebJwt(token, c.env.JWT_SECRET);
    c.set('userId', payload.sub);
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
  await next();
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMarketplaceRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── Auth ────────────────────────────────────────────────────────────────

  /**
   * POST /marketplace/auth/register
   * Body: { email, username, password, display_name? }
   */
  router.post('/auth/register', async (c) => {
    const body = await c.req.json<{
      email: string;
      username: string;
      password: string;
      display_name?: string;
    }>();
    const { email, username, password, display_name } = body;
    if (!email || !username || !password) {
      return c.json({ error: 'email, username, and password are required' }, 400);
    }

    // Check for duplicates
    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    if (existing.length) return c.json({ error: 'Email already registered' }, 409);

    const existingUsername = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);
    if (existingUsername.length) return c.json({ error: 'Username already taken' }, 409);

    const passwordHash = await hashPassword(password);

    const userId = crypto.randomUUID();
    await db.insert(schema.users).values({
      id:           userId,
      email,
      username,
      displayName:  display_name ?? username,
      passwordHash,
    });

    const token = await signWebJwt(
      { sub: userId, email, username },
      c.env.JWT_SECRET,
      86400, // 24 h
    );
    return c.json({ token, user: { id: userId, email, username } }, 201);
  });

  /**
   * POST /marketplace/auth/login
   * Body: { email, password }
   */
  router.post('/auth/login', async (c) => {
    const { email, password } = await c.req.json<{ email: string; password: string }>();
    if (!email || !password) {
      return c.json({ error: 'email and password are required' }, 400);
    }

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    if (!user || !user.passwordHash) {
      return c.json({ error: 'Invalid email or password' }, 401);
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return c.json({ error: 'Invalid email or password' }, 401);

    const token = await signWebJwt(
      { sub: user.id, email: user.email, username: user.username ?? '' },
      c.env.JWT_SECRET,
      86400,
    );
    return c.json({
      token,
      user: {
        id:           user.id,
        email:        user.email,
        username:     user.username,
        display_name: user.displayName,
        avatar_url:   user.avatarUrl,
      },
    });
  });

  /**
   * GET /marketplace/auth/me – return current user profile (auth required)
   */
  router.get('/auth/me', requireMarketplaceAuth, async (c) => {
    const userId = c.get('userId') as string;
    const [user] = await db
      .select({
        id:           schema.users.id,
        email:        schema.users.email,
        username:     schema.users.username,
        display_name: schema.users.displayName,
        avatar_url:   schema.users.avatarUrl,
        bio:          schema.users.bio,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) return c.json({ error: 'User not found' }, 404);
    return c.json({ user });
  });

  // ── Users ───────────────────────────────────────────────────────────────

  /**
   * GET /marketplace/users/:username – public profile + their skills
   */
  router.get('/users/:username', async (c) => {
    const username = c.req.param('username');
    const [user] = await db
      .select({
        id:           schema.users.id,
        username:     schema.users.username,
        display_name: schema.users.displayName,
        avatar_url:   schema.users.avatarUrl,
        bio:          schema.users.bio,
        created_at:   schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);
    if (!user) return c.json({ error: 'User not found' }, 404);

    const skills = await db
      .select({
        id:          schema.marketplaceSkills.id,
        name:        schema.marketplaceSkills.name,
        slug:        schema.marketplaceSkills.slug,
        description: schema.marketplaceSkills.description,
        category:    schema.marketplaceSkills.category,
        downloads:   schema.marketplaceSkills.downloads,
        likes:       schema.marketplaceSkills.likes,
        created_at:  schema.marketplaceSkills.createdAt,
      })
      .from(schema.marketplaceSkills)
      .where(
        and(
          eq(schema.marketplaceSkills.authorId, user.id),
          eq(schema.marketplaceSkills.published, true),
        ),
      )
      .orderBy(desc(schema.marketplaceSkills.downloads));

    return c.json({ user, skills });
  });

  /**
   * PUT /marketplace/users/me – update own profile (auth required)
   */
  router.put('/users/me', requireMarketplaceAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json<{
      display_name?: string;
      bio?: string;
      avatar_url?: string;
    }>();

    const [updated] = await db
      .update(schema.users)
      .set({
        ...(body.display_name !== undefined  && { displayName: body.display_name }),
        ...(body.bio          !== undefined  && { bio: body.bio }),
        ...(body.avatar_url   !== undefined  && { avatarUrl: body.avatar_url }),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId))
      .returning({
        id:           schema.users.id,
        email:        schema.users.email,
        username:     schema.users.username,
        display_name: schema.users.displayName,
        avatar_url:   schema.users.avatarUrl,
        bio:          schema.users.bio,
      });
    return c.json({ user: updated });
  });

  // ── Skills ──────────────────────────────────────────────────────────────

  /**
   * GET /marketplace/skills – list published skills
   * Query: ?category=&q=&page=1&limit=24
   */
  router.get('/skills', async (c) => {
    const { category, q, page = '1', limit = '24' } = c.req.query();
    const pageNum  = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset   = (pageNum - 1) * limitNum;

    // Build base conditions
    const conditions = [eq(schema.marketplaceSkills.published, true)];
    if (category) {
      conditions.push(eq(schema.marketplaceSkills.category, category));
    }

    let rows;
    if (q) {
      // Full-text search via raw SQL (tsvector column)
      rows = await db
        .select({
          id:              schema.marketplaceSkills.id,
          name:            schema.marketplaceSkills.name,
          slug:            schema.marketplaceSkills.slug,
          description:     schema.marketplaceSkills.description,
          category:        schema.marketplaceSkills.category,
          tags:            schema.marketplaceSkills.tags,
          version:         schema.marketplaceSkills.version,
          icon_url:        schema.marketplaceSkills.iconUrl,
          repo_url:        schema.marketplaceSkills.repoUrl,
          downloads:       schema.marketplaceSkills.downloads,
          likes:           schema.marketplaceSkills.likes,
          created_at:      schema.marketplaceSkills.createdAt,
          author_username: schema.users.username,
          author_display_name: schema.users.displayName,
          author_avatar_url:   schema.users.avatarUrl,
        })
        .from(schema.marketplaceSkills)
        .innerJoin(schema.users, eq(schema.marketplaceSkills.authorId, schema.users.id))
        .where(
          sql`${and(...conditions)} AND ${schema.marketplaceSkills.searchVector} @@ websearch_to_tsquery(${q})`,
        )
        .orderBy(desc(schema.marketplaceSkills.downloads), desc(schema.marketplaceSkills.likes))
        .limit(limitNum)
        .offset(offset);
    } else {
      rows = await db
        .select({
          id:              schema.marketplaceSkills.id,
          name:            schema.marketplaceSkills.name,
          slug:            schema.marketplaceSkills.slug,
          description:     schema.marketplaceSkills.description,
          category:        schema.marketplaceSkills.category,
          tags:            schema.marketplaceSkills.tags,
          version:         schema.marketplaceSkills.version,
          icon_url:        schema.marketplaceSkills.iconUrl,
          repo_url:        schema.marketplaceSkills.repoUrl,
          downloads:       schema.marketplaceSkills.downloads,
          likes:           schema.marketplaceSkills.likes,
          created_at:      schema.marketplaceSkills.createdAt,
          author_username: schema.users.username,
          author_display_name: schema.users.displayName,
          author_avatar_url:   schema.users.avatarUrl,
        })
        .from(schema.marketplaceSkills)
        .innerJoin(schema.users, eq(schema.marketplaceSkills.authorId, schema.users.id))
        .where(and(...conditions))
        .orderBy(desc(schema.marketplaceSkills.downloads), desc(schema.marketplaceSkills.likes))
        .limit(limitNum)
        .offset(offset);
    }

    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.marketplaceSkills)
      .where(and(...conditions));
    const count = countRow?.count ?? 0;

    return c.json({ skills: rows, total: Number(count), page: pageNum, limit: limitNum });
  });

  /**
   * GET /marketplace/skills/:slug
   */
  router.get('/skills/:slug', async (c) => {
    const slug = c.req.param('slug');
    const [row] = await db
      .select({
        id:              schema.marketplaceSkills.id,
        name:            schema.marketplaceSkills.name,
        slug:            schema.marketplaceSkills.slug,
        description:     schema.marketplaceSkills.description,
        category:        schema.marketplaceSkills.category,
        tags:            schema.marketplaceSkills.tags,
        version:         schema.marketplaceSkills.version,
        readme:          schema.marketplaceSkills.readme,
        icon_url:        schema.marketplaceSkills.iconUrl,
        repo_url:        schema.marketplaceSkills.repoUrl,
        downloads:       schema.marketplaceSkills.downloads,
        likes:           schema.marketplaceSkills.likes,
        created_at:      schema.marketplaceSkills.createdAt,
        updated_at:      schema.marketplaceSkills.updatedAt,
        author_username: schema.users.username,
        author_display_name: schema.users.displayName,
        author_avatar_url:   schema.users.avatarUrl,
      })
      .from(schema.marketplaceSkills)
      .innerJoin(schema.users, eq(schema.marketplaceSkills.authorId, schema.users.id))
      .where(
        and(
          eq(schema.marketplaceSkills.slug, slug),
          eq(schema.marketplaceSkills.published, true),
        ),
      )
      .limit(1);
    if (!row) return c.json({ error: 'Skill not found' }, 404);

    // Fire-and-forget download counter increment
    c.executionCtx.waitUntil(
      db
        .update(schema.marketplaceSkills)
        .set({ downloads: sql`${schema.marketplaceSkills.downloads} + 1` })
        .where(eq(schema.marketplaceSkills.slug, slug)),
    );

    return c.json({ skill: row });
  });

  /**
   * POST /marketplace/skills – create a new skill (auth required)
   */
  router.post('/skills', requireMarketplaceAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json<{
      name: string;
      slug: string;
      description: string;
      category: string;
      tags?: string[];
      version?: string;
      readme?: string;
      icon_url?: string;
      repo_url?: string;
    }>();
    const { name, slug, description, category } = body;
    if (!name || !slug || !description || !category) {
      return c.json({ error: 'name, slug, description, and category are required' }, 400);
    }

    try {
      const [skill] = await db
        .insert(schema.marketplaceSkills)
        .values({
          name,
          slug,
          description,
          authorId: userId,
          category,
          tags:    body.tags    ? JSON.stringify(body.tags) : null,
          version: body.version ?? '1.0.0',
          readme:  body.readme  ?? null,
          iconUrl: body.icon_url ?? null,
          repoUrl: body.repo_url ?? null,
        })
        .returning();
      return c.json({ skill }, 201);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('23505')) {
        return c.json({ error: 'Slug already taken' }, 409);
      }
      return c.json({ error: 'Failed to create skill' }, 500);
    }
  });

  /**
   * PUT /marketplace/skills/:slug – update own skill (auth required)
   */
  router.put('/skills/:slug', requireMarketplaceAuth, async (c) => {
    const userId = c.get('userId') as string;
    const slug   = c.req.param('slug');

    const [existing] = await db
      .select({ id: schema.marketplaceSkills.id, authorId: schema.marketplaceSkills.authorId })
      .from(schema.marketplaceSkills)
      .where(eq(schema.marketplaceSkills.slug, slug))
      .limit(1);
    if (!existing) return c.json({ error: 'Not found' }, 404);
    if (existing.authorId !== userId) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json<Partial<{
      name: string; description: string; category: string;
      tags: string[]; version: string; readme: string;
      icon_url: string; repo_url: string; published: boolean;
    }>>();

    const [updated] = await db
      .update(schema.marketplaceSkills)
      .set({
        ...(body.name        !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.category    !== undefined && { category: body.category }),
        ...(body.tags        !== undefined && { tags: JSON.stringify(body.tags) }),
        ...(body.version     !== undefined && { version: body.version }),
        ...(body.readme      !== undefined && { readme: body.readme }),
        ...(body.icon_url    !== undefined && { iconUrl: body.icon_url }),
        ...(body.repo_url    !== undefined && { repoUrl: body.repo_url }),
        ...(body.published   !== undefined && { published: body.published }),
        updatedAt: new Date(),
      })
      .where(eq(schema.marketplaceSkills.slug, slug))
      .returning();
    return c.json({ skill: updated });
  });

  /**
   * POST /marketplace/skills/:slug/like – toggle like (auth required)
   */
  router.post('/skills/:slug/like', requireMarketplaceAuth, async (c) => {
    const userId = c.get('userId') as string;
    const slug   = c.req.param('slug');

    const existing = await db
      .select()
      .from(schema.marketplaceSkillLikes)
      .where(
        and(
          eq(schema.marketplaceSkillLikes.userId, userId),
          eq(schema.marketplaceSkillLikes.skillSlug, slug),
        ),
      )
      .limit(1);

    if (existing.length) {
      // Unlike
      await db
        .delete(schema.marketplaceSkillLikes)
        .where(
          and(
            eq(schema.marketplaceSkillLikes.userId, userId),
            eq(schema.marketplaceSkillLikes.skillSlug, slug),
          ),
        );
      await db
        .update(schema.marketplaceSkills)
        .set({ likes: sql`${schema.marketplaceSkills.likes} - 1` })
        .where(eq(schema.marketplaceSkills.slug, slug));
      return c.json({ liked: false });
    }

    // Like
    await db
      .insert(schema.marketplaceSkillLikes)
      .values({ userId, skillSlug: slug });
    await db
      .update(schema.marketplaceSkills)
      .set({ likes: sql`${schema.marketplaceSkills.likes} + 1` })
      .where(eq(schema.marketplaceSkills.slug, slug));
    return c.json({ liked: true });
  });

  return router;
}
