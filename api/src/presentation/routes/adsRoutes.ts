/**
 * Advertising routes — /api/ads
 *
 * The workspace's own paid media: which ad accounts are connected, what is running on
 * them, launching and steering campaigns, and what it all cost and returned.
 *
 *   GET   /networks              → the catalog + how many of each is connected
 *   GET   /accounts              → the connected ad accounts (never a token)
 *   GET   /campaigns             → what is running, merged across networks
 *   POST  /campaigns             → create one on one network
 *   PATCH /campaigns/:externalId → rename, re-budget, pause or resume
 *   GET   /insights              → the daily spend/result ledger, from our own store
 *   POST  /sync                  → pull campaigns + delivery from the networks now
 *
 * ── AUTH MODEL ───────────────────────────────────────────────────────────────
 * Reading is DEVELOPER-level. Everything that can move money — create, patch, and the
 * sync that mutates our ledger — is MANAGER-gated, the same bar as `campaign.send` and
 * `social.publish`. The reason is sharper here than for a post: a wrong budget spends
 * real money continuously until somebody notices, and no amount of deleting undoes it.
 *
 * Connecting an ad account is NOT here: it is a connector connection, created, tested
 * and edited through `/api/connectors` like every other one. A second connect flow
 * would mean a second credential store.
 */

import { Hono } from 'hono';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import {
  adCampaignQueryFrom,
  createAdCampaign,
  listAdAccounts,
  listAdNetworks,
  readAdCampaigns,
  resolveAdAccount,
  updateAdCampaign,
} from '../../application/advertising/adsService';
import { readAdInsightsLedger, syncTenantAdInsights } from '../../application/advertising/adInsightsSync';
import { isAdObjective, isAdNetwork, AD_STATUSES, type AdStatus } from '../../application/advertising/adsProviders';

/** A budget arrives as a decimal in the account currency and is stored in cents. */
function budgetCents(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

const isStatus = (value: unknown): value is AdStatus =>
  typeof value === 'string' && (AD_STATUSES as readonly string[]).includes(value);

/** Clamp an insights window. Defaults to 28 days — four whole weeks, so weekly
 *  seasonality does not read as a trend. */
function insightsWindow(since: string | null, until: string | null): { since: string; until: string } {
  const day = (date: Date) => date.toISOString().slice(0, 10);
  const valid = (value: string | null) => (/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value! : null);
  const end = valid(until) ?? day(new Date());
  const start = valid(since) ?? day(new Date(new Date(`${end}T00:00:00Z`).getTime() - 28 * 86_400_000));
  return { since: start, until: end };
}

export function createAdsRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  const manager = requireRole(TenantRole.MANAGER);

  r.use('*', authMiddleware);

  const ctx = (c: { env: unknown; get: (key: string) => unknown }) => ({
    env: c.env as Env,
    tenantId: c.get('tenantId') as number,
  });

  // GET /networks — the catalog, so an empty state can say what CAN be connected.
  r.get('/networks', async (c) => {
    const { env, tenantId } = ctx(c);
    return c.json({ networks: await listAdNetworks(db, env, tenantId) });
  });

  r.get('/accounts', async (c) => {
    const { env, tenantId } = ctx(c);
    return c.json({ accounts: await listAdAccounts(db, env, tenantId) });
  });

  // GET /campaigns — live from the networks, cached per account. This is what is
  // ACTUALLY running, as opposed to what our ledger last recorded.
  r.get('/campaigns', async (c) => {
    const { env, tenantId } = ctx(c);
    const query = adCampaignQueryFrom({
      networks: c.req.query('networks') ?? null,
      accounts: c.req.query('accounts') ?? null,
    });
    return c.json(await readAdCampaigns(db, env, tenantId, query));
  });

  // POST /campaigns — creates PAUSED unless explicitly launched, so writing a campaign
  // down is never the same act as starting to spend.
  r.post('/campaigns', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const body = await c.req.json().catch(() => ({})) as {
      connectionId?: string; network?: string; name?: string; objective?: string;
      dailyBudget?: number | string; totalBudget?: number | string;
      startsAt?: string; endsAt?: string; launch?: boolean;
    };

    const name = (body.name ?? '').trim();
    if (!name) return c.json({ error: 'A campaign needs a name.' }, 400);
    if (!isAdObjective(body.objective)) {
      return c.json({ error: 'Say what the campaign is for: awareness, traffic, engagement, leads, conversions, app_installs or video_views.' }, 400);
    }

    const resolved = await resolveAdAccount(db, env, tenantId, {
      connectionId: body.connectionId ?? null,
      network: body.network ?? null,
    });
    if (!resolved.ok) return c.json({ error: resolved.error }, 409);

    const daily = budgetCents(body.dailyBudget);
    const total = budgetCents(body.totalBudget);
    if (daily == null && total == null) {
      return c.json({ error: 'A campaign needs a daily or a total budget.' }, 400);
    }

    const outcome = await createAdCampaign(db, env, tenantId, resolved.account, {
      name,
      objective: body.objective,
      ...(daily !== undefined ? { dailyBudgetCents: daily } : {}),
      ...(total !== undefined ? { totalBudgetCents: total } : {}),
      ...(body.startsAt ? { startsAtISO: body.startsAt } : {}),
      ...(body.endsAt ? { endsAtISO: body.endsAt } : {}),
      status: body.launch === true ? 'active' : 'paused',
    }, 'user');
    if (!outcome.ok) return c.json({ error: outcome.error, retryable: outcome.retryable }, 502);
    return c.json({ created: true, account: outcome.account, campaign: outcome.result }, 201);
  });

  // PATCH /campaigns/:externalId — the steering surface. Pausing must be reachable in
  // one call, because it is what somebody does when the spend is wrong.
  r.patch('/campaigns/:externalId', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const externalId = c.req.param('externalId');
    const body = await c.req.json().catch(() => ({})) as {
      connectionId?: string; network?: string; name?: string; status?: string;
      dailyBudget?: number | string; totalBudget?: number | string;
    };

    const resolved = await resolveAdAccount(db, env, tenantId, {
      connectionId: body.connectionId ?? null,
      network: body.network ?? null,
    });
    if (!resolved.ok) return c.json({ error: resolved.error }, 409);
    if (body.status !== undefined && !isStatus(body.status)) {
      return c.json({ error: `Status must be one of: ${AD_STATUSES.join(', ')}.` }, 400);
    }

    const daily = budgetCents(body.dailyBudget);
    const total = budgetCents(body.totalBudget);
    const patch = {
      ...(body.name ? { name: body.name.trim() } : {}),
      ...(isStatus(body.status) ? { status: body.status } : {}),
      ...(daily !== undefined ? { dailyBudgetCents: daily } : {}),
      ...(total !== undefined ? { totalBudgetCents: total } : {}),
    };
    if (Object.keys(patch).length === 0) return c.json({ error: 'Nothing to change.' }, 400);

    const outcome = await updateAdCampaign(db, env, tenantId, resolved.account, externalId, patch, 'user');
    if (!outcome.ok) return c.json({ error: outcome.error, retryable: outcome.retryable }, 502);
    return c.json({ updated: true, account: outcome.account });
  });

  /**
   * GET /insights — read from OUR ledger, not from the networks.
   *
   * The sweep is what talks to the networks; this reads what it stored. That is what
   * makes the panel fast, makes it work when a grant has expired, and makes the number
   * on screen the same number every other rollup sees.
   */
  r.get('/insights', async (c) => {
    const { tenantId } = ctx(c);
    const window = insightsWindow(c.req.query('since') ?? null, c.req.query('until') ?? null);
    // The handler decides WHAT WAS ASKED FOR and nothing else. The join, the tenant
    // scoping and the derived rates are `readAdInsightsLedger`, in the application
    // layer, where every other caller can reach them and a test can exercise them
    // without a request.
    return c.json(await readAdInsightsLedger(db, tenantId, {
      since: window.since,
      until: window.until,
      networks: (c.req.query('networks') ?? '').split(',').map((n) => n.trim()).filter(Boolean),
    }));
  });

  // POST /sync — manager-gated because it writes the ledger every other panel reads.
  // The scheduled sweep does the same work; this is the "I want it now" door.
  r.post('/sync', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const results = await syncTenantAdInsights(db, env, tenantId);
    return c.json({
      synced: results.filter((result) => !result.error).length,
      results,
    });
  });

  return r;
}
