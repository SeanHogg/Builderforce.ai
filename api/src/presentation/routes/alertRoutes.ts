/**
 * Alerts — /api/alerts/*
 *
 * CRUD for user-defined threshold alert RULES + a read of recent alert EVENTS
 * (firings) + an acknowledge action + an on-demand test evaluation. The daily
 * runAlertSweep evaluates the rules and writes the events; this router is the
 * management surface.
 *
 * Manager-gated (mirrors the insight lenses — alerts are an exec/ops control).
 * Reads go through the version-token read-through cache (the events table is
 * hot-write from the sweep, so writes bump a per-tenant token rather than
 * deleting each window key).
 *
 *   GET    /            list alert rules
 *   POST   /            create a rule
 *   PATCH  /:id         update a rule
 *   DELETE /:id         delete a rule
 *   GET    /events      recent firings (?limit, ?status)
 *   POST   /events/:id/ack   acknowledge an event
 *   POST   /:id/test    evaluate a rule once now (observed value; no notify)
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { alerts, alertEvents, type AlertMetric } from '../../infrastructure/database/schema';
import { ALERT_METRICS, evaluateMetric } from '../../application/alerts/metricEvaluators';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

const COMPARATORS = ['gt', 'lt', 'gte', 'lte'] as const;
const SCOPE_KINDS = ['tenant', 'project', 'team'] as const;
const STATUSES = ['triggered', 'acknowledged', 'resolved'] as const;

type Comparator = (typeof COMPARATORS)[number];
type ScopeKind = (typeof SCOPE_KINDS)[number];

/** Per-tenant cache version token for the alerts surface (rules + events). */
function alertsVersionKey(tenantId: number): string {
  return `alerts-version:tenant:${tenantId}`;
}

/** Parse a positive-int query param within [1, max], else a default. */
function parseLimit(raw: string | undefined, def = 50, max = 200): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.min(max, Math.floor(n)) : def;
}

function isMetric(v: unknown): v is AlertMetric {
  return typeof v === 'string' && (ALERT_METRICS as readonly string[]).includes(v);
}
function isComparator(v: unknown): v is Comparator {
  return typeof v === 'string' && (COMPARATORS as readonly string[]).includes(v);
}
function isScopeKind(v: unknown): v is ScopeKind {
  return typeof v === 'string' && (SCOPE_KINDS as readonly string[]).includes(v);
}

/** Coerce + whitelist the writable fields off a request body. Returns the
 *  validated patch, or an error string. `creating` enforces required fields. */
function buildWriteFields(
  body: Record<string, unknown>,
  creating: boolean,
): { fields: Record<string, unknown> } | { error: string } {
  const out: Record<string, unknown> = {};

  if (creating || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return { error: 'name is required' };
    out.name = body.name.trim();
  }
  if (creating || body.metric !== undefined) {
    if (!isMetric(body.metric)) return { error: `metric must be one of: ${ALERT_METRICS.join(', ')}` };
    out.metric = body.metric;
  }
  if (creating || body.comparator !== undefined) {
    if (!isComparator(body.comparator)) return { error: `comparator must be one of: ${COMPARATORS.join(', ')}` };
    out.comparator = body.comparator;
  }
  if (body.scopeKind !== undefined) {
    if (!isScopeKind(body.scopeKind)) return { error: `scopeKind must be one of: ${SCOPE_KINDS.join(', ')}` };
    out.scopeKind = body.scopeKind;
  }
  if (body.threshold !== undefined) {
    const n = Number(body.threshold);
    if (!Number.isFinite(n)) return { error: 'threshold must be a number' };
    out.threshold = n;
  }
  if (body.windowDays !== undefined) {
    const n = Number(body.windowDays);
    if (!Number.isInteger(n) || n < 1 || n > 365) return { error: 'windowDays must be an integer in [1, 365]' };
    out.windowDays = n;
  }
  if (body.cooldownHours !== undefined) {
    const n = Number(body.cooldownHours);
    if (!Number.isInteger(n) || n < 0) return { error: 'cooldownHours must be a non-negative integer' };
    out.cooldownHours = n;
  }
  if (body.projectId !== undefined) out.projectId = body.projectId == null ? null : Number(body.projectId);
  if (body.teamId !== undefined) out.teamId = body.teamId == null ? null : Number(body.teamId);
  if (body.notifySlack !== undefined) out.notifySlack = Boolean(body.notifySlack);
  if (body.notifyEmail !== undefined) out.notifyEmail = Boolean(body.notifyEmail);
  if (body.enabled !== undefined) out.enabled = Boolean(body.enabled);

  return { fields: out };
}

export function createAlertRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  // ── Rules ──────────────────────────────────────────────────────────────────

  router.get('/', async (c) => {
    const { tenantId } = scope(c);
    const env = c.env as Env;
    const ver = await getCacheVersion(env, alertsVersionKey(tenantId));
    const key = `alerts:rules:t:${tenantId}:v:${ver}`;
    const rows = await getOrSetCached(env, key, () =>
      db.select().from(alerts).where(eq(alerts.tenantId, tenantId)).orderBy(desc(alerts.createdAt)),
      SHORT_TTL,
    );
    return c.json({ alerts: rows });
  });

  router.post('/', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string | undefined;
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const built = buildWriteFields(body, true);
    if ('error' in built) return c.json({ error: built.error }, 400);

    const [row] = await db
      .insert(alerts)
      .values({ ...built.fields, tenantId, segmentId, createdBy: userId } as typeof alerts.$inferInsert)
      .returning();
    await bumpCacheVersion(c.env as Env, alertsVersionKey(tenantId));
    return c.json(row, 201);
  });

  router.patch('/:id', async (c) => {
    const { tenantId } = scope(c);
    const id = c.req.param('id');
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const built = buildWriteFields(body, false);
    if ('error' in built) return c.json({ error: built.error }, 400);
    if (Object.keys(built.fields).length === 0) return c.json({ error: 'nothing to update' }, 400);

    const [row] = await db
      .update(alerts)
      .set({ ...built.fields, updatedAt: new Date() })
      .where(and(eq(alerts.id, id), eq(alerts.tenantId, tenantId)))
      .returning();
    if (!row) return c.json({ error: 'not found' }, 404);
    await bumpCacheVersion(c.env as Env, alertsVersionKey(tenantId));
    return c.json(row);
  });

  router.delete('/:id', async (c) => {
    const { tenantId } = scope(c);
    const id = c.req.param('id');
    const [row] = await db
      .delete(alerts)
      .where(and(eq(alerts.id, id), eq(alerts.tenantId, tenantId)))
      .returning({ id: alerts.id });
    if (!row) return c.json({ error: 'not found' }, 404);
    await bumpCacheVersion(c.env as Env, alertsVersionKey(tenantId));
    return c.json({ deleted: row.id });
  });

  // ── Events (firings) ─────────────────────────────────────────────────────────

  router.get('/events', async (c) => {
    const { tenantId } = scope(c);
    const env = c.env as Env;
    const limit = parseLimit(c.req.query('limit'));
    const statusRaw = c.req.query('status');
    const status = (STATUSES as readonly string[]).includes(statusRaw ?? '') ? statusRaw : undefined;

    const ver = await getCacheVersion(env, alertsVersionKey(tenantId));
    const key = `alerts:events:t:${tenantId}:l:${limit}:s:${status ?? 'all'}:v:${ver}`;
    const rows = await getOrSetCached(env, key, () => {
      const conds = [eq(alertEvents.tenantId, tenantId)];
      if (status) conds.push(eq(alertEvents.status, status));
      return db.select().from(alertEvents).where(and(...conds)).orderBy(desc(alertEvents.createdAt)).limit(limit);
    }, SHORT_TTL);
    return c.json({ events: rows });
  });

  router.post('/events/:id/ack', async (c) => {
    const { tenantId } = scope(c);
    const userId = c.get('userId') as string | undefined;
    const id = c.req.param('id');
    const [row] = await db
      .update(alertEvents)
      .set({ status: 'acknowledged', acknowledgedBy: userId, acknowledgedAt: new Date() })
      .where(and(eq(alertEvents.id, id), eq(alertEvents.tenantId, tenantId)))
      .returning();
    if (!row) return c.json({ error: 'not found' }, 404);
    await bumpCacheVersion(c.env as Env, alertsVersionKey(tenantId));
    return c.json(row);
  });

  // ── Test a rule once now (observed value; no notify, no event written) ────────

  router.post('/:id/test', async (c) => {
    const { tenantId } = scope(c);
    const id = c.req.param('id');
    const [rule] = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.id, id), eq(alerts.tenantId, tenantId)))
      .limit(1);
    if (!rule) return c.json({ error: 'not found' }, 404);

    const { value } = await evaluateMetric(db, c.env as Env, {
      tenantId,
      metric: rule.metric as AlertMetric,
      scopeKind: rule.scopeKind,
      projectId: rule.projectId,
      teamId: rule.teamId,
      windowDays: rule.windowDays,
    });
    return c.json({ metric: rule.metric, observedValue: value, threshold: rule.threshold, comparator: rule.comparator });
  });

  return router;
}
