/**
 * Social data → canvas object data. ONE mapping, used by every path.
 *
 * The agent's `canvas_add_social_feed`, the person's social panel and a tile refresh
 * all land on the same three functions here, so a feed the model puts on the board and
 * one a person puts there are the SAME object with the same fields. Written as pure
 * functions in a module rather than inline in the canvas so they can be tested and so
 * the two callers cannot drift.
 *
 * The projections are deliberately COMPACT. A canvas node's data is persisted with the
 * session AND fed to Brain's snapshot every turn, so full post payloads (media arrays,
 * every metric a network reports) would evict the actual conversation. What is kept is
 * what a tile renders and a model reasons about: who posted, what it said, when, and
 * how it did.
 */

import { DEFAULT_LOCALE } from '@/i18n/config';
import { formatterFor } from '@/i18n/format';

import {
  SOCIAL_NETWORKS,
  topPerformingPost,
  totalEngagement,
  type SocialCampaign,
  type SocialFeedItem,
  type SocialFeedRead,
  type SocialNetwork,
} from './socialApi';

export function isSocialNetworkName(value: unknown): value is SocialNetwork {
  return typeof value === 'string' && (SOCIAL_NETWORKS as readonly string[]).includes(value);
}

/**
 * The three social kinds a model must never author by hand, and the tool for each.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ───────────────────────────────────────────────
 * Every field on these kinds is READ from somewhere: a feed's posts and engagement come
 * from the networks, a pinned post is one item lifted out of a feed, and a campaign's
 * `campaignId`, `posts`, `publishedCount` and `failedCount` are the server's publish
 * ledger. So `canvas_add_object` cannot produce a real one, and the generic empty-shell
 * guard — which asks for "the authored content in fields" and lists whatever the kind
 * declares — asks for the wrong thing here.
 *
 * Measured 2026-08-15 (ui 2026.8.17): a `socialCampaign` add was refused with "send the
 * authored content in fields: content, campaignId, body, linkUrl, mediaUrls, variants,
 * targets, posts, publishedCount, failedCount, blockers". Four of those eleven are a
 * publish ledger; the only honest way to satisfy that refusal is to invent a campaign id
 * and a count of posts that were never published. The model did not try again, and the
 * turn ended with an empty board.
 *
 * `socialFeed` and `socialPost` fail more quietly and no less badly — they are in
 * SHELL_IS_LEGITIMATE (a person drags an empty feed out of the palette and connects it),
 * so an authored one is ACCEPTED and lands as a permanently blank tile.
 *
 * Same shape and same reasoning as `canvasImageToolRedirect`: name the tool that would
 * actually work, rather than describing a schema the request can never satisfy.
 */
const SOCIAL_AUTHORING_REDIRECT: Readonly<Record<string, string>> = {
  socialFeed: 'canvas_add_social_feed',
  socialPost: 'canvas_pin_social_post',
  socialCampaign: 'canvas_create_social_campaign',
};

/** Why an authored patch for this kind must go through a social tool, or null when the
 *  kind is not one of the connected-account kinds. */
export function canvasSocialToolRedirect(kind: string): string | null {
  const tool = SOCIAL_AUTHORING_REDIRECT[kind];
  if (!tool) return null;
  const what = kind === 'socialCampaign'
    ? 'A socialCampaign is bound to a real campaign on the server — its campaign id, its per-account posts and its published/failed counts are a publish ledger, not text anyone can write.'
    : 'A socialFeed and a socialPost hold what the connected accounts actually published — real posts, real engagement — which cannot be authored without inventing them.';
  return `${what} Call ${tool} instead: it reads the workspace's connected X, LinkedIn, Facebook, Instagram and TikTok accounts and puts the real object on the board. If no account is connected yet, ${tool} says so and names where to connect one — relay that rather than authoring a placeholder. Never create a "${kind}" with canvas_add_object.`;
}

/** The compact per-post shape stored on a tile and returned to the model. */
export interface SocialPostProjection {
  id: string;
  network: SocialNetwork;
  accountName: string;
  authorName: string;
  text: string;
  permalink: string | null;
  publishedAtISO: string | null;
  thumbnailUrl: string | null;
  metrics: { likes: number; comments: number; shares: number; views: number };
}

/** Post text kept per post. Long enough to judge the message, short enough that
 *  twenty-five of them do not dominate a model's context window. */
const POST_EXCERPT_LIMIT = 400;

export function socialPostProjection(post: SocialFeedItem): SocialPostProjection {
  return {
    id: post.id,
    network: post.network,
    accountName: post.accountName,
    authorName: post.authorName,
    text: post.text.slice(0, POST_EXCERPT_LIMIT),
    permalink: post.permalink,
    publishedAtISO: post.publishedAtISO,
    thumbnailUrl: post.thumbnailUrl,
    metrics: post.metrics,
  };
}

/** The fields a feed tile carries after a read — the same patch a refresh applies. */
export function socialFeedPatch(read: SocialFeedRead): Record<string, unknown> {
  const top = topPerformingPost(read.items);
  return {
    posts: read.items.map(socialPostProjection),
    accounts: read.accounts.map((account) => `${account.networkLabel} · ${account.name}`),
    networks: [...new Set(read.items.map((item) => item.network))],
    engagement: totalEngagement(read.items),
    ...(top ? { topPost: socialPostProjection(top) } : {}),
    postCount: read.items.length,
    fetchedAt: read.fetchedAtISO,
  };
}

/** A pinned post's object data. Unlike the feed tile this keeps the FULL text —
 *  that is the reason to pin one. */
/**
 * Pinned to the default locale, NOT the reader's.
 *
 * Everything below writes PERSISTED canvas object data — English prose a tool
 * result and the next turn both read. A number that groups one way for a German
 * reader and another for an English one would make the stored value depend on
 * who happened to be looking at the board when it was computed.
 */
const fmt = formatterFor(DEFAULT_LOCALE);

export function socialPostNodeData(post: SocialFeedItem): Record<string, unknown> {
  return {
    title: post.text.trim().split('\n')[0]?.slice(0, 80) || `${post.network} post`,
    subtitle: post.authorName,
    status: post.publishedAtISO ? fmt.date(post.publishedAtISO) : 'Published',
    postId: post.id,
    connectionId: post.connectionId,
    network: post.network,
    accountName: post.accountName,
    authorName: post.authorName,
    text: post.text,
    permalink: post.permalink,
    publishedAt: post.publishedAtISO,
    metrics: post.metrics,
    mediaUrls: post.mediaUrls,
    thumbnailUrl: post.thumbnailUrl,
  };
}

/**
 * A campaign tile's object data.
 *
 * `status` is the campaign's own status rather than a rendered sentence, because the
 * tile header shows it and a stale English string on a saved board would be wrong in
 * every other language. Per-account outcomes travel in `posts` so the tile can say
 * WHICH accounts published, not just how many.
 */
export function socialCampaignNodeData(campaign: SocialCampaign): Record<string, unknown> {
  return {
    title: campaign.name,
    status: campaign.status,
    campaignId: campaign.id,
    body: campaign.body,
    linkUrl: campaign.linkUrl,
    mediaUrls: campaign.mediaUrls,
    variants: campaign.variants,
    targets: campaign.targets,
    publishedCount: campaign.published,
    failedCount: campaign.failed,
    scheduledAt: campaign.scheduledAtISO,
    blockers: campaign.blockers,
    posts: campaign.posts.map((post) => ({
      id: post.id,
      network: post.network,
      accountName: post.accountName,
      status: post.status,
      permalink: post.permalink,
      error: post.error,
    })),
  };
}
