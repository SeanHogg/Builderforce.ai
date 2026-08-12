/**
 * Social campaigns — one announcement, published to every connected account.
 *
 * This is the "post it everywhere" half of a CMO's canvas. It borrows the two
 * invariants that make the email engine safe and applies them to public feeds, where
 * a mistake is arguably worse because it cannot be un-seen:
 *
 *   1. IDEMPOTENT BY CONSTRUCTION. One row per (campaign, account), unique in the
 *      database. A resumed run, a retried batch or a double-clicked button cannot
 *      publish the same campaign to the same Page twice.
 *   2. RETRYABLE IS LOAD-BEARING. A 429 or a provider 5xx returns that ONE post to
 *      `queued`, bounded by {@link SOCIAL_PUBLISH_MAX_ATTEMPTS}. A rejected token or
 *      a malformed post fails terminally — retrying it would loop forever and the
 *      campaign would never complete. This is the same rule `campaignTransports`
 *      draws for email, and it is why {@link SocialProviderError} carries the flag.
 *
 * A network that refuses text-only posts (Instagram, TikTok) is SKIPPED rather than
 * failed when the campaign carries no media, and says so in the blocker list before
 * anything is published — a campaign that "failed on Instagram" every time because a
 * text announcement can never be an Instagram post is a false alarm, not a defect.
 */

import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { socialCampaignPosts, socialCampaigns } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { signalPendingWork } from '../runtime/cronWorkSignal';
import {
  isSocialNetwork,
  type SocialNetwork,
  type SocialPostDraft,
} from './socialProviders';
import {
  publishSocialPost,
  resolvePublishableAccounts,
  type ResolvedAccount,
  type SocialAccountView,
} from './socialService';

/** Attempts one post may take before it is written off. See the header note. */
export const SOCIAL_PUBLISH_MAX_ATTEMPTS = 3;

/** How many accounts one invocation publishes to. A Worker invocation is bounded and
 *  each post is an outbound call, so a large campaign finishes on the cron sweep. */
export const SOCIAL_PUBLISH_BATCH_SIZE = 8;

export type SocialCampaignStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';
export type SocialPostStatus = 'queued' | 'published' | 'pending' | 'failed' | 'skipped';

export interface SocialCampaignPostView {
  id: number;
  connectionId: string;
  network: SocialNetwork;
  accountName: string;
  body: string;
  status: SocialPostStatus;
  externalId: string | null;
  permalink: string | null;
  error: string | null;
  attempts: number;
  publishedAtISO: string | null;
}

/** A reason a campaign cannot fully publish. Rendered by the client, in its language. */
export interface SocialCampaignBlocker {
  code: 'noCopy' | 'noAccounts' | 'needsMedia' | 'accountNotReady' | 'accountMissing';
  network?: string;
  account?: string;
  fields?: string;
}

export interface SocialCampaignView {
  id: number;
  name: string;
  body: string;
  linkUrl: string;
  mediaUrls: string[];
  variants: Record<string, string>;
  status: SocialCampaignStatus;
  scheduledAtISO: string | null;
  startedAtISO: string | null;
  completedAtISO: string | null;
  targets: number;
  published: number;
  failed: number;
  projectId: number | null;
  sessionId: string | null;
  updatedAtISO: string;
  posts: SocialCampaignPostView[];
  /** Why this campaign cannot fully publish yet. Codes, not sentences — see {@link blockersFor}. */
  blockers: SocialCampaignBlocker[];
}

export class SocialCampaignError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'SocialCampaignError';
  }
}

// ---------------------------------------------------------------------------
// Copy resolution
// ---------------------------------------------------------------------------

/**
 * The copy one network actually gets.
 *
 * Per-network variants exist because the same announcement is 280 characters on X and
 * a paragraph on LinkedIn. An absent variant falls back to the shared body, so a
 * campaign that does not care never has to fill in five boxes.
 */
export function resolveVariant(
  campaign: { body: string; variants: Record<string, string> },
  network: SocialNetwork,
): string {
  const variant = campaign.variants?.[network];
  return (typeof variant === 'string' && variant.trim() ? variant : campaign.body).trim();
}

function draftFor(
  campaign: { body: string; linkUrl: string; mediaUrls: string[]; variants: Record<string, string> },
  network: SocialNetwork,
): SocialPostDraft {
  return {
    text: resolveVariant(campaign, network),
    ...(campaign.linkUrl ? { linkUrl: campaign.linkUrl } : {}),
    ...(campaign.mediaUrls.length ? { mediaUrls: campaign.mediaUrls } : {}),
  };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

type CampaignRow = typeof socialCampaigns.$inferSelect;
type PostRow = typeof socialCampaignPosts.$inferSelect;

/**
 * Why a campaign cannot fully publish, as CODES rather than sentences.
 *
 * The canvas tile renders these, and a tile is rendered in five languages — a
 * server-composed English sentence would be untranslatable the moment it left here.
 * The code plus its parameters is what the UI localizes and what a model reads.
 */
function blockersFor(campaign: CampaignRow, posts: PostRow[], accounts: readonly SocialAccountView[]): SocialCampaignBlocker[] {
  const blockers: SocialCampaignBlocker[] = [];
  if (!campaign.body.trim() && Object.keys(campaign.variants ?? {}).length === 0) blockers.push({ code: 'noCopy' });
  if (posts.length === 0) blockers.push({ code: 'noAccounts' });

  for (const post of posts) {
    const account = accounts.find((a) => a.id === post.connectionId);
    if (!account) {
      blockers.push({ code: 'accountMissing', network: post.network });
      continue;
    }
    if (!account.ready) {
      blockers.push({
        code: 'accountNotReady',
        network: post.network,
        account: `${account.networkLabel} · ${account.name}`,
        fields: account.missingFields.map((f) => f.label).join(', '),
      });
      continue;
    }
    if (account.requiresMedia && (campaign.mediaUrls ?? []).length === 0) {
      blockers.push({ code: 'needsMedia', network: post.network, account: `${account.networkLabel} · ${account.name}` });
    }
  }
  return blockers;
}

function toView(campaign: CampaignRow, posts: PostRow[], accounts: readonly SocialAccountView[]): SocialCampaignView {
  return {
    id: campaign.id,
    name: campaign.name,
    body: campaign.body,
    linkUrl: campaign.linkUrl,
    mediaUrls: campaign.mediaUrls ?? [],
    variants: campaign.variants ?? {},
    status: campaign.status as SocialCampaignStatus,
    scheduledAtISO: campaign.scheduledAt ? campaign.scheduledAt.toISOString() : null,
    startedAtISO: campaign.startedAt ? campaign.startedAt.toISOString() : null,
    completedAtISO: campaign.completedAt ? campaign.completedAt.toISOString() : null,
    targets: campaign.targets,
    published: campaign.published,
    failed: campaign.failed,
    projectId: campaign.projectId,
    sessionId: campaign.sessionId,
    updatedAtISO: campaign.updatedAt.toISOString(),
    posts: posts.map((post) => ({
      id: post.id,
      connectionId: post.connectionId,
      network: post.network as SocialNetwork,
      accountName: accounts.find((a) => a.id === post.connectionId)?.name ?? post.network,
      body: post.body,
      status: post.status as SocialPostStatus,
      externalId: post.externalId,
      permalink: post.permalink,
      error: post.error,
      attempts: post.attempts,
      publishedAtISO: post.publishedAt ? post.publishedAt.toISOString() : null,
    })),
    blockers: blockersFor(campaign, posts, accounts),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Load campaigns with their posts in TWO queries, never one per campaign.
 *
 * Takes the EXTRA predicate, not a finished `where`: tenancy is composed here, at
 * the query, so both the reader and `check:tenant-scope` can see that this select
 * is scoped. Handing it a pre-built predicate made the caller responsible for the
 * one condition that must never be forgotten, and hid it from the guard.
 */
async function loadCampaigns(
  db: Db, tenantId: number, extra: SQL | undefined, limit: number,
): Promise<Array<{ campaign: CampaignRow; posts: PostRow[] }>> {
  const campaigns = await db
    .select().from(socialCampaigns)
    .where(scopedToTenant(socialCampaigns, tenantId, extra))
    .orderBy(desc(socialCampaigns.updatedAt)).limit(limit);
  if (campaigns.length === 0) return [];
  const posts = await db
    .select().from(socialCampaignPosts)
    .where(scopedToTenant(socialCampaignPosts, tenantId, inArray(socialCampaignPosts.campaignId, campaigns.map((c) => c.id))))
    .orderBy(asc(socialCampaignPosts.id));
  return campaigns.map((campaign) => ({
    campaign,
    posts: posts.filter((p) => p.campaignId === campaign.id),
  }));
}

export async function listSocialCampaigns(
  db: Db, tenantId: number, accounts: readonly SocialAccountView[], opts: { projectId?: number; limit?: number } = {},
): Promise<SocialCampaignView[]> {
  const rows = await loadCampaigns(
    db, tenantId,
    opts.projectId != null ? eq(socialCampaigns.projectId, opts.projectId) : undefined,
    Math.min(Math.max(opts.limit ?? 50, 1), 100),
  );
  return rows.map(({ campaign, posts }) => toView(campaign, posts, accounts));
}

export async function getSocialCampaign(
  db: Db, tenantId: number, id: number, accounts: readonly SocialAccountView[],
): Promise<SocialCampaignView | null> {
  const rows = await loadCampaigns(db, tenantId, eq(socialCampaigns.id, id), 1);
  const first = rows[0];
  return first ? toView(first.campaign, first.posts, accounts) : null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface SocialCampaignInput {
  name: string;
  body: string;
  linkUrl?: string;
  mediaUrls?: string[];
  variants?: Record<string, string>;
  /** Accounts to publish to. Empty means EVERY ready account — "post it everywhere"
   *  is the common request and making the caller enumerate would be busywork. */
  connectionIds?: string[];
  scheduledAtISO?: string | null;
  projectId?: number | null;
  sessionId?: string | null;
}

function cleanVariants(raw: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (isSocialNetwork(key) && typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}

function cleanUrls(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : [])
    .map((v) => String(v ?? '').trim())
    // A network PULLS media from this URL with no session of its own, so anything
    // that is not a public https URL is a post that will fail at the provider.
    .filter((v) => /^https:\/\//i.test(v))
    .slice(0, 10);
}

/**
 * Draft a campaign and materialize one queued post per target account.
 *
 * Targets are resolved to READY accounts here rather than at publish time, so the
 * draft can be reviewed with an honest target count instead of discovering at send
 * that two of the five accounts were never usable.
 */
export async function createSocialCampaign(
  db: Db, env: Env, tenantId: number, input: SocialCampaignInput,
): Promise<{ campaign: SocialCampaignView; accounts: SocialAccountView[] }> {
  const name = input.name?.trim();
  if (!name) throw new SocialCampaignError('A campaign needs a name.');

  const ready = await resolvePublishableAccounts(db, env, tenantId, input.connectionIds ?? []);
  const targets = input.connectionIds?.length
    ? ready.filter((a) => input.connectionIds!.includes(a.row.id))
    : ready;
  if (targets.length === 0) {
    throw new SocialCampaignError(
      'No connected social account is ready to publish. Connect an account first, or fill in its missing account id.',
      409,
    );
  }

  const mediaUrls = cleanUrls(input.mediaUrls);
  const variants = cleanVariants(input.variants);
  const body = (input.body ?? '').trim();
  const scheduledAt = input.scheduledAtISO ? new Date(input.scheduledAtISO) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) throw new SocialCampaignError('That schedule time is not a valid date.');

  const [campaign] = await db.insert(socialCampaigns).values({
    tenantId,
    name: name.slice(0, 255),
    body,
    linkUrl: (input.linkUrl ?? '').trim().slice(0, 1000),
    mediaUrls,
    variants,
    status: scheduledAt ? 'scheduled' : 'draft',
    ...(scheduledAt ? { scheduledAt } : {}),
    targets: targets.length,
    ...(input.projectId != null ? { projectId: input.projectId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  }).returning();
  if (!campaign) throw new SocialCampaignError('The campaign could not be created.', 500);

  await db.insert(socialCampaignPosts).values(targets.map((account) => ({
    campaignId: campaign.id,
    tenantId,
    connectionId: account.row.id,
    network: account.provider.network,
    body: resolveVariant({ body, variants }, account.provider.network),
    status: 'queued' as const,
  })));

  // The frequent cron is KV-gated so an idle platform never wakes Postgres; a
  // scheduled campaign is exactly the work that gate must be told about, or it would
  // sit until the floor sweep and publish late.
  if (scheduledAt) await signalPendingWork(env);

  const view = await getSocialCampaign(db, tenantId, campaign.id, targets.map((a) => a.view));
  if (!view) throw new SocialCampaignError('The campaign could not be read back.', 500);
  return { campaign: view, accounts: targets.map((a) => a.view) };
}

/** Edit a draft. Published campaigns are HISTORY and are not rewritten. */
export async function updateSocialCampaign(
  db: Db, env: Env, tenantId: number, id: number,
  patch: Partial<Pick<SocialCampaignInput, 'name' | 'body' | 'linkUrl' | 'mediaUrls' | 'variants' | 'scheduledAtISO'>>,
  accounts: readonly SocialAccountView[],
): Promise<SocialCampaignView> {
  const [existing] = await db.select().from(socialCampaigns)
    .where(scopedToTenant(socialCampaigns, tenantId, eq(socialCampaigns.id, id))).limit(1);
  if (!existing) throw new SocialCampaignError('Campaign not found', 404);
  if (existing.status === 'publishing') throw new SocialCampaignError('This campaign is publishing right now — wait for it to finish.', 409);
  if (existing.status === 'published') throw new SocialCampaignError('A published campaign cannot be edited; it is what the world already saw.', 409);

  const next: Partial<typeof socialCampaigns.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) next.name = patch.name.trim().slice(0, 255);
  if (patch.body !== undefined) next.body = patch.body.trim();
  if (patch.linkUrl !== undefined) next.linkUrl = patch.linkUrl.trim().slice(0, 1000);
  if (patch.mediaUrls !== undefined) next.mediaUrls = cleanUrls(patch.mediaUrls);
  if (patch.variants !== undefined) next.variants = cleanVariants(patch.variants);
  if (patch.scheduledAtISO !== undefined) {
    const when = patch.scheduledAtISO ? new Date(patch.scheduledAtISO) : null;
    if (when && Number.isNaN(when.getTime())) throw new SocialCampaignError('That schedule time is not a valid date.');
    next.scheduledAt = when;
    next.status = when ? 'scheduled' : 'draft';
  }

  const [updated] = await db.update(socialCampaigns).set(next)
    .where(scopedToTenant(socialCampaigns, tenantId, eq(socialCampaigns.id, id))).returning();
  if (!updated) throw new SocialCampaignError('The campaign could not be updated.', 500);
  if (updated.status === 'scheduled') await signalPendingWork(env);

  // Queued posts carry the copy they will publish, so an edited body has to reach
  // them — otherwise the review screen and the post that goes out disagree.
  const body = updated.body;
  const variants = updated.variants ?? {};
  const queued = await db.select().from(socialCampaignPosts)
    .where(scopedToTenant(socialCampaignPosts, tenantId, and(eq(socialCampaignPosts.campaignId, id), eq(socialCampaignPosts.status, 'queued'))));
  for (const post of queued) {
    const resolved = resolveVariant({ body, variants }, post.network as SocialNetwork);
    if (resolved !== post.body) {
      await db.update(socialCampaignPosts).set({ body: resolved })
        .where(scopedToTenant(socialCampaignPosts, tenantId, eq(socialCampaignPosts.id, post.id)));
    }
  }

  const view = await getSocialCampaign(db, tenantId, id, accounts);
  if (!view) throw new SocialCampaignError('The campaign could not be read back.', 500);
  return view;
}

export async function deleteSocialCampaign(db: Db, tenantId: number, id: number): Promise<void> {
  const rows = await db.delete(socialCampaigns)
    .where(scopedToTenant(socialCampaigns, tenantId, eq(socialCampaigns.id, id)))
    .returning({ id: socialCampaigns.id });
  if (rows.length === 0) throw new SocialCampaignError('Campaign not found', 404);
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export interface SocialPublishBatchResult {
  campaignId: number;
  published: number;
  failed: number;
  skipped: number;
  /** Posts still queued after this batch — a large campaign finishes on the sweep. */
  remaining: number;
  status: SocialCampaignStatus;
  results: Array<{ network: SocialNetwork; accountName: string; ok: boolean; permalink: string | null; error: string | null }>;
}

/**
 * Publish one batch of a campaign's queued posts.
 *
 * Called by the "publish now" route and by the cron sweep for scheduled and partially
 * published runs. The two paths are the same code on purpose: a campaign that starts
 * in a request and finishes on a sweep must behave identically in both.
 */
export async function runSocialCampaignBatch(
  db: Db, env: Env, tenantId: number, campaignId: number, actorKind: 'agent' | 'user' = 'user',
): Promise<SocialPublishBatchResult> {
  const [campaign] = await db.select().from(socialCampaigns)
    .where(scopedToTenant(socialCampaigns, tenantId, eq(socialCampaigns.id, campaignId))).limit(1);
  if (!campaign) throw new SocialCampaignError('Campaign not found', 404);
  if (campaign.status === 'published') {
    return { campaignId, published: 0, failed: 0, skipped: 0, remaining: 0, status: 'published', results: [] };
  }

  if (campaign.status !== 'publishing') {
    await db.update(socialCampaigns)
      .set({ status: 'publishing', startedAt: campaign.startedAt ?? new Date(), updatedAt: new Date() })
      .where(scopedToTenant(socialCampaigns, tenantId, eq(socialCampaigns.id, campaignId)));
  }

  const queued = await db.select().from(socialCampaignPosts)
    .where(scopedToTenant(socialCampaignPosts, tenantId, and(
      eq(socialCampaignPosts.campaignId, campaignId),
      eq(socialCampaignPosts.status, 'queued'),
    )))
    .orderBy(asc(socialCampaignPosts.id))
    .limit(SOCIAL_PUBLISH_BATCH_SIZE);

  const accounts = await resolvePublishableAccounts(db, env, tenantId, queued.map((p) => p.connectionId));
  const byId = new Map<string, ResolvedAccount>(accounts.map((a) => [a.row.id, a]));

  let published = 0;
  let failed = 0;
  let skipped = 0;
  const results: SocialPublishBatchResult['results'] = [];

  for (const post of queued) {
    const account = byId.get(post.connectionId);
    const network = post.network as SocialNetwork;

    if (!account) {
      await markPost(db, tenantId, post.id, {
        status: 'failed',
        error: 'That account is no longer connected, or is missing a required account id.',
      });
      failed += 1;
      results.push({ network, accountName: post.network, ok: false, permalink: null, error: 'Account not connected.' });
      continue;
    }

    // Not a failure: a text announcement can NEVER be an Instagram post, so calling
    // it failed would raise the same false alarm on every campaign.
    if (account.provider.requiresMedia && (campaign.mediaUrls ?? []).length === 0) {
      await markPost(db, tenantId, post.id, {
        status: 'skipped',
        error: `${account.provider.label} needs an image or video — this campaign has no media.`,
      });
      skipped += 1;
      results.push({ network, accountName: account.row.name, ok: false, permalink: null, error: 'Needs media.' });
      continue;
    }

    const attempts = post.attempts + 1;
    const outcome = await publishSocialPost(db, env, tenantId, account, draftFor({
      body: campaign.body,
      linkUrl: campaign.linkUrl,
      mediaUrls: campaign.mediaUrls ?? [],
      variants: campaign.variants ?? {},
    }, network), actorKind);

    if (outcome.ok) {
      await markPost(db, tenantId, post.id, {
        // A network that has accepted but not finished processing (TikTok transcodes)
        // is `pending`, not `published` — claiming otherwise is an overclaim the
        // campaign counters would then carry forever.
        status: outcome.result.pending ? 'pending' : 'published',
        attempts,
        externalId: outcome.result.externalId || null,
        permalink: outcome.result.permalink,
        publishedAt: new Date(),
        error: null,
      });
      published += 1;
      results.push({ network, accountName: account.row.name, ok: true, permalink: outcome.result.permalink, error: null });
      continue;
    }

    const exhausted = attempts >= SOCIAL_PUBLISH_MAX_ATTEMPTS;
    const requeue = outcome.retryable && !exhausted;
    await markPost(db, tenantId, post.id, {
      status: requeue ? 'queued' : 'failed',
      attempts,
      error: outcome.error.slice(0, 1000),
    });
    if (!requeue) failed += 1;
    results.push({ network, accountName: account.row.name, ok: false, permalink: null, error: outcome.error });
  }

  const [{ remaining = 0 } = { remaining: 0 }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(socialCampaignPosts)
    .where(scopedToTenant(socialCampaignPosts, tenantId, and(
      eq(socialCampaignPosts.campaignId, campaignId),
      eq(socialCampaignPosts.status, 'queued'),
    )));

  const totals = await db
    .select({ status: socialCampaignPosts.status, count: sql<number>`count(*)::int` })
    .from(socialCampaignPosts)
    .where(scopedToTenant(socialCampaignPosts, tenantId, eq(socialCampaignPosts.campaignId, campaignId)))
    .groupBy(socialCampaignPosts.status);
  const totalBy = (status: SocialPostStatus) => totals.find((t) => t.status === status)?.count ?? 0;
  const publishedTotal = totalBy('published') + totalBy('pending');
  const failedTotal = totalBy('failed');

  const status: SocialCampaignStatus = remaining > 0
    ? 'publishing'
    : publishedTotal > 0 ? 'published' : 'failed';

  await db.update(socialCampaigns).set({
    status,
    published: publishedTotal,
    failed: failedTotal,
    updatedAt: new Date(),
    ...(remaining === 0 ? { completedAt: new Date() } : {}),
  }).where(scopedToTenant(socialCampaigns, tenantId, eq(socialCampaigns.id, campaignId)));

  // Anything left queued only finishes if the gated cron actually runs.
  if (remaining > 0) await signalPendingWork(env);

  return { campaignId, published, failed, skipped, remaining, status, results };
}

async function markPost(
  db: Db, tenantId: number, id: number,
  patch: Partial<typeof socialCampaignPosts.$inferInsert>,
): Promise<void> {
  await db.update(socialCampaignPosts).set(patch)
    .where(scopedToTenant(socialCampaignPosts, tenantId, eq(socialCampaignPosts.id, id)));
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

/** Campaigns the sweep should advance: mid-publish, or scheduled and now due. */
export async function socialCampaignsDue(db: Db, limit = 5): Promise<Array<{ id: number; tenantId: number }>> {
  return db
    .select({ id: socialCampaigns.id, tenantId: socialCampaigns.tenantId })
    .from(socialCampaigns)
    .where(sql`(${socialCampaigns.status} = 'publishing')
      OR (${socialCampaigns.status} = 'scheduled' AND ${socialCampaigns.scheduledAt} IS NOT NULL AND ${socialCampaigns.scheduledAt} <= NOW())`)
    .orderBy(asc(socialCampaigns.scheduledAt), asc(socialCampaigns.id))
    .limit(limit);
}

/**
 * Advance every due social campaign by one batch.
 *
 * Without this, a `scheduled` campaign would sit forever and a campaign larger than
 * one batch would stop halfway — the same reason the email engine has a sweep.
 */
export async function runSocialCampaignSweep(
  env: Env, db: Db, opts: { maxCampaigns?: number } = {},
): Promise<{ campaigns: number; published: number; failed: number }> {
  const due = await socialCampaignsDue(db, opts.maxCampaigns ?? 5);
  let published = 0;
  let failed = 0;
  for (const campaign of due) {
    try {
      const batch = await runSocialCampaignBatch(db, env, campaign.tenantId, campaign.id, 'agent');
      published += batch.published;
      failed += batch.failed;
    } catch (error) {
      // One tenant's broken campaign must not stop the tick for everyone else.
      reportCaughtError(error, {
        source: 'application/social/socialCampaignService.ts',
        operation: 'runSocialCampaignSweep',
        context: { campaignId: campaign.id },
      });
    }
  }
  return { campaigns: due.length, published, failed };
}
