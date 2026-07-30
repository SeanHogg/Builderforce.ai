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
import { hashPassword, verifyPassword } from '../../infrastructure/auth/HashService';
import { invalidateCapabilityCache } from '../../application/artifact/capabilityContext';
import { getOrSetCached, invalidateCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { resolveAppBaseUrl, type Env, type HonoEnv } from '../../env';
import { sendWelcomeEmail } from '../../infrastructure/email/EmailService';
import { sendTransactionalEmail } from '../../application/email/sendEmail';
import { headerHints } from '../../application/email/emailLocaleResolver';
import { localeFromHeaders } from '../../infrastructure/email/emailLocale';

/** Read-through cache key for a single published skill's SEO/SSR payload. */
const skillSeoCacheKey = (slug: string): string => `mp:skill:seo:${slug}`;

/** Version token for the public skills-list keyspace. The list is searchable +
 *  paginated (q/category/page/limit) → an unbounded keyspace, so we fold this
 *  token into each cache key and bump it on any publish/update/delete; every
 *  cached query variant orphans at once (mirrors personaRoutes.ts / 'personas:public'). */
const SKILLS_LIST_VERSION_KEY = 'marketplace:skills:list';
const SKILLS_LIST_CACHE_TTL_SECONDS = 120;

/** Drop every cached skills-list variant by bumping the version token. Called
 *  from every skill write (create / update / publish toggle). */
async function invalidateSkillsList(env: Env): Promise<void> {
  await bumpCacheVersion(env, SKILLS_LIST_VERSION_KEY);
}

// Password hashing (PBKDF2 via Web Crypto) uses the canonical HashService — the
// SAME salt:hash format + params as every other web/marketplace user hash, so the
// two must never drift. `hashPassword` / `verifyPassword` are imported above.

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

  /** Load one published skill + its author for the public detail/SSR surface. */
  async function loadPublishedSkill(slug: string) {
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
    return row ?? null;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  /**
   * POST /marketplace/auth/register
   * Body: { email, password, username?, display_name? } — username defaults to email
   */
  router.post('/auth/register', async (c) => {
    const body = await c.req.json<{
      email: string;
      username?: string;
      password: string;
      display_name?: string;
    }>();
    const email = (body.email ?? '').toLowerCase().trim();
    const username = (body.username && body.username.trim())
      ? body.username.trim().toLowerCase()
      : email;
    const password = body.password;
    const display_name = body.display_name;
    if (!email || !password) {
      return c.json({ error: 'email and password are required' }, 400);
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
    // Capture the language this signup happened in so the welcome — and every
    // later mail — is written in it.
    const locale = localeFromHeaders(headerHints(c.req));

    await db.insert(schema.users).values({
      id:           userId,
      email,
      username,
      displayName:  display_name ?? username,
      passwordHash,
      locale,
    });

    // Fire-and-forget: a mail failure must not fail the registration. This path
    // never creates a gig account, so the builder next steps apply.
    void sendTransactionalEmail(
      c.env,
      db,
      email,
      (ctx) => sendWelcomeEmail(
        c.env,
        email,
        display_name ?? username,
        resolveAppBaseUrl(c.env),
        'standard',
        ctx.locale,
      ),
      { storedLocale: locale, headers: headerHints(c.req) },
    );

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

    // World-readable + read-heavy over a searchable/paginated (unbounded) keyspace
    // → served through the read-through cache, keyed by a version token that any
    // skill write bumps (see invalidateSkillsList). [perf]
    const version = await getCacheVersion(c.env as Env, SKILLS_LIST_VERSION_KEY);
    const cacheKey = `mp:skills:list:v:${version}:c=${category ?? ''}:q=${q ?? ''}:p=${pageNum}:l=${limitNum}`;

    const payload = await getOrSetCached(
      c.env as Env,
      cacheKey,
      () => loadSkillsList({ category, q, limitNum, offset, pageNum }),
      { kvTtlSeconds: SKILLS_LIST_CACHE_TTL_SECONDS },
    );

    return c.json(payload);
  });

  /** The live skills-list query, factored out so the route body just wraps it in
   *  the read-through cache. */
  async function loadSkillsList(args: {
    category?: string;
    q?: string;
    limitNum: number;
    offset: number;
    pageNum: number;
  }): Promise<{ skills: unknown[]; total: number; page: number; limit: number }> {
    const { category, q, limitNum, offset, pageNum } = args;

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
          price_cents:     schema.marketplaceSkills.priceCents,
          pricing_model:   schema.marketplaceSkills.pricingModel,
          price_unit:      schema.marketplaceSkills.priceUnit,
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
          price_cents:     schema.marketplaceSkills.priceCents,
          pricing_model:   schema.marketplaceSkills.pricingModel,
          price_unit:      schema.marketplaceSkills.priceUnit,
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

    return { skills: rows, total: Number(count), page: pageNum, limit: limitNum };
  }

  /**
   * GET /marketplace/skills/:slug
   */
  router.get('/skills/:slug', async (c) => {
    const slug = c.req.param('slug');
    // `?seo=1` is the indexable detail-page / sitemap read: served through the
    // read-through cache and WITHOUT the download-counter increment, so crawler
    // and SSR renders don't inflate downloads (invalidated on PUT). [1333]
    const seo = c.req.query('seo') === '1';
    if (seo) {
      const skill = await getOrSetCached(c.env as Env, skillSeoCacheKey(slug), () =>
        loadPublishedSkill(slug),
      );
      if (!skill) return c.json({ error: 'Skill not found' }, 404);
      return c.json({ skill });
    }

    const row = await loadPublishedSkill(slug);
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
      price?: number;
      pricing_model?: 'flat_fee' | 'consumption';
      price_unit?: string;
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
          tags:         body.tags    ? JSON.stringify(body.tags) : null,
          version:      body.version ?? '1.0.0',
          readme:       body.readme  ?? null,
          iconUrl:      body.icon_url ?? null,
          repoUrl:      body.repo_url ?? null,
          priceCents:   body.price != null ? Math.round(body.price * 100) : 0,
          pricingModel: body.pricing_model ?? 'flat_fee',
          priceUnit:    body.price_unit ?? null,
        })
        .returning();
      // A new published skill enters the list keyspace → orphan cached variants.
      await invalidateSkillsList(c.env as Env);
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
    // Invalidate the cloud capability cache so the next cloud run re-reads the
    // edited skill body (name/description/readme).
    await invalidateCapabilityCache(c.env, 'skill', slug);
    // Invalidate the public SEO/SSR read-through cache so the detail page + its
    // metadata reflect the edit (and publish/unpublish) on next render. [1333]
    await invalidateCached(c.env as Env, skillSeoCacheKey(slug));
    // Edits / publish-unpublish change the list rows + ordering → bump the
    // version token so every cached list variant re-loads.
    await invalidateSkillsList(c.env as Env);
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

  /**
   * POST /marketplace/purchase – record a marketplace purchase (auth required)
   * Body: { artifactType, artifactSlug, stripePaymentIntentId? }
   * For free items (priceCents = 0) the purchase is recorded immediately without payment.
   */
  router.post('/purchase', requireMarketplaceAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json<{
      artifactType: 'skill' | 'persona' | 'content';
      artifactSlug: string;
      stripePaymentIntentId?: string;
    }>();
    if (!body.artifactType || !body.artifactSlug) {
      return c.json({ error: 'artifactType and artifactSlug are required' }, 400);
    }

    // Look up price for skills (personas/content default to 0 for now)
    let priceCents = 0;
    let pricingModel: 'flat_fee' | 'consumption' = 'flat_fee';
    if (body.artifactType === 'skill') {
      const [skill] = await db
        .select({ priceCents: schema.marketplaceSkills.priceCents, pricingModel: schema.marketplaceSkills.pricingModel })
        .from(schema.marketplaceSkills)
        .where(and(eq(schema.marketplaceSkills.slug, body.artifactSlug), eq(schema.marketplaceSkills.published, true)))
        .limit(1);
      if (!skill) return c.json({ error: 'Skill not found' }, 404);
      priceCents   = skill.priceCents;
      pricingModel = skill.pricingModel;
    }

    // For paid items a Stripe payment intent is required
    if (priceCents > 0 && !body.stripePaymentIntentId) {
      return c.json({ error: 'stripePaymentIntentId is required for paid items' }, 402);
    }

    await db.insert(schema.marketplacePurchases).values({
      userId,
      artifactType:          body.artifactType,
      artifactSlug:          body.artifactSlug,
      priceCents,
      pricingModel,
      stripePaymentIntentId: body.stripePaymentIntentId ?? null,
    });

    return c.json({ ok: true, priceCents, pricingModel }, 201);
  });

  /**
   * GET /marketplace/purchases – list own purchases (auth required)
   */
  router.get('/purchases', requireMarketplaceAuth, async (c) => {
    const userId = c.get('userId') as string;
    const rows = await db
      .select()
      .from(schema.marketplacePurchases)
      .where(eq(schema.marketplacePurchases.userId, userId))
      .orderBy(desc(schema.marketplacePurchases.createdAt));
    return c.json({ purchases: rows });
  });

  return router;
}
