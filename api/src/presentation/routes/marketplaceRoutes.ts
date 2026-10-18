/**
 * Marketplace routes – /marketplace/*
 *
 * Provides the public skills registry and user profiles for the builderforce.ai
 * marketing/community site. These routes own the `marketplace_skills` table and
 * the optional profile columns on `users`. Likes live in `artifact_likes`
 * (application/marketplace/artifactLikes.ts); `marketplace_skill_likes` is retired.
 *
 * Auth: writes take the ordinary web JWT. `/marketplace/auth/{register,login,me}`
 * are NOT served here any more — they are legacy aliases of `/api/auth/web/*` and
 * `/api/auth/me`, wired in `index.ts` with `forwardToCanonical`, so a marketplace
 * signup gets the same terms, 18+, email-verification, suspension and MFA gates as
 * every other door instead of a weaker copy of them.
 */
import { InternalError } from '../../domain/shared/errors';
import { failResponse } from '../middleware/errorResponse';
import { Hono } from 'hono';
import { eq, and, desc, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import * as schema from '../../infrastructure/database/schema';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { legacyAliasNotice } from '../middleware/legacyAlias';
import { toggleArtifactLike } from '../../application/marketplace/artifactLikes';
import { invalidateCapabilityCache } from '../../application/artifact/capabilityContext';
import {
  invalidateSkillsList,
  listPublishedSkills,
  loadPublishedSkill,
  skillSeoCacheKey,
} from '../../application/marketplace/marketplaceSkillCatalog';
import { recordHit } from '../../application/counters/hitCounters';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { Env, HonoEnv } from '../../env';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';
import { parseBody, z, zNumberLike, zNonEmptyString } from './requestBody';
import { startSkillCheckout, completeSkillCheckout, ListingError } from '../../application/marketplace/skillCommerce';

// ---------------------------------------------------------------------------
// Request bodies. Fields a handler answers "X is required" for stay optional so
// that message still wins; the schema's job is the SHAPE.
// ---------------------------------------------------------------------------

/** All three columns are nullable, so an explicit `null` still clears one. */
const ProfileBody = z.object({
  display_name: z.string().nullish(),
  bio: z.string().nullish(),
  avatar_url: z.string().nullish(),
});

const PRICING_MODELS = ['flat_fee', 'consumption'] as const;

const CreateSkillBody = z.object({
  name: z.string().nullish(),
  slug: z.string().nullish(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  version: z.string().nullish(),
  readme: z.string().nullish(),
  icon_url: z.string().nullish(),
  repo_url: z.string().nullish(),
  /** Dollars; `Number(...)`ed into cents, so a numeric string was always accepted. */
  price: zNumberLike.nullish(),
  pricing_model: z.enum(PRICING_MODELS).nullish(),
  price_unit: z.string().nullish(),
});

/** `name` / `category` / `version` are NOT NULL columns, so they refuse `null`. */
const UpdateSkillBody = z.object({
  name: z.string().optional(),
  description: z.string().nullish(),
  category: z.string().optional(),
  tags: z.array(z.string()).nullish(),
  version: z.string().optional(),
  readme: z.string().nullish(),
  icon_url: z.string().nullish(),
  repo_url: z.string().nullish(),
  published: z.boolean().optional(),
});

/**
 * `agent` is admitted by the SHAPE only so the handler's own refusal (pointing at
 * the workforce checkout) answers it — see the route's docstring.
 */
const PurchaseBody = z.object({
  artifactType: z.enum(['skill', 'persona', 'agent']).optional(),
  artifactSlug: z.string().optional(),
  stripePaymentIntentId: z.string().nullish(),
});

const CheckoutStartBody = z.object({
  artifactType: z.enum(['skill', 'persona']),
  artifactSlug: zNonEmptyString,
  returnUrl: z.string().optional(),
  buyerEmail: z.string().optional(),
});
const CheckoutCompleteBody = z.object({ checkoutSessionId: zNonEmptyString });

/** Per-username cache entry for the public profile read (exact username, as the lookup is). */
const userProfileCacheKey = (username: string): string => `mkt:user:${encodeURIComponent(username)}`;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMarketplaceRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── Users ───────────────────────────────────────────────────────────────

  /**
   * GET /marketplace/users/:username – public profile + their skills
   */
  router.get('/users/:username', async (c) => {
    const username = c.req.param('username');
    // Two statements per anonymous profile view, for data that changes when its owner
    // edits it. Cached per username; the owner's PUT below invalidates, and the 60s KV
    // TTL bounds how long a newly published skill / changed counter can lag.
    const profile = await getOrSetCached(c.env as Env, userProfileCacheKey(username), async () => {
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
      // A sentinel, not null: a miss is cached too, so a scraped/typo'd username costs one
      // lookup per TTL instead of two statements per request.
      if (!user) return { missing: true as const };

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
        .orderBy(desc(schema.marketplaceSkills.downloads)).limit(LIST_ROW_CAP);
      return { user, skills };
    }, { kvTtlSeconds: 60, l1TtlMs: 30_000 });
    if ('missing' in profile) return c.json({ error: 'User not found' }, 404);
    return c.json(profile);
  });

  /**
   * PUT /marketplace/users/me – update own profile (auth required)
   */
  router.put('/users/me', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const body = await parseBody(c, ProfileBody);

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
    if (updated?.username) await invalidateCached(c.env as Env, userProfileCacheKey(updated.username));
    return c.json({ user: updated });
  });

  // ── Skills ──────────────────────────────────────────────────────────────

  /**
   * GET /marketplace/skills – list published skills
   * Query: ?category=&q=&page=1&limit=24
   */
  router.get('/skills', async (c) => {
    // World-readable + read-heavy; the catalogue owns the query and its cache.
    return c.json(await listPublishedSkills(c.env as Env, db, c.req.query()));
  });

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
        loadPublishedSkill(db, slug),
      );
      if (!skill) return c.json({ error: 'Skill not found' }, 404);
      return c.json({ skill });
    }

    const row = await loadPublishedSkill(db, slug);
    if (!row) return c.json({ error: 'Skill not found' }, 404);

    // Buffered, not written: a Postgres UPDATE per skill view is what kept the database
    // awake for anonymous browsing. The `hit-counters` sweep applies the delta.
    await recordHit(c.env as Env, db, 'skill.download', slug);

    return c.json({ skill: row });
  });

  /**
   * POST /marketplace/skills – create a new skill (auth required)
   */
  router.post('/skills', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    // Read BEFORE the insert's try: its catch answers 500, and a bad body is a 400.
    const body = await parseBody(c, CreateSkillBody);
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
          priceCents:   body.price != null ? Math.round(Number(body.price) * 100) : 0,
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
      return failResponse(c, new InternalError('Failed to create skill', { cause: err }), { source: 'presentation/routes/marketplaceRoutes.ts', operation: 'createSkill' });
    }
  });

  /**
   * PUT /marketplace/skills/:slug – update own skill (auth required)
   */
  router.put('/skills/:slug', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const slug   = c.req.param('slug');

    const [existing] = await db
      .select({ id: schema.marketplaceSkills.id, authorId: schema.marketplaceSkills.authorId })
      .from(schema.marketplaceSkills)
      .where(eq(schema.marketplaceSkills.slug, slug))
      .limit(1);
    if (!existing) return c.json({ error: 'Not found' }, 404);
    if (existing.authorId !== userId) return c.json({ error: 'Forbidden' }, 403);

    const body = await parseBody(c, UpdateSkillBody);

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
   * POST /marketplace/skills/:slug/like – toggle like (auth required). DEPRECATED.
   * Successor: POST /api/marketplace-stats/like { artifactType: 'skill', artifactSlug }.
   * It kept its own like table and a ±1 counter, so likes from here never showed on a
   * like button and likes from there never moved the catalogue sort. It is a thin
   * adapter onto THE like use case now; it keeps the web-JWT auth its callers send.
   */
  router.post(
    '/skills/:slug/like',
    legacyAliasNotice('/api/marketplace-stats/like'),
    webAuthMiddleware,
    async (c) => c.json(await toggleArtifactLike(db, { userId: c.get('userId') as string, type: 'skill', slug: c.req.param('slug') })),
  );

  /**
   * POST /marketplace/purchase – record a FREE marketplace purchase (auth required)
   * Body: { artifactType, artifactSlug }
   *
   * Paid skills are NOT granted here. A client-supplied payment-intent id used
   * to be enough to INSERT a purchase row without the processor ever seeing it;
   * that door is closed. A priced skill answers 402 `{ checkoutRequired, priceCents }`
   * and the buyer goes through POST /marketplace/checkout, which re-reads the
   * session FROM the processor before anything is written.
   *
   * 'agent' IS A VALID artifact_type (migration 0982) AND IS REFUSED HERE. This
   * handler prices only 'skill' and records everything else at zero, so admitting
   * an agent would mint a free entitlement for a priced agent — the exact hole the
   * hire gate exists to close. An agent is bought through
   * POST /api/workforce/agents/:id/checkout, which settles against the processor
   * before it writes the row this route would have written for nothing.
   */
  router.post('/purchase', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const body = await parseBody(c, PurchaseBody);
    if (!body.artifactType || !body.artifactSlug) {
      return c.json({ error: 'artifactType and artifactSlug are required' }, 400);
    }
    if (String(body.artifactType) === 'agent') {
      return c.json({ error: 'Agents are purchased through the workforce checkout, not this route' }, 400);
    }
    // A payment-intent id in the body used to grant a paid skill without Stripe
    // ever seeing it. That is not a door: the only paid grant is a hosted session
    // that completeSkillCheckout re-reads from the processor.
    if (body.stripePaymentIntentId) {
      return c.json({ error: 'Payment intent ids are not accepted; complete a hosted checkout instead' }, 400);
    }

    // Look up price for skills (a persona has no price column — it records at 0).
    let priceCents = 0;
    let pricingModel: 'flat_fee' | 'consumption' = 'flat_fee';
    if (body.artifactType === 'skill') {
      const [skill] = await db
        .select({ priceCents: schema.marketplaceSkills.priceCents, pricingModel: schema.marketplaceSkills.pricingModel })
        .from(schema.marketplaceSkills)
        .where(and(eq(schema.marketplaceSkills.slug, body.artifactSlug), eq(schema.marketplaceSkills.published, true)))
        .limit(1);
      // Built-in skills are shipped in the first-party frontend catalog rather than
      // marketplace_skills. A missing row may therefore only be acquired as free;
      // it never creates paid entitlement. Published DB listings remain the
      // authoritative source for every non-zero price.
      if (skill) {
        priceCents   = skill.priceCents;
        pricingModel = skill.pricingModel;
      }
    }

    const [existing] = await db
      .select({ id: schema.marketplacePurchases.id })
      .from(schema.marketplacePurchases)
      .where(and(
        eq(schema.marketplacePurchases.userId, userId),
        eq(schema.marketplacePurchases.artifactType, body.artifactType),
        eq(schema.marketplacePurchases.artifactSlug, body.artifactSlug),
        isNull(schema.marketplacePurchases.tenantId),
      ))
      .limit(1);
    if (existing) return c.json({ ok: true, priceCents, pricingModel }, 200);

    if (priceCents > 0) {
      return c.json({ error: 'Purchase required', checkoutRequired: true, priceCents }, 402);
    }

    await db.insert(schema.marketplacePurchases).values({
      userId,
      artifactType: body.artifactType,
      artifactSlug: body.artifactSlug,
      priceCents,
      pricingModel,
    }).onConflictDoNothing();

    return c.json({ ok: true, priceCents, pricingModel }, 201);
  });

  /**
   * POST /marketplace/checkout — start a hosted payment for a PRICED skill.
   * Mirrors the workforce-agent checkout: records nothing. The return url is
   * the caller's; only its origin and path survive.
   */
  router.post('/checkout', webAuthMiddleware, async (c) => {
    const body = await parseBody(c, CheckoutStartBody);
    const returnUrl = body.returnUrl ?? `${new URL(c.req.url).origin}/marketplace`;
    try {
      const { checkoutUrl } = await startSkillCheckout(db, c.env as Env, {
        buyerUserId: c.get('userId') as string,
        buyerEmail: body.buyerEmail ?? null,
        artifactType: body.artifactType,
        artifactSlug: body.artifactSlug,
        returnUrl,
      });
      return c.json({ checkoutUrl });
    } catch (error) {
      if (error instanceof ListingError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  /**
   * POST /marketplace/checkout/complete — the processor's redirect lands here.
   * The session is re-read FROM the processor before the purchase is recorded;
   * the id in the body is untrusted until skillCommerce has verified it.
   */
  router.post('/checkout/complete', webAuthMiddleware, async (c) => {
    const body = await parseBody(c, CheckoutCompleteBody);
    try {
      const purchase = await completeSkillCheckout(db, c.env as Env, {
        buyerUserId: c.get('userId') as string,
        checkoutSessionId: body.checkoutSessionId,
      });
      return c.json({ purchased: true, purchase });
    } catch (error) {
      if (error instanceof ListingError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  /**
   * GET /marketplace/purchases – list own purchases (auth required)
   */
  router.get('/purchases', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    // USER-scoped by design, and `userId` is the access predicate: this is "what
    // I have bought", across every workspace I belong to and the marketing
    // marketplace (where the buyer has no workspace at all). `tenantId` is
    // PROJECTED — not filtered — so an agent purchase, which is held by a
    // workspace rather than by a person, says which workspace it landed in.
    const rows = await db
      .select({
        id:                    schema.marketplacePurchases.id,
        userId:                schema.marketplacePurchases.userId,
        tenantId:              schema.marketplacePurchases.tenantId,
        artifactType:          schema.marketplacePurchases.artifactType,
        artifactSlug:          schema.marketplacePurchases.artifactSlug,
        priceCents:            schema.marketplacePurchases.priceCents,
        pricingModel:          schema.marketplacePurchases.pricingModel,
        stripePaymentIntentId: schema.marketplacePurchases.stripePaymentIntentId,
        provider:              schema.marketplacePurchases.provider,
        externalRef:           schema.marketplacePurchases.externalRef,
        createdAt:             schema.marketplacePurchases.createdAt,
      })
      .from(schema.marketplacePurchases)
      .where(eq(schema.marketplacePurchases.userId, userId))
      .orderBy(desc(schema.marketplacePurchases.createdAt)).limit(LIST_ROW_CAP);
    return c.json({ purchases: rows });
  });

  return router;
}
