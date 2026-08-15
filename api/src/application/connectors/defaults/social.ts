/**
 * Built-in social publishing and listening connectors.
 *
 * Scheduling deliberately stays in the workflow trigger layer: a canvas workflow
 * starts with a `schedule` trigger and fans out to one or more of these actions.
 * That keeps retry/idempotency/cron state in one engine instead of pretending each
 * network has the same native scheduler. The website connector is the owned-media
 * destination in that same fan-out.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { b, ba, bb, bo, h, p, q, qn } from './dsl';

const x: ConnectorManifest = {
  key: 'x-social', name: 'X', category: 'marketing', icon: '𝕏',
  description: 'Publish posts, read account posts, and search recent conversation on X.',
  baseUrl: 'https://api.x.com/2', docsUrl: 'https://docs.x.com/x-api',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'OAuth 2.0 user access token', secret: true, required: true, help: 'Posting requires a user-context token with tweet.read, tweet.write and users.read.' }] },
  actions: [
    { key: 'create_post', label: 'Create post', description: 'Publish a text post, reply, quote, or attached-media post.', method: 'POST', path: '/tweets', mutates: true, required: ['text'], params: {
      text: b('Post text'), reply: bo('Reply settings, e.g. {"in_reply_to_tweet_id":"..."}'), quote_tweet_id: b('Post id to quote'), media: bo('Media object with media_ids'), poll: bo('Optional poll object'),
    } },
    { key: 'search_recent', label: 'Search recent posts', description: 'Analyze recent public conversation matching a query.', method: 'GET', path: '/tweets/search/recent', mutates: false, required: ['query'], resultPath: 'data', params: {
      query: q('X search query'), max_results: qn('10-100 results'), 'tweet.fields': q('Comma list such as created_at,public_metrics,lang,author_id'), expansions: q('Comma list such as author_id,attachments.media_keys'),
    } },
    { key: 'get_me', label: 'Get connected account', description: 'Verify the connected X user and account identity.', method: 'GET', path: '/users/me', mutates: false, resultPath: 'data', params: { 'user.fields': q('Comma list such as id,name,username,public_metrics') } },
    { key: 'get_user_posts', label: 'Get account posts', description: 'Read recent posts for an X user for campaign reporting.', method: 'GET', path: '/users/{user_id}/tweets', mutates: false, required: ['user_id'], resultPath: 'data', params: { user_id: p('X user id'), max_results: qn('5-100 results'), 'tweet.fields': q('Comma list such as created_at,public_metrics') } },
  ],
};

const linkedin: ConnectorManifest = {
  key: 'linkedin-social', name: 'LinkedIn', category: 'marketing', icon: 'in',
  description: 'Publish company or member posts and read engagement on LinkedIn.',
  baseUrl: 'https://api.linkedin.com', docsUrl: 'https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api',
  defaultHeaders: { 'LinkedIn-Version': '202606', 'X-Restli-Protocol-Version': '2.0.0' },
  // `authorUrn` is a NON-SECRET scope field, not a credential: a company-page grant
  // authenticates as a member, so the token alone cannot say which feed to publish
  // to. Storing it on the connection is what lets the social port refuse a post it
  // could not place, instead of publishing to the wrong feed or 400ing at the API.
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'OAuth access token', secret: true, required: true, help: 'Company publishing requires approved Community Management access and the appropriate organization feed scopes.' },
    { key: 'authorUrn', label: 'Author URN', secret: false, required: false, placeholder: 'urn:li:organization:1234567', help: 'Which feed posts are published to — an organization URN for a company page, or a person URN to post as yourself.' },
  ] },
  actions: [
    { key: 'get_profile', label: 'Get connected profile', description: 'Verify the connected LinkedIn member through OpenID Connect.', method: 'GET', path: '/v2/userinfo', mutates: false, params: {} },
    { key: 'create_post', label: 'Create post', description: 'Publish a LinkedIn member or organization post.', method: 'POST', path: '/rest/posts', mutates: true, required: ['author', 'commentary'], params: {
      author: b('Author URN, e.g. urn:li:organization:123'), commentary: b('Post commentary'), visibility: b('PUBLIC or CONNECTIONS', { default: 'PUBLIC' }), distribution: bo('Distribution object', { default: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] } }), lifecycleState: b('PUBLISHED', { default: 'PUBLISHED' }), content: bo('Optional article, image, video, document or poll content'),
    } },
    { key: 'find_posts', label: 'Find author posts', description: 'Read posts by an organization or member for campaign analysis.', method: 'GET', path: '/rest/posts', mutates: false, required: ['author'], resultPath: 'elements', params: { q: q('Finder name', { default: 'author' }), author: q('URL-encoded author URN'), count: qn('Page size'), start: qn('Page offset') } },
    { key: 'get_engagement', label: 'Get post engagement', description: 'Read aggregate likes and comments for a LinkedIn post.', method: 'GET', path: '/rest/socialActions/{post_urn}', mutates: false, required: ['post_urn'], params: { post_urn: p('URL-encoded share or post URN') } },
  ],
};

const facebook: ConnectorManifest = {
  key: 'facebook-pages', name: 'Facebook Pages', category: 'marketing', icon: 'f',
  description: 'Publish to a Facebook Page and measure post and Page performance.',
  baseUrl: 'https://graph.facebook.com/v25.0', docsUrl: 'https://developers.facebook.com/docs/pages-api/posts',
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'Page access token', secret: true, required: true },
    { key: 'pageId', label: 'Page ID', secret: false, required: false, placeholder: '1234567890', help: 'The Page this connection publishes to and reports on. A token can administer several.' },
  ] },
  actions: [
    { key: 'get_account', label: 'Get connected Page account', description: 'Verify the Facebook identity represented by the access token.', method: 'GET', path: '/me', mutates: false, params: { fields: q('Identity fields', { default: 'id,name' }) } },
    { key: 'create_post', label: 'Create Page post', description: 'Publish a text or link post to a Facebook Page.', method: 'POST', path: '/{page_id}/feed', mutates: true, required: ['page_id', 'message'], params: { page_id: p('Facebook Page id'), message: b('Post copy'), link: b('Optional destination URL'), published: bb('Publish immediately', { default: true }) } },
    { key: 'list_posts', label: 'List Page posts', description: 'Read recent Page posts and engagement metrics.', method: 'GET', path: '/{page_id}/posts', mutates: false, required: ['page_id'], resultPath: 'data', params: { page_id: p('Facebook Page id'), fields: q('Fields such as id,message,created_time,permalink_url,shares'), limit: qn('Page size') } },
    { key: 'get_insights', label: 'Get Page insights', description: 'Read Page metrics for a date range.', method: 'GET', path: '/{page_id}/insights', mutates: false, required: ['page_id', 'metric'], resultPath: 'data', params: { page_id: p('Facebook Page id'), metric: q('Comma-separated Page metrics'), period: q('day, week, days_28, month or lifetime'), since: q('Start date or Unix time'), until: q('End date or Unix time') } },
  ],
};

const instagram: ConnectorManifest = {
  key: 'instagram-business', name: 'Instagram', category: 'marketing', icon: '◎',
  description: 'Publish media to Instagram professional accounts and report media insights.',
  baseUrl: 'https://graph.facebook.com/v25.0', docsUrl: 'https://developers.facebook.com/docs/instagram-platform/content-publishing',
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'Instagram user access token', secret: true, required: true },
    { key: 'igUserId', label: 'Instagram account ID', secret: false, required: false, placeholder: '17841400000000000', help: 'The professional account id that owns the media this connection publishes and reports on.' },
  ] },
  actions: [
    { key: 'get_account', label: 'Get connected Instagram account', description: 'Verify the Instagram professional account identity.', method: 'GET', path: '/me', mutates: false, params: { fields: q('Identity fields', { default: 'id,username,account_type' }) } },
    { key: 'create_media', label: 'Create media container', description: 'Create an Instagram image, carousel, reel, or story publishing container.', method: 'POST', path: '/{ig_user_id}/media', mutates: true, required: ['ig_user_id'], params: { ig_user_id: p('Instagram professional account id'), image_url: b('Public image URL'), video_url: b('Public video URL'), media_type: b('IMAGE, VIDEO, REELS, STORIES or CAROUSEL'), caption: b('Caption and hashtags'), children: ba('Child container ids for a carousel'), is_carousel_item: bb('Whether this is a carousel child') } },
    { key: 'publish_media', label: 'Publish media', description: 'Publish a completed Instagram media container.', method: 'POST', path: '/{ig_user_id}/media_publish', mutates: true, required: ['ig_user_id', 'creation_id'], params: { ig_user_id: p('Instagram professional account id'), creation_id: b('Media container id') } },
    { key: 'list_media', label: 'List account media', description: 'Read recent Instagram media for campaign analysis.', method: 'GET', path: '/{ig_user_id}/media', mutates: false, required: ['ig_user_id'], resultPath: 'data', params: { ig_user_id: p('Instagram professional account id'), fields: q('Fields such as id,caption,media_type,permalink,timestamp,like_count,comments_count'), limit: qn('Page size') } },
    { key: 'get_media_insights', label: 'Get media insights', description: 'Read reach, views and engagement for an Instagram media item.', method: 'GET', path: '/{media_id}/insights', mutates: false, required: ['media_id', 'metric'], resultPath: 'data', params: { media_id: p('Instagram media id'), metric: q('Comma-separated insight metrics') } },
    { key: 'search_hashtag', label: 'Find hashtag', description: 'Resolve an Instagram hashtag for trend research.', method: 'GET', path: '/ig_hashtag_search', mutates: false, required: ['user_id', 'q'], resultPath: 'data', params: { user_id: q('Instagram professional account id'), q: q('Hashtag without #') } },
    { key: 'hashtag_top_media', label: 'Get top hashtag media', description: 'Read top media for an Instagram hashtag.', method: 'GET', path: '/{hashtag_id}/top_media', mutates: false, required: ['hashtag_id', 'user_id'], resultPath: 'data', params: { hashtag_id: p('Hashtag id'), user_id: q('Instagram professional account id'), fields: q('Fields such as id,caption,media_type,permalink,like_count,comments_count') } },
  ],
};

const tiktok: ConnectorManifest = {
  key: 'tiktok-social', name: 'TikTok', category: 'marketing', icon: '♪',
  description: 'Publish videos or photos to TikTok and inspect creator content performance.',
  baseUrl: 'https://open.tiktokapis.com/v2', docsUrl: 'https://developers.tiktok.com/products/content-posting-api',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'Creator access token', secret: true, required: true, help: 'Direct posting requires Content Posting API approval and video.publish.' }] },
  actions: [
    { key: 'creator_info', label: 'Get creator info', description: 'Verify the creator and retrieve allowed posting settings.', method: 'POST', path: '/post/publish/creator_info/query/', mutates: false, params: {} },
    { key: 'direct_post', label: 'Direct post video', description: 'Initialize a direct TikTok video post.', method: 'POST', path: '/post/publish/video/init/', mutates: true, required: ['post_info', 'source_info'], params: { post_info: bo('Caption, privacy, interaction and disclosure settings'), source_info: bo('FILE_UPLOAD or PULL_FROM_URL source settings') } },
    { key: 'direct_post_photos', label: 'Direct post photos', description: 'Initialize a direct TikTok photo post.', method: 'POST', path: '/post/publish/content/init/', mutates: true, required: ['post_info', 'source_info', 'post_mode', 'media_type'], params: { post_info: bo('Title, description, privacy and interaction settings'), source_info: bo('Photo source and URLs'), post_mode: b('DIRECT_POST'), media_type: b('PHOTO') } },
    { key: 'publish_status', label: 'Get publish status', description: 'Check processing and publication status for a TikTok post.', method: 'POST', path: '/post/publish/status/fetch/', mutates: false, required: ['publish_id'], params: { publish_id: b('Publish id returned by an init action') } },
    { key: 'list_videos', label: 'List creator videos', description: 'Read creator videos and metrics for campaign analysis.', method: 'POST', path: '/video/list/', mutates: false, params: { fields: q('Comma list such as id,title,create_time,share_url,view_count,like_count,comment_count,share_count'), cursor: qn('Pagination cursor'), max_count: qn('1-20 videos') }, resultPath: 'data.videos' },
  ],
};

const website: ConnectorManifest = {
  key: 'website-publisher', name: 'Website Publisher', category: 'marketing', icon: '🌐',
  description: 'Publish campaign content to your website through its authenticated content API.',
  baseUrl: '{{auth.baseUrl}}', docsUrl: 'https://builderforce.ai/docs/workflows',
  auth: { kind: 'api_key', in: 'header', name: 'Authorization', fields: [
    { key: 'baseUrl', label: 'Website content API URL', secret: false, required: true, placeholder: 'https://example.com/api', help: 'The HTTPS root for your website publishing API.' },
    { key: 'apiKey', label: 'Authorization header value', secret: true, required: false, placeholder: 'Bearer …' },
  ] },
  actions: [
    { key: 'publish_content', label: 'Publish content', description: 'Create a website article, campaign page, or social content record.', method: 'POST', path: '/content', mutates: true, required: ['content'], params: { content: bo('Provider-specific content payload'), idempotency_key: { type: 'string', in: 'header', name: 'Idempotency-Key', description: 'Stable key for safe scheduled retries' } } },
    { key: 'update_content', label: 'Update content', description: 'Update an existing website content item.', method: 'PUT', path: '/content/{content_id}', mutates: true, required: ['content_id', 'content'], params: { content_id: p('Website content id'), content: bo('Provider-specific content payload') } },
    { key: 'list_content', label: 'List content', description: 'Read published and scheduled website content for campaign reporting.', method: 'GET', path: '/content', mutates: false, params: { status: q('Filter by draft, scheduled or published'), campaign_id: q('Filter by campaign id'), limit: qn('Page size') } },
  ],
};

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

/**
 * READ AND MEASURE ONLY. Publishing to YouTube is a resumable multipart upload of the
 * video bytes, which a declarative HTTP manifest cannot express and a Worker should not
 * proxy. Declaring the actions that DO work — and letting the port say `publishMode:
 * 'none'` — is honest; a `create_video` action that always failed would not be.
 */
const youtube: ConnectorManifest = {
  key: 'youtube', name: 'YouTube', category: 'marketing', icon: '▶',
  description: 'Read channel videos, views and engagement, and update video metadata.',
  baseUrl: 'https://www.googleapis.com/youtube/v3', docsUrl: 'https://developers.google.com/youtube/v3/docs',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'OAuth access token', secret: true, required: true, help: 'A token with https://www.googleapis.com/auth/youtube.readonly, or youtube.force-ssl to edit metadata.' }] },
  actions: [
    { key: 'get_my_channel', label: 'Get connected channel', description: 'Verify the connected YouTube channel and read its subscriber and view totals.', method: 'GET', path: '/channels', mutates: false, resultPath: 'items', params: { part: q('Comma list such as snippet,statistics,contentDetails', { default: 'snippet,statistics' }), mine: q('true to read the authenticated channel', { default: 'true' }) } },
    { key: 'search_my_videos', label: 'List channel videos', description: 'List the authenticated channel’s recent uploads, newest first.', method: 'GET', path: '/search', mutates: false, resultPath: 'items', params: { part: q('Response parts', { default: 'snippet' }), forMine: q('true to restrict to the authenticated channel', { default: 'true' }), type: q('Resource type', { default: 'video' }), order: q('date, viewCount, rating or relevance', { default: 'date' }), maxResults: qn('1-50 results'), pageToken: q('Continuation token') } },
    { key: 'get_videos', label: 'Get video details', description: 'Read titles, descriptions and view, like and comment counts for specific videos.', method: 'GET', path: '/videos', mutates: false, resultPath: 'items', params: { part: q('Comma list such as snippet,statistics', { default: 'snippet,statistics' }), id: q('Comma list of video ids') } },
    { key: 'update_video', label: 'Update video metadata', description: 'Change the title, description, tags or category of an existing video.', method: 'PUT', path: '/videos', mutates: true, required: ['part', 'id'], params: { part: q('Parts being written, e.g. snippet', { default: 'snippet' }), id: b('Video id'), snippet: bo('Title, description, tags and categoryId'), status: bo('Privacy status and licence') } },
    { key: 'list_comment_threads', label: 'List comments', description: 'Read the comment threads on a video for social listening.', method: 'GET', path: '/commentThreads', mutates: false, resultPath: 'items', params: { part: q('Response parts', { default: 'snippet' }), videoId: q('Video id'), order: q('time or relevance'), maxResults: qn('1-100 results') } },
  ],
};

// ---------------------------------------------------------------------------
// Reddit
// ---------------------------------------------------------------------------

const reddit: ConnectorManifest = {
  key: 'reddit-social', name: 'Reddit', category: 'marketing', icon: '◓',
  description: 'Post to a subreddit and read submissions and conversation on Reddit.',
  baseUrl: 'https://oauth.reddit.com', docsUrl: 'https://www.reddit.com/dev/api',
  // Reddit rejects a request whose User-Agent looks like a generic library, and the
  // documented format identifies the platform and a contact — so it is pinned once here.
  defaultHeaders: { 'User-Agent': 'web:ai.builderforce:v1.0 (by /u/builderforce)' },
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'OAuth access token', secret: true, required: true, help: 'A Reddit OAuth token with identity, submit, read and history.' },
    { key: 'subreddit', label: 'Subreddit', secret: false, required: false, placeholder: 'SideProject', help: 'Without the r/ prefix — where this connection submits. Reddit has no default destination; every post names one.' },
  ] },
  actions: [
    { key: 'get_me', label: 'Get connected account', description: 'Verify the connected Reddit account and read its karma.', method: 'GET', path: '/api/v1/me', mutates: false, params: {} },
    { key: 'list_submitted', label: 'List submitted posts', description: 'Read the account’s recent submissions with their scores and comment counts.', method: 'GET', path: '/user/{username}/submitted', mutates: false, required: ['username'], resultPath: 'data.children', params: { username: p('Reddit username without u/'), limit: qn('1-100 results'), sort: q('new, hot or top'), after: q('Pagination token') } },
    { key: 'submit', label: 'Submit a post', description: 'Submit a text or link post to a subreddit.', method: 'POST', path: '/api/submit', mutates: true, required: ['sr', 'title', 'kind'], bodyFormat: 'form', params: { sr: b('Subreddit name without r/'), title: b('Post title'), kind: b('self for a text post, link for a URL post', { default: 'self' }), text: b('Body text for a self post'), url: b('Destination URL for a link post'), api_type: b('Reddit response format', { default: 'json' }), sendreplies: bb('Send reply notifications', { default: true }) } },
    { key: 'list_subreddit_new', label: 'Read a subreddit', description: 'Read the newest submissions in a subreddit for listening and trend research.', method: 'GET', path: '/r/{subreddit}/new', mutates: false, required: ['subreddit'], resultPath: 'data.children', params: { subreddit: p('Subreddit name without r/'), limit: qn('1-100 results'), after: q('Pagination token') } },
    { key: 'search', label: 'Search Reddit', description: 'Search submissions across Reddit or within a subreddit.', method: 'GET', path: '/search', mutates: false, required: ['q'], resultPath: 'data.children', params: { q: q('Search query'), sort: q('relevance, hot, top, new or comments'), t: q('hour, day, week, month, year or all'), limit: qn('1-100 results'), restrict_sr: q('true to stay inside one subreddit') } },
  ],
};

// ---------------------------------------------------------------------------
// Pinterest
// ---------------------------------------------------------------------------

const pinterest: ConnectorManifest = {
  key: 'pinterest-social', name: 'Pinterest', category: 'marketing', icon: '◉',
  description: 'Create pins on a board and read pin performance on Pinterest.',
  baseUrl: 'https://api.pinterest.com/v5', docsUrl: 'https://developers.pinterest.com/docs/api/v5/pins-create',
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'OAuth access token', secret: true, required: true, help: 'Requires pins:read, pins:write and boards:read on a Pinterest business account.' },
    { key: 'boardId', label: 'Board ID', secret: false, required: false, placeholder: '549755885175', help: 'The board new pins are created on. A pin cannot exist without one.' },
  ] },
  actions: [
    { key: 'get_account', label: 'Get connected account', description: 'Verify the connected Pinterest business account.', method: 'GET', path: '/user_account', mutates: false, params: {} },
    { key: 'list_boards', label: 'List boards', description: 'List the boards this account can pin to.', method: 'GET', path: '/boards', mutates: false, resultPath: 'items', params: { page_size: qn('Page size'), bookmark: q('Pagination bookmark') } },
    { key: 'list_pins', label: 'List pins', description: 'Read recent pins with their titles, links and media.', method: 'GET', path: '/pins', mutates: false, resultPath: 'items', params: { page_size: qn('Page size'), bookmark: q('Pagination bookmark'), pin_filter: q('exclude_native or has_been_promoted') } },
    { key: 'create_pin', label: 'Create pin', description: 'Create a pin on a board from an image or video URL.', method: 'POST', path: '/pins', mutates: true, required: ['board_id', 'media_source'], params: { board_id: b('Destination board id'), title: b('Pin title'), description: b('Pin description'), link: b('Destination URL the pin sends people to'), alt_text: b('Accessible description of the image'), media_source: bo('Media source, e.g. {"source_type":"image_url","url":"https://…"}') } },
    { key: 'get_pin_analytics', label: 'Get pin analytics', description: 'Read impressions, saves and outbound clicks for a pin.', method: 'GET', path: '/pins/{pin_id}/analytics', mutates: false, required: ['pin_id', 'start_date', 'end_date', 'metric_types'], params: { pin_id: p('Pin id'), start_date: q('YYYY-MM-DD'), end_date: q('YYYY-MM-DD'), metric_types: q('Comma list such as IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK') } },
  ],
};

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

const threads: ConnectorManifest = {
  key: 'threads-social', name: 'Threads', category: 'marketing', icon: '@',
  description: 'Publish posts and read replies and insights on Threads.',
  baseUrl: 'https://graph.threads.net/v1.0', docsUrl: 'https://developers.facebook.com/docs/threads',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'Threads access token', secret: true, required: true, help: 'Requires threads_basic and threads_content_publish.' }] },
  actions: [
    { key: 'get_me', label: 'Get connected account', description: 'Verify the connected Threads profile.', method: 'GET', path: '/me', mutates: false, params: { fields: q('Fields such as id,username,name,threads_profile_picture_url', { default: 'id,username,name' }) } },
    { key: 'list_threads', label: 'List posts', description: 'Read the account’s recent Threads posts.', method: 'GET', path: '/me/threads', mutates: false, resultPath: 'data', params: { fields: q('Fields such as id,text,permalink,timestamp,media_type,media_url'), limit: qn('Page size'), since: q('ISO 8601 lower bound'), until: q('ISO 8601 upper bound') } },
    { key: 'create_container', label: 'Create post container', description: 'Stage a Threads post. Publishing it is a second call, as on Instagram.', method: 'POST', path: '/me/threads', mutates: true, required: ['media_type'], params: { media_type: b('TEXT, IMAGE, VIDEO or CAROUSEL'), text: b('Post text'), image_url: b('Public image URL'), video_url: b('Public video URL'), link_attachment: b('URL to attach to a text post'), reply_to_id: b('Post id this replies to') } },
    { key: 'publish_container', label: 'Publish post', description: 'Publish a staged Threads container.', method: 'POST', path: '/me/threads_publish', mutates: true, required: ['creation_id'], params: { creation_id: b('Container id returned by create_container') } },
    { key: 'get_insights', label: 'Get post insights', description: 'Read views, likes, replies and reposts for a Threads post.', method: 'GET', path: '/{media_id}/insights', mutates: false, required: ['media_id', 'metric'], resultPath: 'data', params: { media_id: p('Threads post id'), metric: q('Comma list such as views,likes,replies,reposts,quotes') } },
  ],
};

// ---------------------------------------------------------------------------
// Bluesky
// ---------------------------------------------------------------------------

/**
 * The only network here whose credential is not a long-lived token: AT Protocol
 * exchanges a handle + app password for a short-lived `accessJwt` on every session. The
 * manifest therefore declares `auth.kind: 'none'` and carries the exchange as its own
 * action — the adapter calls `create_session` first and passes the returned JWT as an
 * explicit `Authorization` HEADER PARAM on the calls that need it. That works precisely
 * because manifest-level auth is what would otherwise overwrite the header.
 */
const bluesky: ConnectorManifest = {
  key: 'bluesky-social', name: 'Bluesky', category: 'marketing', icon: '◇',
  description: 'Publish posts and read your feed on Bluesky and other AT Protocol hosts.',
  baseUrl: 'https://{{auth.service}}/xrpc', docsUrl: 'https://docs.bsky.app',
  auth: { kind: 'none', fields: [
    { key: 'service', label: 'Service host', secret: false, required: true, placeholder: 'bsky.social', help: 'bsky.social for the main network, or your own PDS host.' },
    { key: 'handle', label: 'Handle', secret: false, required: true, placeholder: 'you.bsky.social', help: 'The account handle, without the @.' },
    { key: 'appPassword', label: 'App password', secret: true, required: true, placeholder: 'xxxx-xxxx-xxxx-xxxx', help: 'Bluesky → Settings → App passwords. Never your account password.' },
  ] },
  actions: [
    { key: 'create_session', label: 'Start a session', description: 'Exchange the handle and app password for the short-lived token every other action needs.', method: 'POST', path: '/com.atproto.server.createSession', mutates: false, params: { identifier: b('Account handle', { default: '{{auth.handle}}' }), password: b('App password', { default: '{{auth.appPassword}}' }) } },
    { key: 'get_author_feed', label: 'List posts', description: 'Read an account’s recent posts with their like, reply and repost counts.', method: 'GET', path: '/app.bsky.feed.getAuthorFeed', mutates: false, required: ['actor'], resultPath: 'feed', params: { actor: q('Handle or DID'), limit: qn('1-100 results'), cursor: q('Pagination cursor'), Authorization: h('Bearer accessJwt from create_session', { name: 'Authorization' }) } },
    { key: 'create_record', label: 'Publish a post', description: 'Create a post record in the account’s repository.', method: 'POST', path: '/com.atproto.repo.createRecord', mutates: true, required: ['repo', 'collection', 'record'], params: { repo: b('Account DID'), collection: b('Record type', { default: 'app.bsky.feed.post' }), record: bo('Post record with text, createdAt, and optional embed and facets'), Authorization: h('Bearer accessJwt from create_session', { name: 'Authorization' }) } },
    { key: 'search_posts', label: 'Search posts', description: 'Search public Bluesky posts for listening and trend research.', method: 'GET', path: '/app.bsky.feed.searchPosts', mutates: false, required: ['q'], resultPath: 'posts', params: { q: q('Search query'), limit: qn('1-100 results'), sort: q('top or latest'), cursor: q('Pagination cursor'), Authorization: h('Bearer accessJwt from create_session', { name: 'Authorization' }) } },
  ],
};

// ---------------------------------------------------------------------------
// Google Business Profile
// ---------------------------------------------------------------------------

const googleBusiness: ConnectorManifest = {
  key: 'google-business-profile', name: 'Google Business Profile', category: 'marketing', icon: '📍',
  description: 'Publish local posts and read reviews for a business location on Google.',
  baseUrl: 'https://mybusiness.googleapis.com/v4', docsUrl: 'https://developers.google.com/my-business/reference/rest',
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'OAuth access token', secret: true, required: true, help: 'A token with https://www.googleapis.com/auth/business.manage.' },
    { key: 'locationName', label: 'Location resource name', secret: false, required: false, placeholder: 'accounts/123/locations/456', help: 'The full resource name of the location this connection posts about and reports on.' },
  ] },
  actions: [
    { key: 'list_local_posts', label: 'List local posts', description: 'Read the recent posts published on a business location.', method: 'GET', path: '/{location_name}/localPosts', mutates: false, required: ['location_name'], resultPath: 'localPosts', params: { location_name: p('Location resource name, e.g. accounts/123/locations/456'), pageSize: qn('Page size'), pageToken: q('Continuation token') } },
    { key: 'create_local_post', label: 'Create local post', description: 'Publish an update, offer or event to a business location’s Google profile.', method: 'POST', path: '/{location_name}/localPosts', mutates: true, required: ['location_name', 'summary'], params: { location_name: p('Location resource name'), summary: b('Post copy'), languageCode: b('BCP-47 language code', { default: 'en' }), topicType: b('STANDARD, EVENT, OFFER or ALERT', { default: 'STANDARD' }), callToAction: bo('Action type and URL'), media: ba('Array of media items with mediaFormat and sourceUrl'), event: bo('Event title and schedule for an EVENT post') } },
    { key: 'list_reviews', label: 'List reviews', description: 'Read customer reviews and star ratings for a location.', method: 'GET', path: '/{location_name}/reviews', mutates: false, required: ['location_name'], resultPath: 'reviews', params: { location_name: p('Location resource name'), pageSize: qn('Page size'), orderBy: q('updateTime desc or rating desc'), pageToken: q('Continuation token') } },
    { key: 'reply_to_review', label: 'Reply to a review', description: 'Publish the business reply to a customer review.', method: 'PUT', path: '/{review_name}/reply', mutates: true, required: ['review_name', 'comment'], params: { review_name: p('Review resource name'), comment: b('Reply text') } },
  ],
};

export const SOCIAL_CONNECTORS: readonly ConnectorManifest[] = [
  x, linkedin, facebook, instagram, tiktok, website,
  youtube, reddit, pinterest, threads, bluesky, googleBusiness,
];
