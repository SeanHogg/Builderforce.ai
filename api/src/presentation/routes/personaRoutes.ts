/**
 * Persona routes — /api/personas/*
 *
 * Two concerns:
 *   1. The psychometric-persona catalog + scoring used by the Pro persona editor
 *      (sliders / questionnaire / import). Static in-memory constant + pure
 *      functions; the behavioural compile happens later, in agent-runtime.
 *   2. The server-backed personas MARKETPLACE (migration 0203) — mirrors the
 *      prompt library: a tenant publishes a persona others browse + install.
 *
 * PUBLIC (no auth):
 *   GET  /api/personas/public        Browse public personas (q/category/sort, cached)
 *   GET  /api/personas/:slug         Public persona detail
 *
 * AUTH (tenant JWT):
 *   GET  /api/personas/psychometric/catalog            Framework catalog (Pro-aware)
 *   POST /api/personas/psychometric/score|import       Pure scoring helpers (universal)
 *   GET  /api/personas/mine          This tenant's personas (any visibility)
 *   POST /api/personas               Publish / create a persona (tenant-scoped)
 *   POST /api/personas/:id/install   Record an install/use (bumps install_count)
 *
 * Where the Pro gate lives: `score`/`import` are PURE, side-effect-free math
 * (answers/JSON → trait vector) and are used by BOTH the Pro agent/persona editor
 * AND every user's own personality test (universal, free — see the /settings page).
 * So they are NOT gated. The paid-plan entitlement is enforced at the point a
 * psychometric profile is ATTACHED to an agent/persona (the publish route here and
 * the Workforce agent routes), via the shared feature gate
 * (`tenantHasFeature(..., 'psychometricPersona')`) — superadmin- and
 * premium-override-aware, defined once.
 */
import { Hono } from 'hono';
import { and, desc, eq, ilike, ne, or, sql as dsql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantHasFeature } from '../middleware/featureGate';
import { requiredPlanForFeature } from '../../domain/tenant/planFeatures';
import {
  PSYCHOMETRIC_CATALOG,
  PSYCHOMETRIC_QUESTIONS,
  ENNEAGRAM_TYPES,
  scoreQuestionnaire,
  sanitizeVector,
  sanitizePsychometricProfile,
} from '../../application/persona/psychometricCatalog';
import { marketplacePersonas } from '../../infrastructure/database/schema';
import { invalidateCapabilityCache } from '../../application/artifact/capabilityContext';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { slugify as slugifyBase } from '../../domain/shared/strings';
import { parseJsonArray } from '../../domain/shared/json';

/** Version key for the public personas keyspace — bumped on any publish so the
 *  searchable (q/category/sort) cached browse results all age out at once. */
const PERSONA_PUBLIC_VERSION_KEY = 'personas:public';
const PERSONA_PUBLIC_CACHE_TTL_SECONDS = 120;

function slugify(s: string): string {
  return slugifyBase(s, { maxLen: 80, fallback: 'persona' });
}

function safeTags(v: unknown): string[] {
  return parseJsonArray<string>(v);
}

/**
 * Normalize a persona body to the shape the editor uses + agent-runtime compiles:
 * { voice, perspective, decisionStyle, outputPrefix, capabilities[], systemDirectives }.
 * Drops unknown keys so a published persona is a predictable contract.
 */
function sanitizePersonaBody(v: unknown): Record<string, unknown> {
  const o = (v && typeof v === 'object') ? v as Record<string, unknown> : {};
  const str = (k: string): string => (typeof o[k] === 'string' ? (o[k] as string) : '');
  return {
    voice: str('voice'),
    perspective: str('perspective'),
    decisionStyle: str('decisionStyle'),
    outputPrefix: str('outputPrefix'),
    capabilities: Array.isArray(o.capabilities) ? (o.capabilities as unknown[]).map(String).filter(Boolean) : [],
    systemDirectives: str('systemDirectives'),
    // Cover image URL — carried in the body JSON so a published persona keeps its
    // marketplace card image (no dedicated column needed).
    image: str('image'),
  };
}

/** A public slug globally unique among PUBLIC rows (partial unique index in 0203). */
async function publicSafeSlug(db: Db, base: string, excludeId: string | null): Promise<string> {
  const conds = [eq(marketplacePersonas.slug, base), eq(marketplacePersonas.visibility, 'public')];
  if (excludeId) conds.push(ne(marketplacePersonas.id, excludeId));
  const [clash] = await db.select({ id: marketplacePersonas.id }).from(marketplacePersonas).where(and(...conds));
  if (!clash) return base;
  return `${base}-${(excludeId ?? `${Date.now()}`).replace(/-/g, '').slice(0, 6)}`;
}

type PersonaRow = typeof marketplacePersonas.$inferSelect;
function publicView(r: PersonaRow) {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    category: r.category,
    tags: safeTags(r.tags),
    persona: r.persona,
    psychometric: r.psychometric ? (JSON.parse(r.psychometric) as unknown) : null,
    authorName: r.authorName,
    installCount: r.installCount,
    likeCount: r.likeCount,
    updatedAt: r.updatedAt,
  };
}

export function createPersonaRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ───────────────────────────── PUBLIC ──────────────────────────────────────
  // Defined BEFORE authMiddleware so they stay open to the world.

  // GET /api/personas/public — browse published personas (q / category / sort).
  // Read-heavy + world-readable over a SEARCHABLE keyspace → cached with a version
  // token folded into the key, so a publish bumps the token and orphans every
  // cached query variant at once (rather than enumerating each q/category combo).
  router.get('/public', async (c) => {
    const q = c.req.query('q')?.trim();
    const category = c.req.query('category')?.trim();
    const sort = c.req.query('sort') ?? 'popular';
    const limit = Math.min(Number(c.req.query('limit') ?? '60'), 100);
    const offset = Math.max(Number(c.req.query('offset') ?? '0'), 0);

    const version = await getCacheVersion(c.env as Env, PERSONA_PUBLIC_VERSION_KEY);
    const cacheKey = `personas:public:v:${version}:q=${q ?? ''}:c=${category ?? ''}:s=${sort}:l=${limit}:o=${offset}`;

    const personas = await getOrSetCached(
      c.env as Env,
      cacheKey,
      async () => {
        const conds = [eq(marketplacePersonas.visibility, 'public')];
        if (q) {
          const like = `%${q}%`;
          conds.push(or(ilike(marketplacePersonas.name, like), ilike(marketplacePersonas.description, like))!);
        }
        if (category) conds.push(eq(marketplacePersonas.category, category));
        const order =
          sort === 'recent' ? desc(marketplacePersonas.createdAt)
          : sort === 'liked' ? desc(marketplacePersonas.likeCount)
          : desc(marketplacePersonas.installCount);
        const rows = await db
          .select()
          .from(marketplacePersonas)
          .where(and(...conds))
          .orderBy(order, desc(marketplacePersonas.likeCount))
          .limit(limit)
          .offset(offset);
        return rows.map(publicView);
      },
      { kvTtlSeconds: PERSONA_PUBLIC_CACHE_TTL_SECONDS },
    );

    return c.json({ personas });
  });

  // -------------------------------------------------------------------------
  // GET /api/personas/psychometric/catalog
  // The full framework suite + questionnaire bank. Static constant — every
  // authenticated user may read it (so the editor can render the locked state).
  // -------------------------------------------------------------------------
  router.get('/psychometric/catalog', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    // `entitled` here gates ATTACHING a profile to an agent/persona (the editor's
    // locked state). Superadmin- and premium-override-aware via the shared gate.
    const entitled = await tenantHasFeature(c.env, tenantId, userId, 'psychometricPersona');
    return c.json({
      entitled,
      requiredPlan: requiredPlanForFeature('psychometricPersona'),
      frameworks: PSYCHOMETRIC_CATALOG,
      questions: PSYCHOMETRIC_QUESTIONS,
      enneagram: ENNEAGRAM_TYPES,
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/personas/psychometric/score
  // Body: { answers: { [questionId]: 1..5 } } -> { vector }
  //
  // Pure, side-effect-free scoring. NOT plan-gated: this same endpoint powers
  // every user's own (universal, free) personality test on /settings as well as
  // the Pro agent/persona editor. The paid gate lives where a vector is ATTACHED
  // to an agent/persona, not on the math.
  // -------------------------------------------------------------------------
  router.post('/psychometric/score', authMiddleware, async (c) => {
    const body = await c.req
      .json<{ answers?: Record<string, number> }>()
      .catch(() => ({ answers: {} as Record<string, number> }));
    const vector = scoreQuestionnaire(body.answers ?? {});
    return c.json({ vector, source: 'questionnaire' });
  });

  // -------------------------------------------------------------------------
  // POST /api/personas/psychometric/import
  // Body: { vector: Record<string, number> } (e.g. a human's test results)
  // -> sanitised vector (unknown dimensions dropped, values clamped 0..100)
  //
  // Pure sanitiser — same rationale as `/score`: universal, not plan-gated.
  // -------------------------------------------------------------------------
  router.post('/psychometric/import', authMiddleware, async (c) => {
    const body = await c.req.json<{ vector?: unknown }>().catch(() => ({ vector: undefined }));
    const vector = sanitizeVector(body.vector);
    return c.json({ vector, source: 'imported' });
  });

  // ───────────────────────── MARKETPLACE (AUTH) ──────────────────────────────

  // GET /api/personas/mine — this tenant's personas (any visibility). Registered
  // before the public `/:slug` so "mine" isn't swallowed by the slug route.
  router.get('/mine', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await db
      .select()
      .from(marketplacePersonas)
      .where(eq(marketplacePersonas.tenantId, tenantId))
      .orderBy(desc(marketplacePersonas.updatedAt));
    return c.json({ personas: rows.map((r) => ({ ...publicView(r), visibility: r.visibility })) });
  });

  // POST /api/personas — publish / create a persona (tenant-scoped). Invalidates
  // the public browse cache (via a version bump) when the row is public.
  router.post('/', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    type PersonaCreateBody = {
      name?: string;
      description?: string;
      category?: string;
      tags?: string[];
      visibility?: 'private' | 'tenant' | 'public';
      authorName?: string;
      persona?: unknown;
      /** PsychometricProfile — the behaviour-bearing trait vector (Pro only). */
      psychometric?: unknown;
    };
    const body = await c.req.json<PersonaCreateBody>().catch((): PersonaCreateBody => ({}));

    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const visibility = body.visibility ?? 'private';
    let slug = slugify(body.name);
    if (visibility === 'public') slug = await publicSafeSlug(db, slug, null);

    // Psychometric profiles are a Pro feature — silently store none for free plans
    // (rather than failing the whole publish) so the persona still saves.
    const psychometric =
      body.psychometric != null && (await tenantHasFeature(c.env, tenantId, userId, 'psychometricPersona'))
        ? sanitizePsychometricProfile(body.psychometric)
        : null;

    const [row] = await db
      .insert(marketplacePersonas)
      .values({
        tenantId,
        createdBy: userId ?? null,
        name: body.name.trim(),
        slug,
        description: body.description ?? null,
        category: body.category ?? null,
        tags: JSON.stringify(body.tags ?? []),
        persona: sanitizePersonaBody(body.persona),
        psychometric,
        visibility,
        authorName: body.authorName ?? null,
      })
      .returning();
    if (!row) return c.json({ error: 'Failed to create persona' }, 500);

    if (visibility === 'public') await bumpCacheVersion(c.env as Env, PERSONA_PUBLIC_VERSION_KEY);
    // Drop any stale runtime body cached under this slug so the next cloud run
    // re-reads the persona (incl. its psychometric) — symmetric with the admin path.
    await invalidateCapabilityCache(c.env as Env, 'persona', slug);
    return c.json({ ...publicView(row), visibility: row.visibility }, 201);
  });

  // POST /api/personas/:id/install — record an install/use of a persona. Anyone
  // may install a PUBLIC persona; a tenant may install its own (any visibility).
  router.post('/:id/install', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [row] = await db
      .select({ id: marketplacePersonas.id, visibility: marketplacePersonas.visibility, tenantId: marketplacePersonas.tenantId })
      .from(marketplacePersonas)
      .where(eq(marketplacePersonas.id, id));
    if (!row || (row.visibility !== 'public' && row.tenantId !== tenantId)) {
      return c.json({ error: 'Persona not found' }, 404);
    }
    const [updated] = await db
      .update(marketplacePersonas)
      .set({ installCount: dsql`${marketplacePersonas.installCount} + 1` })
      .where(eq(marketplacePersonas.id, id))
      .returning();
    return c.json({ installed: true, installCount: updated?.installCount ?? null });
  });

  // GET /api/personas/:slug — public persona detail. Registered LAST so the
  // literal routes above (/public, /mine, /psychometric/*) take precedence.
  router.get('/:slug', async (c) => {
    const slug = c.req.param('slug');
    const [row] = await db
      .select()
      .from(marketplacePersonas)
      .where(and(eq(marketplacePersonas.slug, slug), eq(marketplacePersonas.visibility, 'public')));
    if (!row) return c.json({ error: 'Persona not found' }, 404);
    return c.json(publicView(row));
  });

  return router;
}
