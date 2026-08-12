/**
 * X, LinkedIn, Facebook, Instagram and TikTok behind ONE social port.
 *
 * The canvas asks three questions of a connected social account — "who is this",
 * "what has it published lately", and "publish this" — and the five networks
 * answer them in five different shapes: X returns `data[]` with `public_metrics`,
 * Facebook returns `data[]` with summary edges, Instagram needs a container then a
 * publish call, TikTok answers a POST with a `data.videos` envelope carrying its own
 * `error.code`, and LinkedIn hides the created post's id in a RESPONSE HEADER.
 * Normalizing here is what lets the feed tile, the campaign engine, the MCP tools and
 * the panel be written once — exactly as {@link ../mailbox/mailboxProviders} does for
 * mail and {@link ../drive/driveProviders} for files.
 *
 * ── CREDENTIALS ARE NOT STORED HERE ──────────────────────────────────────────
 * A social account is a CONNECTOR CONNECTION (`connector_connections`), not a third
 * credential store. The five built-in manifests in `connectors/defaults/social.ts`
 * already declare the auth fields, the endpoints and the SSRF-guarded runtime; this
 * port only decides which action to call and what the answer means. That is why
 * connecting an account and testing it need no code here at all, and why a sixth
 * network is a manifest plus an adapter rather than a new subsystem.
 *
 * ── ACCOUNT-SCOPE FIELDS ─────────────────────────────────────────────────────
 * Three networks cannot act without an id the token alone does not imply: which Page,
 * which Instagram professional account, which LinkedIn author. Those are non-secret
 * fields on the SAME connection ({@link SocialProvider.accountFields}), so a connection
 * that cannot post says so before anything is attempted rather than 400ing at the API.
 */

/** The networks this deployment can read and publish to. */
export const SOCIAL_NETWORKS = ['x', 'linkedin', 'facebook', 'instagram', 'tiktok'] as const;
export type SocialNetwork = typeof SOCIAL_NETWORKS[number];

export function isSocialNetwork(value: unknown): value is SocialNetwork {
  return typeof value === 'string' && (SOCIAL_NETWORKS as readonly string[]).includes(value);
}

/** Engagement, normalized. A network that does not report a number reports 0 —
 *  never a guess, and never a missing key the UI has to defend against. */
export interface SocialMetrics {
  likes: number;
  comments: number;
  shares: number;
  views: number;
}

/** One published item, from any network. */
export interface SocialFeedItem {
  id: string;
  network: SocialNetwork;
  /** The connection this came from, so a merged feed can still say where. */
  connectionId: string;
  accountName: string;
  authorName: string;
  text: string;
  permalink: string | null;
  publishedAtISO: string | null;
  mediaUrls: string[];
  thumbnailUrl: string | null;
  metrics: SocialMetrics;
}

/** What a publish attempt carries. Deliberately network-neutral: per-network
 *  wording is chosen by the CALLER (a campaign variant), not invented here. */
export interface SocialPostDraft {
  text: string;
  linkUrl?: string;
  /** Public https URLs. Instagram and TikTok pull the media themselves, so a
   *  signed or session-scoped URL is a failed post. */
  mediaUrls?: string[];
}

export interface SocialPublishResult {
  /** Provider id of the created post. Empty when the network does not return one. */
  externalId: string;
  permalink: string | null;
  /** True when the network accepted the post but has not finished processing it
   *  (TikTok transcodes asynchronously), so "published" would be an overclaim. */
  pending?: boolean;
}

export interface SocialIdentity {
  externalId: string;
  handle: string;
  displayName: string;
}

export interface SocialCallResult {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
  /** Only the headers the caller explicitly asked for. */
  headers?: Record<string, string>;
}

/** How an adapter reaches its network: one connector action, already credentialed,
 *  SSRF-guarded and audit-logged by the connector runtime. */
export type SocialCall = (
  actionKey: string,
  input?: Record<string, unknown>,
  opts?: { captureHeaders?: readonly string[] },
) => Promise<SocialCallResult>;

/** A non-secret field the connection must carry before this network can be used. */
export interface SocialAccountField {
  key: string;
  label: string;
  help: string;
}

export interface SocialProvider {
  network: SocialNetwork;
  label: string;
  /** The built-in connector manifest this network runs on. */
  connectorKey: string;
  accountFields: readonly SocialAccountField[];
  /** True when the network REFUSES a text-only post (Instagram, TikTok). Campaigns
   *  check this before queueing rather than discovering it one failed post at a time. */
  requiresMedia: boolean;
  identity(call: SocialCall, fields: Record<string, string>): Promise<SocialIdentity>;
  listPosts(
    call: SocialCall,
    fields: Record<string, string>,
    args: { limit: number; identity: SocialIdentity },
  ): Promise<Array<Omit<SocialFeedItem, 'network' | 'connectionId' | 'accountName'>>>;
  publish(
    call: SocialCall,
    fields: Record<string, string>,
    draft: SocialPostDraft,
    identity: SocialIdentity,
  ): Promise<SocialPublishResult>;
}

/** A network said no. `retryable` is what decides whether a campaign requeues this
 *  one post or writes it off — the same distinction {@link ../marketing/campaignTransports}
 *  draws for email, for the same reason: a misclassified error retries forever. */
export class SocialProviderError extends Error {
  constructor(message: string, readonly status = 502, readonly retryable = false) {
    super(message);
    this.name = 'SocialProviderError';
  }
}

/** 429 and 5xx are worth another attempt; a rejected token or a malformed post is not. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

// ---------------------------------------------------------------------------
// Shared normalization
// ---------------------------------------------------------------------------

const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const text = (value: unknown): string => (value == null ? '' : String(value));

const count = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** Takes the RAW provider values — every network reports a different subset, and
 *  some report them as strings — so counting happens in exactly one place. */
const metrics = (parts: Partial<Record<keyof SocialMetrics, unknown>>): SocialMetrics => ({
  likes: count(parts.likes), comments: count(parts.comments),
  shares: count(parts.shares), views: count(parts.views),
});

/** Provider timestamps arrive as ISO strings, Unix seconds, or nothing at all. */
function toISO(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Unwrap a call, turning a non-ok result into a typed, retry-classified error. */
async function ask(call: SocialCall, actionKey: string, input: Record<string, unknown> = {}, opts?: { captureHeaders?: readonly string[] }): Promise<SocialCallResult> {
  const result = await call(actionKey, input, opts);
  if (!result.ok) {
    throw new SocialProviderError(
      result.error?.slice(0, 400) || `The network returned ${result.status}`,
      result.status || 502,
      isRetryableStatus(result.status),
    );
  }
  return result;
}

/** A missing account-scope field is a CONFIGURATION error, not a network error —
 *  it is fixed by editing the connection, so it must never be retried. */
function requireField(fields: Record<string, string>, key: string, label: string): string {
  const value = (fields[key] ?? '').trim();
  if (!value) throw new SocialProviderError(`This connection is missing ${label}. Add it to the connection and try again.`, 409, false);
  return value;
}

// ---------------------------------------------------------------------------
// X
// ---------------------------------------------------------------------------

const x: SocialProvider = {
  network: 'x', label: 'X', connectorKey: 'x-social', requiresMedia: false,
  accountFields: [],
  async identity(call) {
    const me = rec((await ask(call, 'get_me', { 'user.fields': 'id,name,username' })).data);
    return { externalId: text(me.id), handle: text(me.username), displayName: text(me.name) || text(me.username) };
  },
  async listPosts(call, _fields, { limit, identity }) {
    if (!identity.externalId) return [];
    const result = await ask(call, 'get_user_posts', {
      user_id: identity.externalId,
      // X rejects max_results below 5 outright — a tile asking for 3 posts must
      // still be a valid request, so the floor is applied here rather than upstream.
      max_results: Math.min(Math.max(limit, 5), 100),
      'tweet.fields': 'created_at,public_metrics,entities',
    });
    return list(result.data).map((raw) => {
      const post = rec(raw);
      const pm = rec(post.public_metrics);
      const id = text(post.id);
      return {
        id,
        authorName: identity.handle ? `@${identity.handle}` : identity.displayName,
        text: text(post.text),
        permalink: identity.handle && id ? `https://x.com/${identity.handle}/status/${id}` : null,
        publishedAtISO: toISO(post.created_at),
        mediaUrls: [],
        thumbnailUrl: null,
        metrics: metrics({
          likes: pm.like_count, comments: pm.reply_count,
          shares: pm.retweet_count, views: pm.impression_count,
        }),
      };
    });
  },
  async publish(call, _fields, draft, identity) {
    // X has no link field — a URL in the body IS the link card.
    const body = draft.linkUrl && !draft.text.includes(draft.linkUrl)
      ? `${draft.text}\n\n${draft.linkUrl}`
      : draft.text;
    const data = rec((await ask(call, 'create_post', { text: body })).data);
    const created = rec(data.data);
    const id = text(created.id) || text(data.id);
    return {
      externalId: id,
      permalink: id && identity.handle ? `https://x.com/${identity.handle}/status/${id}` : null,
    };
  },
};

// ---------------------------------------------------------------------------
// LinkedIn
// ---------------------------------------------------------------------------

const LINKEDIN_POST_ID_HEADER = 'x-restli-id';

const linkedin: SocialProvider = {
  network: 'linkedin', label: 'LinkedIn', connectorKey: 'linkedin-social', requiresMedia: false,
  accountFields: [{
    key: 'authorUrn', label: 'Author URN',
    help: 'urn:li:organization:123 to post as a company page, or urn:li:person:… to post as yourself.',
  }],
  async identity(call, fields) {
    const me = rec((await ask(call, 'get_profile')).data);
    const authored = (fields.authorUrn ?? '').trim();
    // The URN the tenant configured WINS: a company-page grant authenticates as a
    // member, so trusting `sub` here would publish to the wrong feed.
    const externalId = authored || (me.sub ? `urn:li:person:${text(me.sub)}` : '');
    return {
      externalId,
      handle: text(me.email) || externalId,
      displayName: text(me.name) || 'LinkedIn',
    };
  },
  async listPosts(call, fields, { limit, identity }) {
    const author = (fields.authorUrn ?? '').trim() || identity.externalId;
    if (!author) return [];
    const result = await ask(call, 'find_posts', { q: 'author', author: encodeURIComponent(author), count: limit });
    return list(result.data).map((raw) => {
      const post = rec(raw);
      const id = text(post.id);
      return {
        id,
        authorName: identity.displayName,
        text: text(post.commentary),
        permalink: id ? `https://www.linkedin.com/feed/update/${id}` : null,
        publishedAtISO: toISO(rec(post.createdAt).time ?? post.createdAt ?? rec(post.lastModifiedAt).time),
        mediaUrls: [],
        thumbnailUrl: null,
        // Engagement is a per-post endpoint (`get_engagement`). Fanning that out
        // over a page of posts is the N+1 the caching rule forbids; the feed shows
        // what one call returns and the inspector fetches engagement on demand.
        metrics: metrics({}),
      };
    });
  },
  async publish(call, fields, draft, identity) {
    const author = requireField({ ...fields, authorUrn: (fields.authorUrn ?? '').trim() || identity.externalId }, 'authorUrn', 'the author URN');
    const commentary = draft.linkUrl && !draft.text.includes(draft.linkUrl)
      ? `${draft.text}\n\n${draft.linkUrl}`
      : draft.text;
    // The created post's id comes back ONLY in a header — LinkedIn answers 201 with
    // an empty body, so without capturing it the campaign ledger could never link
    // to what it published.
    const result = await ask(call, 'create_post', { author, commentary, visibility: 'PUBLIC', lifecycleState: 'PUBLISHED' }, { captureHeaders: [LINKEDIN_POST_ID_HEADER] });
    const id = text(result.headers?.[LINKEDIN_POST_ID_HEADER] ?? rec(result.data).id);
    return { externalId: id, permalink: id ? `https://www.linkedin.com/feed/update/${id}` : null };
  },
};

// ---------------------------------------------------------------------------
// Facebook Pages
// ---------------------------------------------------------------------------

const facebook: SocialProvider = {
  network: 'facebook', label: 'Facebook Pages', connectorKey: 'facebook-pages', requiresMedia: false,
  accountFields: [{ key: 'pageId', label: 'Page ID', help: 'The numeric id of the Facebook Page the token administers.' }],
  async identity(call, fields) {
    const me = rec((await ask(call, 'get_account', { fields: 'id,name' })).data);
    return {
      externalId: (fields.pageId ?? '').trim() || text(me.id),
      handle: text(me.id),
      displayName: text(me.name) || 'Facebook Page',
    };
  },
  async listPosts(call, fields, { limit, identity }) {
    const pageId = (fields.pageId ?? '').trim() || identity.externalId;
    if (!pageId) return [];
    const result = await ask(call, 'list_posts', {
      page_id: pageId,
      // Summary edges keep engagement in the SAME call as the posts — the
      // alternative is one extra request per post.
      fields: 'id,message,created_time,permalink_url,full_picture,shares,likes.summary(true),comments.summary(true)',
      limit,
    });
    return list(result.data).map((raw) => {
      const post = rec(raw);
      const picture = text(post.full_picture);
      return {
        id: text(post.id),
        authorName: identity.displayName,
        text: text(post.message),
        permalink: text(post.permalink_url) || null,
        publishedAtISO: toISO(post.created_time),
        mediaUrls: picture ? [picture] : [],
        thumbnailUrl: picture || null,
        metrics: metrics({
          likes: rec(rec(post.likes).summary).total_count,
          comments: rec(rec(post.comments).summary).total_count,
          shares: rec(post.shares).count,
        }),
      };
    });
  },
  async publish(call, fields, draft, identity) {
    const pageId = (fields.pageId ?? '').trim() || identity.externalId;
    if (!pageId) throw new SocialProviderError('This connection is missing the Page ID. Add it to the connection and try again.', 409, false);
    const data = rec((await ask(call, 'create_post', {
      page_id: pageId,
      message: draft.text,
      ...(draft.linkUrl ? { link: draft.linkUrl } : {}),
    })).data);
    const id = text(data.id);
    return { externalId: id, permalink: id ? `https://www.facebook.com/${id}` : null };
  },
};

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

const instagram: SocialProvider = {
  network: 'instagram', label: 'Instagram', connectorKey: 'instagram-business', requiresMedia: true,
  accountFields: [{ key: 'igUserId', label: 'Instagram account ID', help: 'The professional account id (IG user id) that owns the media.' }],
  async identity(call, fields) {
    const me = rec((await ask(call, 'get_account', { fields: 'id,username,account_type' })).data);
    return {
      externalId: (fields.igUserId ?? '').trim() || text(me.id),
      handle: text(me.username),
      displayName: text(me.username) || 'Instagram',
    };
  },
  async listPosts(call, fields, { limit, identity }) {
    const igUserId = (fields.igUserId ?? '').trim() || identity.externalId;
    if (!igUserId) return [];
    const result = await ask(call, 'list_media', {
      ig_user_id: igUserId,
      fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
      limit,
    });
    return list(result.data).map((raw) => {
      const media = rec(raw);
      const url = text(media.media_url);
      const thumb = text(media.thumbnail_url) || (text(media.media_type) === 'VIDEO' ? '' : url);
      return {
        id: text(media.id),
        authorName: identity.handle ? `@${identity.handle}` : identity.displayName,
        text: text(media.caption),
        permalink: text(media.permalink) || null,
        publishedAtISO: toISO(media.timestamp),
        mediaUrls: url ? [url] : [],
        thumbnailUrl: thumb || null,
        metrics: metrics({ likes: media.like_count, comments: media.comments_count }),
      };
    });
  },
  async publish(call, fields, draft, identity) {
    const igUserId = (fields.igUserId ?? '').trim() || identity.externalId;
    if (!igUserId) throw new SocialProviderError('This connection is missing the Instagram account ID. Add it to the connection and try again.', 409, false);
    const media = (draft.mediaUrls ?? []).filter(Boolean);
    if (media.length === 0) {
      throw new SocialProviderError('Instagram cannot publish a text-only post — attach an image or video URL.', 400, false);
    }
    // Instagram publishes in two steps by design: a container, then the publish.
    // Both are here rather than in the caller so "publish" means the same thing
    // on every network.
    const isVideo = /\.(mp4|mov|m4v)(\?|$)/i.test(media[0]!);
    const container = rec((await ask(call, 'create_media', {
      ig_user_id: igUserId,
      ...(isVideo ? { video_url: media[0], media_type: 'REELS' } : { image_url: media[0] }),
      caption: draft.linkUrl && !draft.text.includes(draft.linkUrl) ? `${draft.text}\n\n${draft.linkUrl}` : draft.text,
    })).data);
    const creationId = text(container.id);
    if (!creationId) throw new SocialProviderError('Instagram did not return a media container id.', 502, true);
    const published = rec((await ask(call, 'publish_media', { ig_user_id: igUserId, creation_id: creationId })).data);
    const id = text(published.id);
    return {
      externalId: id,
      permalink: identity.handle && id ? `https://www.instagram.com/${identity.handle}/` : null,
    };
  },
};

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

/** TikTok answers 200 with its own error envelope, so HTTP status alone is not
 *  whether the call worked. `ok` is the ONLY code meaning success. */
function assertTikTokOk(payload: Record<string, unknown>): void {
  const error = rec(payload.error);
  const code = text(error.code);
  if (code && code !== 'ok') {
    const retryable = code === 'rate_limit_exceeded' || code.startsWith('internal');
    throw new SocialProviderError(text(error.message) || `TikTok rejected the call (${code})`, retryable ? 429 : 400, retryable);
  }
}

const tiktok: SocialProvider = {
  network: 'tiktok', label: 'TikTok', connectorKey: 'tiktok-social', requiresMedia: true,
  accountFields: [],
  async identity(call) {
    const payload = rec((await ask(call, 'creator_info')).data);
    assertTikTokOk(payload);
    const info = rec(rec(payload.data));
    return {
      externalId: text(info.creator_username),
      handle: text(info.creator_username),
      displayName: text(info.creator_nickname) || text(info.creator_username) || 'TikTok',
    };
  },
  async listPosts(call, _fields, { limit, identity }) {
    const result = await ask(call, 'list_videos', {
      fields: 'id,title,create_time,share_url,cover_image_url,view_count,like_count,comment_count,share_count',
      max_count: Math.min(Math.max(limit, 1), 20),
    });
    // `resultPath: data.videos` already unwrapped the envelope on success.
    return list(result.data).map((raw) => {
      const video = rec(raw);
      const cover = text(video.cover_image_url);
      return {
        id: text(video.id),
        authorName: identity.handle ? `@${identity.handle}` : identity.displayName,
        text: text(video.title),
        permalink: text(video.share_url) || null,
        publishedAtISO: toISO(video.create_time),
        mediaUrls: cover ? [cover] : [],
        thumbnailUrl: cover || null,
        metrics: metrics({
          likes: video.like_count, comments: video.comment_count,
          shares: video.share_count, views: video.view_count,
        }),
      };
    });
  },
  async publish(call, _fields, draft) {
    const media = (draft.mediaUrls ?? []).filter(Boolean);
    if (media.length === 0) {
      throw new SocialProviderError('TikTok cannot publish a text-only post — attach a video URL.', 400, false);
    }
    const payload = rec((await ask(call, 'direct_post', {
      post_info: { title: draft.text.slice(0, 2200), privacy_level: 'PUBLIC_TO_EVERYONE' },
      source_info: { source: 'PULL_FROM_URL', video_url: media[0] },
    })).data);
    assertTikTokOk(payload);
    const publishId = text(rec(payload.data).publish_id);
    // TikTok transcodes asynchronously: accepting the job is not publishing it, so
    // this reports `pending` rather than claiming a live post.
    return { externalId: publishId, permalink: null, pending: true };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const PROVIDERS: Readonly<Record<SocialNetwork, SocialProvider>> = {
  x, linkedin, facebook, instagram, tiktok,
};

export function getSocialProvider(network: string): SocialProvider | null {
  return isSocialNetwork(network) ? PROVIDERS[network] : null;
}

export function allSocialProviders(): readonly SocialProvider[] {
  return SOCIAL_NETWORKS.map((n) => PROVIDERS[n]);
}

/** Reverse lookup — a connector connection knows its key, not its network. */
export function socialProviderForConnector(connectorKey: string): SocialProvider | null {
  return allSocialProviders().find((p) => p.connectorKey === connectorKey) ?? null;
}

/** Every connector key that IS a social account, for one-query connection filters. */
export const SOCIAL_CONNECTOR_KEYS: readonly string[] = allSocialProviders().map((p) => p.connectorKey);

/** How many posts one feed read pulls per account. Bounded because a merged feed
 *  fans out across every connected account and each one is an upstream call. */
export const SOCIAL_FEED_PAGE_SIZE = 25;

/** The ceiling one account is ever read at — and therefore the size of the page the
 *  cache holds, which is what lets every requested limit share one cached read. */
export const MAX_FEED_LIMIT = 50;

export function clampFeedLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return SOCIAL_FEED_PAGE_SIZE;
  return Math.min(Math.max(Math.round(n), 1), MAX_FEED_LIMIT);
}
