import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type { Env, HonoEnv } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { demoEvents, salesLeads } from '../../infrastructure/database/schema';
import { isValidVisitorId } from '../../application/marketing/MarketingService';
import {
  demoAccountsEnabled,
  getDemoSessionTarget,
  reseedDemoTenants,
} from '../../application/demo/demoSeedService';
import { isDemoPersona } from '../../application/demo/demoPersonas';
import { mintWebSessionToken } from '../../infrastructure/auth/webSessionToken';
import { mintTenantSessionToken } from '../../infrastructure/auth/tenantSessionToken';
import { superAdminMiddleware } from '../middleware/superAdminMiddleware';

/**
 * Sales-cycle demo accounts (migration 0360) — PUBLIC routes for the marketing
 * shell:
 *
 *   POST /session  — one-click entry into a seeded persona demo tenant. Mints a
 *                    real (short-lived) web + tenant session for the shared demo
 *                    user, so the visitor explores the actual product, not a
 *                    recording. Changes they make are wiped on the next reseed.
 *   POST /events   — anonymous funnel telemetry batches (demo_start → views →
 *                    convert prompt → lead/exit), keyed by the marketing
 *                    visitorId. The signed-in activity tracker never covers
 *                    logged-out visitors, so this is its marketing twin.
 *   POST /leads    — "book a demo with sales" capture (also newsletter-adjacent
 *                    exit-intent leads).
 *   POST /reseed   — wipe + reseed all persona tenants. Guarded: deploy-hook
 *                    secret header OR a superadmin web token.
 *
 * Abuse control mirrors the guest-chat pattern: per-IP daily KV counters
 * (fail-open when KV is unbound, matching GuestChatService).
 */

const DEMO_SESSION_TTL_SECONDS = 3600;
const EVENT_KIND_RE = /^[a-z0-9_.:-]{1,64}$/i;
const MAX_EVENTS_PER_BATCH = 25;

const IP_LIMITS = {
  session: 30,
  events: 2000,
  lead: 10,
} as const;

/** Per-IP daily counter in KV; returns false when over the limit. Fail-open. */
async function bumpIpCounter(env: Env, bucket: keyof typeof IP_LIMITS, ip: string | null, weight = 1): Promise<boolean> {
  const kv = env.AUTH_CACHE_KV;
  if (!kv || !ip) return true;
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const key = `demo:${bucket}:ip:${day}:${ip}`;
  try {
    const current = Number((await kv.get(key)) ?? '0');
    if (current >= IP_LIMITS[bucket]) return false;
    await kv.put(key, String(current + weight), { expirationTtl: 86_400 });
  } catch {
    return true;
  }
  return true;
}

const clientIp = (c: { req: { header(name: string): string | undefined } }): string | null =>
  c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;

/** Deploy-hook secret OR superadmin web token may trigger a reseed. */
const reseedGuard: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const secret = c.env.DEMO_RESEED_SECRET;
  const header = c.req.header('x-demo-reseed-secret');
  if (secret && header && header === secret) return next();
  return superAdminMiddleware(c, next);
};

export function createDemoRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // One-click demo session: resolve the persona tenant (seeding it if this is a
  // fresh environment) and mint real web + tenant sessions for the demo user.
  router.post('/session', async (c) => {
    if (!demoAccountsEnabled(c.env)) {
      return c.json({ error: 'Demo accounts are disabled.', code: 'demo_disabled' }, 503);
    }
    const body = await c.req
      .json<{ persona?: string; visitorId?: string }>()
      .catch((): { persona?: string; visitorId?: string } => ({}));
    if (!isDemoPersona(body.persona)) return c.json({ error: 'Unknown demo persona' }, 400);
    if (!isValidVisitorId(body.visitorId)) return c.json({ error: 'Invalid visitor id' }, 400);

    const ip = clientIp(c);
    if (!(await bumpIpCounter(c.env, 'session', ip))) {
      return c.json({ error: 'Demo session limit reached for today.', code: 'demo_limit_reached' }, 429);
    }

    const target = await getDemoSessionTarget(c.env, body.persona);
    const db = buildDatabase(c.env);
    const userAgent = c.req.header('user-agent') ?? null;
    const [web, tenant] = [
      await mintWebSessionToken(db, c.env.JWT_SECRET, {
        userId: target.userId,
        email: target.email,
        username: target.username,
        sessionName: `Demo: ${target.persona}`,
        userAgent,
        ipAddress: ip,
        expiresIn: DEMO_SESSION_TTL_SECONDS,
      }),
      await mintTenantSessionToken(db, c.env.JWT_SECRET, {
        userId: target.userId,
        tenantId: target.tenantId,
        userAgent,
        ipAddress: ip,
        expiresIn: DEMO_SESSION_TTL_SECONDS,
      }),
    ];

    const visitorId = body.visitorId;
    c.executionCtx.waitUntil(
      db.insert(demoEvents).values({
        visitorId,
        persona: target.persona,
        kind: 'demo_start',
        path: target.entryPath,
      }).then(() => undefined).catch(() => {}),
    );

    return c.json({
      persona: target.persona,
      entryPath: target.entryPath,
      expiresInSeconds: DEMO_SESSION_TTL_SECONDS,
      webToken: web.token,
      tenantToken: tenant.token,
      user: {
        id: target.userId,
        email: target.email,
        username: target.username,
        displayName: target.displayName,
        avatarUrl: null,
        bio: null,
        isSuperadmin: false,
      },
      tenant: {
        id: target.tenantId,
        name: target.tenantName,
        slug: target.tenantSlug,
        role: 'owner',
        plan: target.plan,
      },
    });
  });

  // Anonymous funnel telemetry — small validated batches, append-only.
  router.post('/events', async (c) => {
    const body = await c.req
      .json<{ visitorId?: string; events?: Array<{ kind?: string; persona?: string; path?: string; metadata?: unknown; occurredAt?: string }> }>()
      .catch(() => ({} as { visitorId?: string; events?: never[] }));
    if (!isValidVisitorId(body.visitorId)) return c.json({ error: 'Invalid visitor id' }, 400);
    const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_BATCH) : [];
    const visitorId = body.visitorId;

    const now = Date.now();
    const rows = events.flatMap((e) => {
      if (typeof e?.kind !== 'string' || !EVENT_KIND_RE.test(e.kind)) return [];
      const occurredMs = e.occurredAt ? Date.parse(e.occurredAt) : NaN;
      return [{
        visitorId,
        persona: isDemoPersona(e.persona) ? e.persona : null,
        kind: e.kind.toLowerCase(),
        path: typeof e.path === 'string' ? e.path.slice(0, 300) : null,
        metadata: e.metadata && typeof e.metadata === 'object' ? e.metadata : null,
        occurredAt: Number.isFinite(occurredMs) && Math.abs(now - occurredMs) < 86_400_000
          ? new Date(occurredMs)
          : new Date(),
      }];
    });
    if (rows.length === 0) return c.json({ ok: true, accepted: 0 });

    if (!(await bumpIpCounter(c.env, 'events', clientIp(c), rows.length))) {
      return c.json({ ok: false, code: 'demo_limit_reached' }, 429);
    }
    await buildDatabase(c.env).insert(demoEvents).values(rows);
    return c.json({ ok: true, accepted: rows.length });
  });

  // "Book a demo" / sales-contact capture.
  router.post('/leads', async (c) => {
    const body = await c.req
      .json<{ name?: string; email?: string; company?: string; interest?: string; message?: string; source?: string; visitorId?: string }>()
      .catch(() => ({} as Record<string, never>));
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 320) : '';
    if (!name) return c.json({ error: 'Name is required' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'A valid email is required' }, 400);

    if (!(await bumpIpCounter(c.env, 'lead', clientIp(c)))) {
      return c.json({ error: 'Too many requests today.', code: 'demo_limit_reached' }, 429);
    }

    await buildDatabase(c.env).insert(salesLeads).values({
      name,
      email,
      company: typeof body.company === 'string' ? body.company.trim().slice(0, 200) || null : null,
      interest: typeof body.interest === 'string' ? body.interest.trim().slice(0, 64) || null : null,
      message: typeof body.message === 'string' ? body.message.trim().slice(0, 5000) || null : null,
      source: typeof body.source === 'string' ? body.source.trim().slice(0, 64) || null : null,
      locale: (c.req.header('x-builderforce-locale') ?? '').slice(0, 5) || null,
      visitorId: isValidVisitorId(body.visitorId) ? body.visitorId : null,
    });
    return c.json({ ok: true });
  });

  // Wipe + reseed all persona demo tenants (deploy hook / superadmin).
  router.post('/reseed', reseedGuard, async (c) => {
    const result = await reseedDemoTenants(c.env);
    return c.json(result);
  });

  return router;
}
