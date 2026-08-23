/**
 * Ad-set and ad routes — mounted under /api/ads
 *
 *   GET   /adsets                  → the ad sets on an account, optionally per campaign
 *   POST  /adsets                  → create one, with a real targeting spec
 *   PATCH /adsets/:externalId      → rename, re-budget, re-target, pause or resume
 *   GET   /ads                     → the creatives in an ad set
 *   POST  /ads                     → create one; its destination URL is UTM-tagged here
 *   PATCH /ads/:externalId         → rename, pause or resume
 *
 * ── WHY A SECOND ROUTE MODULE ───────────────────────────────────────────────────
 * `adsRoutes` owns accounts, campaigns, insights and the sync. This owns the two
 * levels beneath a campaign, mirroring the `adsService` / `adSetService` split exactly.
 * One reason to change each: a new targeting dimension is a change here and nowhere
 * else, and the campaign router does not grow every time the ad level gains a field.
 * Both mount on the same prefix, so the split is invisible to a caller.
 *
 * ── AUTH MODEL ───────────────────────────────────────────────────────────────────
 * Identical to `adsRoutes`, and deliberately not re-argued: reading is DEVELOPER-level,
 * everything that can move money is MANAGER-gated. An ad set carries the daily budget
 * on most networks, so creating one is exactly as expensive a mistake as creating a
 * campaign.
 *
 * ── WHAT A CALLER DOES NOT HAVE TO DO ────────────────────────────────────────────
 * Tag a destination URL. `adSetService.createAd` stamps `utm_source` / `utm_medium` /
 * `utm_campaign` / `utm_content` before any adapter sees the URL, from the campaign's
 * own stored tag. A caller who passes their own `utm_*` keeps it — the tagger never
 * clobbers a param somebody wrote deliberately.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import { resolveAdAccount } from '../../application/advertising/adsService';
import {
  createAd, createAdSet, readAdSets, readAds, updateAd, updateAdSet,
} from '../../application/advertising/adSetService';
import { AD_STATUSES, isAdObjective, type AdStatus } from '../../application/advertising/adsProviders';
import { parseTargeting } from '../../application/advertising/adTargeting';

const isStatus = (value: unknown): value is AdStatus =>
  typeof value === 'string' && (AD_STATUSES as readonly string[]).includes(value);

/**
 * Whole cents from a wire number, or `undefined` for "not mentioned".
 *
 * `null` and `undefined` mean different things and both are legitimate: `null` clears a
 * budget, `undefined` leaves it alone. Collapsing them is how a rename silently removes
 * a budget cap.
 */
function budgetCents(value: number | string | null | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  return Math.round(amount * 100);
}

export function createAdSetRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  const manager = requireRole(TenantRole.MANAGER);

  r.use('*', authMiddleware);

  const ctx = (c: { env: unknown; get: (key: string) => unknown }) => ({
    env: c.env as Env,
    tenantId: c.get('tenantId') as number,
  });

  /**
   * The account this call is about. Every handler below starts here, so the 409 for an
   * unconnected or ambiguous account is worded once.
   */
  const account = async (
    c: { env: unknown; get: (key: string) => unknown },
    input: { connectionId?: string | null; network?: string | null },
  ) => {
    const { env, tenantId } = ctx(c);
    return resolveAdAccount(db, env, tenantId, {
      connectionId: input.connectionId ?? null,
      network: input.network ?? null,
    });
  };

  // ── Ad sets ───────────────────────────────────────────────────────────────

  r.get('/adsets', async (c) => {
    const { env, tenantId } = ctx(c);
    const resolved = await account(c, {
      connectionId: c.req.query('connectionId'), network: c.req.query('network'),
    });
    if (!resolved.ok) return c.json({ error: resolved.error }, 409);
    const adSets = await readAdSets(
      db, env, tenantId, resolved.account, c.req.query('campaignId') ?? null, 'user',
    );
    return c.json({ adSets });
  });

  // Created PAUSED unless explicitly launched — writing an ad set down is never the
  // same act as starting to spend, which is the same rule campaigns follow.
  r.post('/adsets', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const body = await c.req.json().catch(() => ({})) as {
      connectionId?: string; network?: string; campaignId?: string; name?: string;
      objective?: string; targeting?: unknown;
      dailyBudget?: number | string; bid?: number | string;
      startsAt?: string; endsAt?: string; launch?: boolean;
    };

    const name = (body.name ?? '').trim();
    if (!name) return c.json({ error: 'An ad set needs a name.' }, 400);
    const campaignId = (body.campaignId ?? '').trim();
    if (!campaignId) return c.json({ error: 'An ad set belongs to a campaign — pass campaignId.' }, 400);
    // Carried DOWN rather than looked up: on X the line item IS where the objective
    // lives, so re-reading the campaign would not answer it. See `AdSetDraft.objective`.
    if (!isAdObjective(body.objective)) {
      return c.json({ error: 'Say what the ad set is for: awareness, traffic, engagement, leads, conversions, app_installs or video_views.' }, 400);
    }

    const targeting = parseTargeting(body.targeting);
    if (!targeting.ok) return c.json({ error: targeting.error }, 400);

    const resolved = await account(c, body);
    if (!resolved.ok) return c.json({ error: resolved.error }, 409);

    const daily = budgetCents(body.dailyBudget);
    const bid = budgetCents(body.bid);
    const outcome = await createAdSet(db, env, tenantId, resolved.account, {
      externalCampaignId: campaignId,
      name,
      objective: body.objective,
      targeting: targeting.targeting,
      ...(daily !== undefined ? { dailyBudgetCents: daily } : {}),
      ...(bid !== undefined ? { bidCents: bid } : {}),
      ...(body.startsAt ? { startsAtISO: body.startsAt } : {}),
      ...(body.endsAt ? { endsAtISO: body.endsAt } : {}),
      status: body.launch === true ? 'active' : 'paused',
    }, 'user');
    if (!outcome.ok) return c.json({ error: outcome.error, retryable: outcome.retryable }, 502);
    return c.json({ created: true, account: outcome.account, adSet: outcome.result }, 201);
  });

  r.patch('/adsets/:externalId', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const externalId = c.req.param('externalId');
    const body = await c.req.json().catch(() => ({})) as {
      connectionId?: string; network?: string; name?: string; status?: string;
      dailyBudget?: number | string; bid?: number | string; targeting?: unknown;
    };

    if (body.status !== undefined && !isStatus(body.status)) {
      return c.json({ error: `Status must be one of: ${AD_STATUSES.join(', ')}.` }, 400);
    }
    // Targeting is a REPLACEMENT, not a merge — every network replaces here, and
    // pretending otherwise would silently keep dimensions the caller dropped.
    const targeting = body.targeting === undefined ? null : parseTargeting(body.targeting);
    if (targeting && !targeting.ok) return c.json({ error: targeting.error }, 400);

    const resolved = await account(c, body);
    if (!resolved.ok) return c.json({ error: resolved.error }, 409);

    const daily = budgetCents(body.dailyBudget);
    const bid = budgetCents(body.bid);
    const patch = {
      ...(body.name ? { name: body.name.trim() } : {}),
      ...(isStatus(body.status) ? { status: body.status } : {}),
      ...(daily !== undefined ? { dailyBudgetCents: daily } : {}),
      ...(bid !== undefined ? { bidCents: bid } : {}),
      ...(targeting?.ok ? { targeting: targeting.targeting } : {}),
    };
    if (Object.keys(patch).length === 0) return c.json({ error: 'Nothing to change.' }, 400);

    const outcome = await updateAdSet(db, env, tenantId, resolved.account, externalId, patch, 'user');
    if (!outcome.ok) return c.json({ error: outcome.error, retryable: outcome.retryable }, 502);
    return c.json({ updated: true, account: outcome.account });
  });

  // ── Ads ───────────────────────────────────────────────────────────────────

  r.get('/ads', async (c) => {
    const { env, tenantId } = ctx(c);
    const resolved = await account(c, {
      connectionId: c.req.query('connectionId'), network: c.req.query('network'),
    });
    if (!resolved.ok) return c.json({ error: resolved.error }, 409);
    const creatives = await readAds(
      db, env, tenantId, resolved.account, c.req.query('adSetId') ?? null, 'user',
    );
    return c.json({ ads: creatives });
  });

  r.post('/ads', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const body = await c.req.json().catch(() => ({})) as {
      connectionId?: string; network?: string; adSetId?: string; name?: string;
      headline?: string; body?: string; callToAction?: string;
      destinationUrl?: string; creativeRef?: string; launch?: boolean;
    };

    const name = (body.name ?? '').trim();
    if (!name) return c.json({ error: 'An ad needs a name.' }, 400);
    const adSetId = (body.adSetId ?? '').trim();
    if (!adSetId) return c.json({ error: 'An ad belongs to an ad set — pass adSetId.' }, 400);

    const resolved = await account(c, body);
    if (!resolved.ok) return c.json({ error: resolved.error }, 409);

    const outcome = await createAd(db, env, tenantId, resolved.account, {
      externalAdSetId: adSetId,
      name,
      ...(body.headline ? { headline: body.headline } : {}),
      ...(body.body ? { body: body.body } : {}),
      ...(body.callToAction ? { callToAction: body.callToAction } : {}),
      ...(body.destinationUrl ? { destinationUrl: body.destinationUrl } : {}),
      ...(body.creativeRef ? { creativeRef: body.creativeRef } : {}),
      status: body.launch === true ? 'active' : 'paused',
    }, 'user');
    if (!outcome.ok) return c.json({ error: outcome.error, retryable: outcome.retryable }, 502);
    // `utmCampaign` is echoed so a caller can SEE the attribution their click will
    // carry, rather than discovering it a week later in an analytics report.
    return c.json({
      created: true, account: outcome.account, ad: outcome.result,
      utmCampaign: outcome.result.utmCampaign,
    }, 201);
  });

  r.patch('/ads/:externalId', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const externalId = c.req.param('externalId');
    const body = await c.req.json().catch(() => ({})) as {
      connectionId?: string; network?: string; name?: string; status?: string;
    };

    if (body.status !== undefined && !isStatus(body.status)) {
      return c.json({ error: `Status must be one of: ${AD_STATUSES.join(', ')}.` }, 400);
    }
    const resolved = await account(c, body);
    if (!resolved.ok) return c.json({ error: resolved.error }, 409);

    const patch = {
      ...(body.name ? { name: body.name.trim() } : {}),
      ...(isStatus(body.status) ? { status: body.status } : {}),
    };
    if (Object.keys(patch).length === 0) return c.json({ error: 'Nothing to change.' }, 400);

    const outcome = await updateAd(db, env, tenantId, resolved.account, externalId, patch, 'user');
    if (!outcome.ok) return c.json({ error: outcome.error, retryable: outcome.retryable }, 502);
    return c.json({ updated: true, account: outcome.account });
  });

  return r;
}
