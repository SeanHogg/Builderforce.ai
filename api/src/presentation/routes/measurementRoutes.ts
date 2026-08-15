/**
 * Measurement routes — /api/measurement
 *
 * What happened AFTER the click. The other half of `/api/ads`: that one reports what a
 * network charged, this one reports whether anything came of it.
 *
 * Named `measurement` rather than `analytics` because `/api/analytics` is already the
 * TEAM-performance surface (contributor heatmaps, agent telemetry). Marketing
 * measurement and engineering-activity measurement are different questions asked by
 * different seats, and one path cannot answer both.
 *
 *   GET /sources    → the catalog + how many of each is connected
 *   GET /properties → the connected properties (never a token)
 *   GET /overview   → totals + a daily series across every connected property
 *   GET /breakdown  → one property, cut by channel / campaign / page / query / country
 *
 * ── AUTH MODEL ───────────────────────────────────────────────────────────────
 * Entirely DEVELOPER-level: nothing here writes anything anywhere, and a session count
 * is not a secret from the people building the thing being measured. There is no
 * manager gate because there is no act to gate.
 *
 * Connecting a property is NOT here — it is a connector connection, through
 * `/api/connectors` like every other one.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Env, HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import {
  analyticsWindowFrom,
  listAnalyticsProperties,
  listAnalyticsSources,
  readAnalytics,
  readAnalyticsBreakdown,
  resolveAnalyticsProperty,
} from '../../application/analytics/analyticsService';
import { ANALYTICS_DIMENSIONS, type AnalyticsDimension } from '../../application/analytics/analyticsProviders';

const isDimension = (value: unknown): value is AnalyticsDimension =>
  typeof value === 'string' && (ANALYTICS_DIMENSIONS as readonly string[]).includes(value);

export function createMeasurementRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  r.use('*', authMiddleware);

  const ctx = (c: { env: unknown; get: (key: string) => unknown }) => ({
    env: c.env as Env,
    tenantId: c.get('tenantId') as number,
  });

  r.get('/sources', async (c) => {
    const { env, tenantId } = ctx(c);
    return c.json({ sources: await listAnalyticsSources(db, env, tenantId) });
  });

  r.get('/properties', async (c) => {
    const { env, tenantId } = ctx(c);
    return c.json({ properties: await listAnalyticsProperties(db, env, tenantId) });
  });

  // GET /overview — every connected property over one window. Each answers for itself
  // rather than being summed: adding GA4 sessions to Plausible visits would be a
  // number describing nothing.
  r.get('/overview', async (c) => {
    const { env, tenantId } = ctx(c);
    const window = analyticsWindowFrom({
      since: c.req.query('since') ?? null,
      until: c.req.query('until') ?? null,
      days: c.req.query('days') ?? null,
    });
    const accounts = (c.req.query('properties') ?? '').split(',').map((v) => v.trim()).filter(Boolean);
    return c.json(await readAnalytics(db, env, tenantId, window, accounts.length ? { connectionIds: accounts } : {}));
  });

  // GET /breakdown — `channel` is the cut attribution needs: it is what says whether
  // the paid spend in /api/ads produced any of these sessions.
  r.get('/breakdown', async (c) => {
    const { env, tenantId } = ctx(c);
    const dimension = c.req.query('dimension') ?? 'channel';
    if (!isDimension(dimension)) {
      return c.json({ error: `Dimension must be one of: ${ANALYTICS_DIMENSIONS.join(', ')}.` }, 400);
    }

    const resolved = await resolveAnalyticsProperty(db, env, tenantId, {
      connectionId: c.req.query('property') ?? null,
      source: c.req.query('source') ?? null,
    });
    if (!resolved.ok) return c.json({ error: resolved.error }, 409);

    // Refusing a dimension the platform cannot serve is the provider's job, and it
    // names the ones that would have worked — so this surfaces it rather than 500ing.
    if (!resolved.account.provider.dimensions.includes(dimension)) {
      return c.json({
        error: `${resolved.account.provider.label} cannot break down by ${dimension}.`,
        supported: resolved.account.provider.dimensions,
      }, 400);
    }

    const window = analyticsWindowFrom({
      since: c.req.query('since') ?? null,
      until: c.req.query('until') ?? null,
      days: c.req.query('days') ?? null,
    });
    const limit = Number(c.req.query('limit'));
    const rows = await readAnalyticsBreakdown(db, env, tenantId, resolved.account, dimension, {
      ...window,
      ...(Number.isFinite(limit) && limit > 0 ? { limit: Math.min(Math.round(limit), 200) } : {}),
    });
    return c.json({
      dimension,
      window,
      source: resolved.account.provider.source,
      propertyName: resolved.account.row.name,
      rows,
    });
  });

  return r;
}
