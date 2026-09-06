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
 *
 * ── ERRORS ───────────────────────────────────────────────────────────────────
 * `SocialCampaignError` carries the status the service decided on (400 / 404 / 409,
 * 500 for an invariant failure); the global handler renders it through `statusOf`,
 * so no campaign handler catches anything.
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
  updateSocialCampaign,
} from '../../application/social/socialCampaignService';
import { parseBody, z, zNonEmptyString, zOptionalString, zPositiveInt } from './requestBody';

const PublishBody = z.object({
  connectionId: zOptionalString,
  network: zOptionalString,
  text: zNonEmptyString,
  linkUrl: zOptionalString,
  mediaUrls: z.array(z.string()).optional(),
});

const CreateCampaignBody = z.object({
  name: zNonEmptyString,
  body: z.string().default(''),
  linkUrl: z.string().optional(),
  mediaUrls: z.array(z.string()).optional(),
  variants: z.record(z.string(), z.string()).optional(),
  connectionIds: z.array(z.string()).optional(),
  scheduledAt: z.string().nullable().optional(),
  projectId: zPositiveInt.nullable().optional(),
  sessionId: z.string().nullable().optional(),
});

const UpdateCampaignBody = z.object({
  name: z.string().optional(),
  body: z.string().optional(),
  linkUrl: z.string().optional(),
  mediaUrls: z.array(z.string()).optional(),
  variants: z.record(z.string(), z.string()).optional(),
  /** `null` clears the schedule; absent leaves it alone. */
  scheduledAt: z.string().nullable().optional(),
});

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
    const body = await parseBody(c, PublishBody);

    const resolved = await resolveSocialAccount(db, env, tenantId, {
      connectionId: body.connectionId ?? null,
      network: body.network ?? null,
    });
    if (!resolved.ok) return c.json({ error: resolved.error }, 409);

    const outcome = await publishSocialPost(db, env, tenantId, resolved.account, {
      text: body.text,
      ...(body.linkUrl ? { linkUrl: body.linkUrl } : {}),
      ...(body.mediaUrls?.length ? { mediaUrls: body.mediaUrls } : {}),
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
    const body = await parseBody(c, CreateCampaignBody);
    const created = await createSocialCampaign(db, env, tenantId, {
      name: body.name,
      body: body.body,
      ...(body.linkUrl != null ? { linkUrl: body.linkUrl } : {}),
      ...(body.mediaUrls ? { mediaUrls: body.mediaUrls } : {}),
      ...(body.variants ? { variants: body.variants } : {}),
      ...(body.connectionIds ? { connectionIds: body.connectionIds } : {}),
      ...(body.scheduledAt != null ? { scheduledAtISO: body.scheduledAt } : {}),
      ...(body.projectId != null ? { projectId: body.projectId } : {}),
      ...(body.sessionId != null ? { sessionId: body.sessionId } : {}),
    });
    return c.json(created, 201);
  });

  r.patch('/campaigns/:id', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const body = await parseBody(c, UpdateCampaignBody);
    const accounts = await listSocialAccounts(db, env, tenantId);
    const campaign = await updateSocialCampaign(db, env, tenantId, Number(c.req.param('id')), {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.body !== undefined ? { body: body.body } : {}),
      ...(body.linkUrl !== undefined ? { linkUrl: body.linkUrl } : {}),
      ...(body.mediaUrls !== undefined ? { mediaUrls: body.mediaUrls } : {}),
      ...(body.variants !== undefined ? { variants: body.variants } : {}),
      ...(body.scheduledAt !== undefined ? { scheduledAtISO: body.scheduledAt } : {}),
    }, accounts);
    return c.json({ campaign });
  });

  r.delete('/campaigns/:id', manager, async (c) => {
    const { tenantId } = ctx(c);
    await deleteSocialCampaign(db, tenantId, Number(c.req.param('id')));
    return c.json({ deleted: true });
  });

  /**
   * POST /campaigns/:id/publish — publish a batch now.
   *
   * Returns after ONE batch. A campaign with more targets than a batch finishes on
   * the `social-publish` cron sweep, which runs the identical code path.
   */
  r.post('/campaigns/:id/publish', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const result = await runSocialCampaignBatch(db, env, tenantId, Number(c.req.param('id')), 'user');
    const accounts = await listSocialAccounts(db, env, tenantId);
    return c.json({
      ...result,
      campaign: await getSocialCampaign(db, tenantId, result.campaignId, accounts),
    });
  });

  return r;
}
