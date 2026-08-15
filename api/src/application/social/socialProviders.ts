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
export const SOCIAL_NETWORKS = [
  'x', 'linkedin', 'facebook', 'instagram', 'tiktok',
  'youtube', 'reddit', 'pinterest', 'threads', 'bluesky', 'googleBusiness',
] as const;
export type SocialNetwork = typeof SOCIAL_NETWORKS[number];

/** @see SocialProvider.publishMode */
export type SocialPublishMode = 'text' | 'media' | 'none';

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
  /**
   * What this network accepts from a publish — checked BEFORE anything is queued,
   * rather than discovered one failed post at a time.
   *
   *   `text`  — a text-only post is fine; media is optional.
   *   `media` — the network REFUSES a text-only post (Instagram, TikTok, Pinterest).
   *   `none`  — read and measure only. YouTube is the honest case: publishing is a
   *             resumable upload of the video bytes, which a declarative HTTP manifest
   *             cannot express and a Worker should not proxy.
   *
   * One field rather than two booleans, because "can it publish" and "does it need
   * media" are the same question asked twice and could otherwise disagree.
   */
  publishMode: SocialPublishMode;
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
  network: 'x', label: 'X', connectorKey: 'x-social', publishMode: 'text',
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
  network: 'linkedin', label: 'LinkedIn', connectorKey: 'linkedin-social', publishMode: 'text',
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
  network: 'facebook', label: 'Facebook Pages', connectorKey: 'facebook-pages', publishMode: 'text',
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
  network: 'instagram', label: 'Instagram', connectorKey: 'instagram-business', publishMode: 'media',
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
  network: 'tiktok', label: 'TikTok', connectorKey: 'tiktok-social', publishMode: 'media',
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
// YouTube — read and measure only
// ---------------------------------------------------------------------------

const youtube: SocialProvider = {
  network: 'youtube', label: 'YouTube', connectorKey: 'youtube', publishMode: 'none',
  accountFields: [],
  async identity(call) {
    const channel = rec(list((await ask(call, 'get_my_channel')).data)[0]);
    const snippet = rec(channel.snippet);
    return {
      externalId: text(channel.id),
      handle: text(snippet.customUrl).replace(/^@/, ''),
      displayName: text(snippet.title) || 'YouTube',
    };
  },
  async listPosts(call, _fields, { limit, identity }) {
    const found = list((await ask(call, 'search_my_videos', { maxResults: Math.min(Math.max(limit, 1), 50) })).data);
    const ids = found.map((raw) => text(rec(rec(raw).id).videoId)).filter(Boolean);
    if (ids.length === 0) return [];
    // Search does NOT return statistics, so view and like counts need a second call —
    // ONE call for every id, never one per video.
    const details = list((await ask(call, 'get_videos', { id: ids.join(',') })).data);
    return details.map((raw) => {
      const video = rec(raw);
      const snippet = rec(video.snippet);
      const stats = rec(video.statistics);
      const id = text(video.id);
      const thumbnails = rec(snippet.thumbnails);
      const thumb = text(rec(thumbnails.high ?? thumbnails.default).url);
      return {
        id,
        authorName: identity.displayName,
        text: text(snippet.title),
        permalink: id ? `https://www.youtube.com/watch?v=${id}` : null,
        publishedAtISO: toISO(snippet.publishedAt),
        mediaUrls: thumb ? [thumb] : [],
        thumbnailUrl: thumb || null,
        metrics: metrics({ likes: stats.likeCount, comments: stats.commentCount, views: stats.viewCount }),
      };
    });
  },
  async publish() {
    // Backstop only — `publishMode: 'none'` is what callers check. Reaching this means
    // a caller skipped that check, and silently doing nothing would be worse.
    throw new SocialProviderError('YouTube cannot be published to from here — uploading a video needs a resumable upload. Publish in YouTube Studio and the feed will pick it up.', 400, false);
  },
};

// ---------------------------------------------------------------------------
// Reddit
// ---------------------------------------------------------------------------

const reddit: SocialProvider = {
  network: 'reddit', label: 'Reddit', connectorKey: 'reddit-social', publishMode: 'text',
  accountFields: [{
    key: 'subreddit', label: 'Subreddit',
    help: 'Without the r/ prefix. Reddit has no default destination — every post names one.',
  }],
  async identity(call) {
    const me = rec((await ask(call, 'get_me')).data);
    const name = text(me.name);
    return { externalId: text(me.id) || name, handle: name, displayName: name ? `u/${name}` : 'Reddit' };
  },
  async listPosts(call, _fields, { limit, identity }) {
    if (!identity.handle) return [];
    const children = list((await ask(call, 'list_submitted', { username: identity.handle, limit: Math.min(Math.max(limit, 1), 100), sort: 'new' })).data);
    return children.map((raw) => {
      // Reddit wraps every listing element as `{kind, data}`.
      const post = rec(rec(raw).data);
      const permalink = text(post.permalink);
      const thumbnail = text(post.thumbnail);
      return {
        id: text(post.id),
        authorName: identity.displayName,
        text: text(post.title),
        permalink: permalink ? `https://www.reddit.com${permalink}` : null,
        publishedAtISO: toISO(post.created_utc),
        mediaUrls: [],
        // `thumbnail` is often the literal string "self" or "default" rather than a URL.
        thumbnailUrl: /^https?:/.test(thumbnail) ? thumbnail : null,
        // Reddit reports a SCORE (ups minus downs), not likes. It is the closest thing
        // the network has to the same idea, so it rides in the same column.
        metrics: metrics({ likes: post.score, comments: post.num_comments }),
      };
    });
  },
  async publish(call, fields, draft) {
    const subreddit = requireField(fields, 'subreddit', 'the subreddit to post to');
    const isLink = Boolean(draft.linkUrl) && !draft.text.includes(draft.linkUrl ?? '');
    // Reddit requires a TITLE, which no other network here has. The first line is the
    // title and the rest is the body, which is how people write these posts anyway.
    const [firstLine, ...restLines] = draft.text.split('\n');
    const payload = await ask(call, 'submit', {
      sr: subreddit,
      title: (firstLine || draft.text).slice(0, 300),
      ...(isLink
        ? { kind: 'link', url: draft.linkUrl }
        : { kind: 'self', text: restLines.join('\n').trim() || draft.text }),
    });
    const data = rec(rec(rec(payload.data).json).data);
    return { externalId: text(data.id) || text(data.name), permalink: text(data.url) || null };
  },
};

// ---------------------------------------------------------------------------
// Pinterest
// ---------------------------------------------------------------------------

const pinterest: SocialProvider = {
  network: 'pinterest', label: 'Pinterest', connectorKey: 'pinterest-social', publishMode: 'media',
  accountFields: [{
    key: 'boardId', label: 'Board ID',
    help: 'The board new pins are created on. A pin cannot exist without one.',
  }],
  async identity(call) {
    const account = rec((await ask(call, 'get_account')).data);
    const username = text(account.username);
    return { externalId: text(account.id) || username, handle: username, displayName: username || 'Pinterest' };
  },
  async listPosts(call, _fields, { limit, identity }) {
    const items = list((await ask(call, 'list_pins', { page_size: Math.min(Math.max(limit, 1), 100) })).data);
    return items.map((raw) => {
      const pin = rec(raw);
      const images = rec(rec(pin.media).images);
      const image = text(rec(images['1200x'] ?? images.originals).url);
      const id = text(pin.id);
      return {
        id,
        authorName: identity.handle ? `@${identity.handle}` : identity.displayName,
        text: text(pin.title) || text(pin.description),
        permalink: id ? `https://www.pinterest.com/pin/${id}/` : null,
        publishedAtISO: toISO(pin.created_at),
        mediaUrls: image ? [image] : [],
        thumbnailUrl: image || null,
        // Pin metrics are a per-pin analytics call — the N+1 the caching rule forbids
        // over a page. The inspector fetches them on demand instead.
        metrics: metrics({}),
      };
    });
  },
  async publish(call, fields, draft) {
    const boardId = requireField(fields, 'boardId', 'the board ID');
    const media = (draft.mediaUrls ?? []).filter(Boolean);
    if (media.length === 0) {
      throw new SocialProviderError('Pinterest cannot publish without an image — attach one and try again.', 400, false);
    }
    if (/\.(mp4|mov|m4v)(\?|$)/i.test(media[0]!)) {
      // A video pin needs a REGISTERED media upload id rather than a URL. Saying so
      // beats a 400 from the API that names neither the board nor the reason.
      throw new SocialProviderError('Pinterest video pins need an uploaded media id rather than a URL. Use an image for now.', 400, false);
    }
    const pin = rec((await ask(call, 'create_pin', {
      board_id: boardId,
      title: draft.text.slice(0, 100),
      description: draft.text,
      ...(draft.linkUrl ? { link: draft.linkUrl } : {}),
      media_source: { source_type: 'image_url', url: media[0] },
    })).data);
    const id = text(pin.id);
    return { externalId: id, permalink: id ? `https://www.pinterest.com/pin/${id}/` : null };
  },
};

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

const threads: SocialProvider = {
  network: 'threads', label: 'Threads', connectorKey: 'threads-social', publishMode: 'text',
  accountFields: [],
  async identity(call) {
    const me = rec((await ask(call, 'get_me')).data);
    const username = text(me.username);
    return { externalId: text(me.id), handle: username, displayName: text(me.name) || username || 'Threads' };
  },
  async listPosts(call, _fields, { limit, identity }) {
    const items = list((await ask(call, 'list_threads', {
      fields: 'id,text,permalink,timestamp,media_type,media_url,thumbnail_url',
      limit: Math.min(Math.max(limit, 1), 100),
    })).data);
    return items.map((raw) => {
      const post = rec(raw);
      const media = text(post.media_url);
      return {
        id: text(post.id),
        authorName: identity.handle ? `@${identity.handle}` : identity.displayName,
        text: text(post.text),
        permalink: text(post.permalink) || null,
        publishedAtISO: toISO(post.timestamp),
        mediaUrls: media ? [media] : [],
        thumbnailUrl: text(post.thumbnail_url) || media || null,
        // Threads reports engagement only through a per-post insights call, which over
        // a page of posts is the N+1 the caching rule forbids.
        metrics: metrics({}),
      };
    });
  },
  async publish(call, _fields, draft, identity) {
    const media = (draft.mediaUrls ?? []).filter(Boolean);
    const isVideo = media.length > 0 && /\.(mp4|mov|m4v)(\?|$)/i.test(media[0]!);
    // Threads publishes in two steps by design — a container, then the publish — for
    // the same reason Instagram does, and both live here so "publish" means one thing.
    const container = rec((await ask(call, 'create_container', {
      media_type: media.length === 0 ? 'TEXT' : isVideo ? 'VIDEO' : 'IMAGE',
      text: draft.text,
      ...(media.length === 0 && draft.linkUrl ? { link_attachment: draft.linkUrl } : {}),
      ...(media.length > 0 ? (isVideo ? { video_url: media[0] } : { image_url: media[0] }) : {}),
    })).data);
    const creationId = text(container.id);
    if (!creationId) throw new SocialProviderError('Threads did not return a post container id.', 502, true);
    const published = rec((await ask(call, 'publish_container', { creation_id: creationId })).data);
    const id = text(published.id);
    return {
      externalId: id,
      permalink: identity.handle && id ? `https://www.threads.net/@${identity.handle}` : null,
    };
  },
};

// ---------------------------------------------------------------------------
// Bluesky
// ---------------------------------------------------------------------------

/**
 * The only network here whose credential is not a long-lived token: AT Protocol
 * exchanges a handle + app password for a short-lived `accessJwt` per session. The
 * manifest declares `auth.kind: 'none'` precisely so manifest-level auth does not
 * overwrite the `Authorization` header this adapter sets from that exchange.
 */
async function blueskySession(call: SocialCall): Promise<{ jwt: string; did: string; handle: string }> {
  const session = rec((await ask(call, 'create_session')).data);
  const jwt = text(session.accessJwt);
  if (!jwt) throw new SocialProviderError('Bluesky did not return a session token. Check the handle and app password on this connection.', 401, false);
  return { jwt, did: text(session.did), handle: text(session.handle) };
}

/** An `at://…/rkey` URI's last segment is the record key, which is what a web link needs. */
const blueskyRkey = (uri: string): string => uri.split('/').pop() ?? '';

const bluesky: SocialProvider = {
  network: 'bluesky', label: 'Bluesky', connectorKey: 'bluesky-social', publishMode: 'text',
  accountFields: [],
  async identity(call) {
    const { did, handle } = await blueskySession(call);
    return { externalId: did, handle, displayName: handle || 'Bluesky' };
  },
  async listPosts(call, _fields, { limit, identity }) {
    const { jwt } = await blueskySession(call);
    const feed = list((await ask(call, 'get_author_feed', {
      actor: identity.handle || identity.externalId,
      limit: Math.min(Math.max(limit, 1), 100),
      Authorization: `Bearer ${jwt}`,
    })).data);
    return feed.map((raw) => {
      const post = rec(rec(raw).post);
      const record = rec(post.record);
      const uri = text(post.uri);
      const rkey = blueskyRkey(uri);
      return {
        id: uri,
        authorName: identity.handle ? `@${identity.handle}` : identity.displayName,
        text: text(record.text),
        permalink: identity.handle && rkey ? `https://bsky.app/profile/${identity.handle}/post/${rkey}` : null,
        publishedAtISO: toISO(record.createdAt),
        mediaUrls: [],
        thumbnailUrl: null,
        metrics: metrics({ likes: post.likeCount, comments: post.replyCount, shares: post.repostCount }),
      };
    });
  },
  async publish(call, _fields, draft, identity) {
    const { jwt, did } = await blueskySession(call);
    const body = draft.linkUrl && !draft.text.includes(draft.linkUrl)
      ? `${draft.text}\n\n${draft.linkUrl}`
      : draft.text;
    const created = rec((await ask(call, 'create_record', {
      repo: did || identity.externalId,
      collection: 'app.bsky.feed.post',
      // 300 GRAPHEMES is the real limit; slicing here keeps a long post from being
      // rejected outright, and the campaign composer counts before it gets this far.
      record: { text: body.slice(0, 300), createdAt: new Date().toISOString() },
      Authorization: `Bearer ${jwt}`,
    })).data);
    const uri = text(created.uri);
    const rkey = blueskyRkey(uri);
    return {
      externalId: uri,
      permalink: identity.handle && rkey ? `https://bsky.app/profile/${identity.handle}/post/${rkey}` : null,
    };
  },
};

// ---------------------------------------------------------------------------
// Google Business Profile
// ---------------------------------------------------------------------------

const googleBusiness: SocialProvider = {
  network: 'googleBusiness', label: 'Google Business Profile', connectorKey: 'google-business-profile', publishMode: 'text',
  accountFields: [{
    key: 'locationName', label: 'Location resource name',
    help: 'accounts/123/locations/456 — which business location this connection posts about.',
  }],
  async identity(_call, fields) {
    // There is no "who am I" on this API — the LOCATION is the identity, and it is
    // configured on the connection rather than discoverable from the token.
    const locationName = (fields.locationName ?? '').trim();
    return {
      externalId: locationName,
      handle: locationName.split('/').pop() ?? '',
      displayName: locationName || 'Google Business Profile',
    };
  },
  async listPosts(call, fields, { limit, identity }) {
    const locationName = requireField(fields, 'locationName', 'the location resource name');
    const posts = list((await ask(call, 'list_local_posts', { location_name: locationName, pageSize: Math.min(Math.max(limit, 1), 100) })).data);
    return posts.map((raw) => {
      const post = rec(raw);
      const media = list(post.media).map((item) => text(rec(item).googleUrl)).filter(Boolean);
      return {
        id: text(post.name),
        authorName: identity.displayName,
        text: text(post.summary),
        permalink: text(post.searchUrl) || null,
        publishedAtISO: toISO(post.createTime),
        mediaUrls: media,
        thumbnailUrl: media[0] ?? null,
        // Local-post metrics live behind the separate Business Profile Performance API.
        metrics: metrics({}),
      };
    });
  },
  async publish(call, fields, draft, identity) {
    const locationName = requireField(fields, 'locationName', 'the location resource name');
    const media = (draft.mediaUrls ?? []).filter(Boolean);
    const created = rec((await ask(call, 'create_local_post', {
      location_name: locationName,
      summary: draft.text.slice(0, 1500),
      languageCode: 'en',
      topicType: 'STANDARD',
      ...(draft.linkUrl ? { callToAction: { actionType: 'LEARN_MORE', url: draft.linkUrl } } : {}),
      ...(media.length > 0 ? { media: media.map((url) => ({ mediaFormat: 'PHOTO', sourceUrl: url })) } : {}),
    })).data);
    return {
      externalId: text(created.name) || identity.externalId,
      permalink: text(created.searchUrl) || null,
    };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const PROVIDERS: Readonly<Record<SocialNetwork, SocialProvider>> = {
  x, linkedin, facebook, instagram, tiktok,
  youtube, reddit, pinterest, threads, bluesky, googleBusiness,
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
