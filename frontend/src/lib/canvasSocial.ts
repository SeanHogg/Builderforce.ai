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
export function socialPostNodeData(post: SocialFeedItem): Record<string, unknown> {
  return {
    title: post.text.trim().split('\n')[0]?.slice(0, 80) || `${post.network} post`,
    subtitle: post.authorName,
    status: post.publishedAtISO ? new Date(post.publishedAtISO).toLocaleDateString() : 'Published',
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
