/**
 * Social routes — /api/social
 *
 * The workspace's own social accounts: what is connected, what they have published,
 * and publishing to them — as one post or as a campaign that goes out everywhere.
 *
 *   GET    /networks               → the catalog + how many of each is connected
 *   GET    /accounts               → the connected accounts (never a token)
 *   GET    /feed                   → the merged, newest-first feed
 *   POST   /publish                → one post to one account
 *   GET    /campaigns              → campaigns with their per-account posts
 *   POST   /campaigns              → draft one (materializes a post per target)
 *   PATCH  /campaigns/:id          → edit a draft
 *   DELETE /campaigns/:id          → remove a draft
 *   POST   /campaigns/:id/publish  → publish a batch now
 *
 * ── AUTH MODEL ───────────────────────────────────────────────────────────────
 * Reading is DEVELOPER-level: a feed is the workspace's own published output and is
 * already public. PUBLISHING is MANAGER-gated, the same bar as `campaign.send` — the
 * difference between the two is that a post to a company page cannot be un-seen, and
 * "who may speak as the brand" is a management decision rather than a developer one.
 *
 * Connecting an account is NOT here: a social account is a connector connection, so
 * it is created, tested and edited through `/api/connectors` like every other one.
 * A second connect flow would mean a second credential store.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import {
  listSocialAccounts,
  listSocialNetworks,
  publishSocialPost,
  readSocialFeed,
  resolveSocialAccount,
  socialFeedQueryFrom,
} from '../../application/social/socialService';
import {
  createSocialCampaign,
  deleteSocialCampaign,
  getSocialCampaign,
  listSocialCampaigns,
  runSocialCampaignBatch,
  SocialCampaignError,
  updateSocialCampaign,
} from '../../application/social/socialCampaignService';

function campaignFailure(error: unknown): { message: string; status: 400 | 404 | 409 | 500 } {
  if (error instanceof SocialCampaignError) {
    const status = error.status === 404 ? 404 : error.status === 409 ? 409 : error.status === 500 ? 500 : 400;
    return { message: error.message, status };
  }
  return { message: error instanceof Error ? error.message : 'That campaign could not be processed.', status: 500 };
}

export function createSocialRoutes(db: Db): Hono<HonoEnv> {
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
    return c.json({ networks: await listSocialNetworks(db, env, tenantId) });
  });

  r.get('/accounts', async (c) => {
    const { env, tenantId } = ctx(c);
    return c.json({ accounts: await listSocialAccounts(db, env, tenantId) });
  });

  // GET /feed — merged and newest-first. Cached per account; see socialService.
  r.get('/feed', async (c) => {
    const { env, tenantId } = ctx(c);
    // Parsed by the application layer, so this route and the MCP tool cannot come to
    // disagree about what `networks=x,linkedin` means.
    const query = socialFeedQueryFrom({
      networks: c.req.query('networks') ?? null,
      accounts: c.req.query('accounts') ?? null,
      q: c.req.query('q') ?? null,
      limit: c.req.query('limit') ?? null,
    });
    return c.json(await readSocialFeed(db, env, tenantId, query));
  });

  // POST /publish — one post, one account. Manager-gated: it speaks as the brand.
  r.post('/publish', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const body = await c.req.json().catch(() => ({})) as {
      connectionId?: string; network?: string; text?: string; linkUrl?: string; mediaUrls?: string[];
    };
    const text = (body.text ?? '').trim();
    if (!text) return c.json({ error: 'A post needs some text.' }, 400);

    const resolved = await resolveSocialAccount(db, env, tenantId, {
      connectionId: body.connectionId ?? null,
      network: body.network ?? null,
    });
    if (!resolved.ok) return c.json({ error: resolved.error }, 409);

    const outcome = await publishSocialPost(db, env, tenantId, resolved.account, {
      text,
      ...(body.linkUrl ? { linkUrl: body.linkUrl } : {}),
      ...(Array.isArray(body.mediaUrls) && body.mediaUrls.length ? { mediaUrls: body.mediaUrls.map(String) } : {}),
    }, 'user');
    if (!outcome.ok) return c.json({ error: outcome.error, retryable: outcome.retryable }, 502);
    return c.json({
      published: true,
      account: outcome.account,
      externalId: outcome.result.externalId,
      permalink: outcome.result.permalink,
      pending: outcome.result.pending === true,
    });
  });

  // ── Campaigns ────────────────────────────────────────────────────────────

  r.get('/campaigns', async (c) => {
    const { env, tenantId } = ctx(c);
    const accounts = await listSocialAccounts(db, env, tenantId);
    const projectId = Number(c.req.query('projectId'));
    return c.json({
      campaigns: await listSocialCampaigns(db, tenantId, accounts, {
        ...(Number.isInteger(projectId) ? { projectId } : {}),
      }),
      accounts,
    });
  });

  r.get('/campaigns/:id', async (c) => {
    const { env, tenantId } = ctx(c);
    const accounts = await listSocialAccounts(db, env, tenantId);
    const campaign = await getSocialCampaign(db, tenantId, Number(c.req.param('id')), accounts);
    if (!campaign) return c.json({ error: 'Campaign not found' }, 404);
    return c.json({ campaign, accounts });
  });

  r.post('/campaigns', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    try {
      const created = await createSocialCampaign(db, env, tenantId, {
        name: String(body.name ?? ''),
        body: String(body.body ?? ''),
        ...(body.linkUrl != null ? { linkUrl: String(body.linkUrl) } : {}),
        ...(Array.isArray(body.mediaUrls) ? { mediaUrls: body.mediaUrls.map(String) } : {}),
        ...(body.variants && typeof body.variants === 'object' ? { variants: body.variants as Record<string, string> } : {}),
        ...(Array.isArray(body.connectionIds) ? { connectionIds: body.connectionIds.map(String) } : {}),
        ...(body.scheduledAt != null ? { scheduledAtISO: String(body.scheduledAt) } : {}),
        ...(body.projectId != null ? { projectId: Number(body.projectId) } : {}),
        ...(body.sessionId != null ? { sessionId: String(body.sessionId) } : {}),
      });
      return c.json(created, 201);
    } catch (error) {
      const failure = campaignFailure(error);
      return c.json({ error: failure.message }, failure.status);
    }
  });

  r.patch('/campaigns/:id', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    try {
      const accounts = await listSocialAccounts(db, env, tenantId);
      const campaign = await updateSocialCampaign(db, env, tenantId, Number(c.req.param('id')), {
        ...(body.name != null ? { name: String(body.name) } : {}),
        ...(body.body != null ? { body: String(body.body) } : {}),
        ...(body.linkUrl != null ? { linkUrl: String(body.linkUrl) } : {}),
        ...(Array.isArray(body.mediaUrls) ? { mediaUrls: body.mediaUrls.map(String) } : {}),
        ...(body.variants && typeof body.variants === 'object' ? { variants: body.variants as Record<string, string> } : {}),
        ...(body.scheduledAt !== undefined ? { scheduledAtISO: body.scheduledAt == null ? null : String(body.scheduledAt) } : {}),
      }, accounts);
      return c.json({ campaign });
    } catch (error) {
      const failure = campaignFailure(error);
      return c.json({ error: failure.message }, failure.status);
    }
  });

  r.delete('/campaigns/:id', manager, async (c) => {
    const { tenantId } = ctx(c);
    try {
      await deleteSocialCampaign(db, tenantId, Number(c.req.param('id')));
      return c.json({ deleted: true });
    } catch (error) {
      const failure = campaignFailure(error);
      return c.json({ error: failure.message }, failure.status);
    }
  });

  /**
   * POST /campaigns/:id/publish — publish a batch now.
   *
   * Returns after ONE batch. A campaign with more targets than a batch finishes on
   * the `social-publish` cron sweep, which runs the identical code path.
   */
  r.post('/campaigns/:id/publish', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    try {
      const result = await runSocialCampaignBatch(db, env, tenantId, Number(c.req.param('id')), 'user');
      const accounts = await listSocialAccounts(db, env, tenantId);
      return c.json({
        ...result,
        campaign: await getSocialCampaign(db, tenantId, result.campaignId, accounts),
      });
    } catch (error) {
      const failure = campaignFailure(error);
      return c.json({ error: failure.message }, failure.status);
    }
  });

  return r;
}
