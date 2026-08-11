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
import { b, ba, bb, bo, p, q, qn } from './dsl';

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
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'OAuth access token', secret: true, required: true, help: 'Company publishing requires approved Community Management access and the appropriate organization feed scopes.' }] },
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
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'Page access token', secret: true, required: true }] },
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
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'Instagram user access token', secret: true, required: true }] },
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

export const SOCIAL_CONNECTORS: readonly ConnectorManifest[] = [x, linkedin, facebook, instagram, tiktok, website];
