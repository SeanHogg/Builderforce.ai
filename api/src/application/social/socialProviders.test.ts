import { describe, expect, it } from 'vitest';
import {
  clampFeedLimit,
  getSocialProvider,
  isSocialNetwork,
  isRetryableStatus,
  socialProviderForConnector,
  SocialProviderError,
  SOCIAL_CONNECTOR_KEYS,
  type SocialCall,
  type SocialCallResult,
  type SocialIdentity,
} from './socialProviders';

/**
 * A fake connector runtime.
 *
 * The adapters are pure translation — which action to call and what the answer means —
 * so they are asserted directly against recorded provider payloads rather than through
 * a mocked fetch. That is where the real defects live: five networks report the same
 * three facts under five different names.
 */
function calls(responses: Record<string, Partial<SocialCallResult>>): { call: SocialCall; seen: Array<{ action: string; input: Record<string, unknown> }> } {
  const seen: Array<{ action: string; input: Record<string, unknown> }> = [];
  const call: SocialCall = async (actionKey, input = {}) => {
    seen.push({ action: actionKey, input });
    const hit = responses[actionKey];
    if (!hit) throw new Error(`unexpected action ${actionKey}`);
    return { ok: true, status: 200, data: null, ...hit };
  };
  return { call, seen };
}

const identity = (over: Partial<SocialIdentity> = {}): SocialIdentity =>
  ({ externalId: '1', handle: 'acme', displayName: 'Acme', ...over });

describe('registry', () => {
  it('maps every social connector key back to exactly one provider', () => {
    expect(SOCIAL_CONNECTOR_KEYS).toHaveLength(5);
    for (const key of SOCIAL_CONNECTOR_KEYS) {
      expect(socialProviderForConnector(key)?.connectorKey).toBe(key);
    }
    expect(socialProviderForConnector('slack')).toBeNull();
  });

  it('only recognises the five networks', () => {
    expect(isSocialNetwork('x')).toBe(true);
    expect(isSocialNetwork('mastodon')).toBe(false);
    expect(getSocialProvider('mastodon')).toBeNull();
  });

  it('clamps a feed limit into the cached page size, defaulting a garbage value', () => {
    expect(clampFeedLimit(10)).toBe(10);
    expect(clampFeedLimit(0)).toBe(1);
    expect(clampFeedLimit(500)).toBe(50);
    expect(clampFeedLimit('nonsense')).toBe(25);
  });
});

describe('X', () => {
  const x = getSocialProvider('x')!;

  it('normalizes public_metrics and builds a permalink from the handle', async () => {
    const { call } = calls({
      get_user_posts: {
        data: [{
          id: '55', text: 'Launch day', created_at: '2026-08-01T09:00:00.000Z',
          public_metrics: { like_count: 4, reply_count: 2, retweet_count: 1, impression_count: 900 },
        }],
      },
    });
    const [post] = await x.listPosts(call, {}, { limit: 10, identity: identity({ handle: 'acme' }) });
    expect(post).toMatchObject({
      id: '55',
      text: 'Launch day',
      permalink: 'https://x.com/acme/status/55',
      metrics: { likes: 4, comments: 2, shares: 1, views: 900 },
    });
  });

  it('raises max_results to the network floor — X rejects a request for 3', async () => {
    const { call, seen } = calls({ get_user_posts: { data: [] } });
    await x.listPosts(call, {}, { limit: 3, identity: identity() });
    expect(seen[0]?.input.max_results).toBe(5);
  });

  it('appends the link to the body, since X has no link field', async () => {
    const { call, seen } = calls({ create_post: { data: { data: { id: '77' } } } });
    const result = await x.publish(call, {}, { text: 'Read this', linkUrl: 'https://acme.test/post' }, identity({ handle: 'acme' }));
    expect(String(seen[0]?.input.text)).toContain('https://acme.test/post');
    expect(result).toEqual({ externalId: '77', permalink: 'https://x.com/acme/status/77' });
  });
});

describe('LinkedIn', () => {
  const linkedin = getSocialProvider('linkedin')!;

  it('takes the created post id from the RESPONSE HEADER — the body is empty', async () => {
    const call: SocialCall = async () => ({
      ok: true, status: 201, data: null, headers: { 'x-restli-id': 'urn:li:share:99' },
    });
    const result = await linkedin.publish(call, { authorUrn: 'urn:li:organization:7' }, { text: 'Hello' }, identity());
    expect(result).toEqual({
      externalId: 'urn:li:share:99',
      permalink: 'https://www.linkedin.com/feed/update/urn:li:share:99',
    });
  });

  it('publishes as the CONFIGURED author, not the authenticated member', async () => {
    const { call, seen } = calls({ create_post: { data: {} } });
    await linkedin.publish(call, { authorUrn: 'urn:li:organization:7' }, { text: 'Hello' }, identity({ externalId: 'urn:li:person:1' }));
    expect(seen[0]?.input.author).toBe('urn:li:organization:7');
  });

  it('refuses to publish with no author URN, and says so without retrying', async () => {
    const { call } = calls({ create_post: { data: {} } });
    await expect(linkedin.publish(call, {}, { text: 'Hello' }, identity({ externalId: '' })))
      .rejects.toMatchObject({ name: 'SocialProviderError', retryable: false });
  });
});

describe('Facebook Pages', () => {
  const facebook = getSocialProvider('facebook')!;

  it('reads engagement out of the summary edges requested in the same call', async () => {
    const { call, seen } = calls({
      list_posts: {
        data: [{
          id: '10_20', message: 'Open day', created_time: '2026-08-02T00:00:00+0000',
          permalink_url: 'https://facebook.com/10_20', full_picture: 'https://cdn.test/a.jpg',
          shares: { count: 3 }, likes: { summary: { total_count: 12 } }, comments: { summary: { total_count: 5 } },
        }],
      },
    });
    const [post] = await facebook.listPosts(call, { pageId: '10' }, { limit: 5, identity: identity() });
    expect(String(seen[0]?.input.fields)).toContain('likes.summary(true)');
    expect(post).toMatchObject({
      permalink: 'https://facebook.com/10_20',
      thumbnailUrl: 'https://cdn.test/a.jpg',
      metrics: { likes: 12, comments: 5, shares: 3, views: 0 },
    });
  });
});

describe('Instagram', () => {
  const instagram = getSocialProvider('instagram')!;

  it('creates a container and then publishes it — two calls, one publish', async () => {
    const { call, seen } = calls({
      create_media: { data: { id: 'container-1' } },
      publish_media: { data: { id: 'media-9' } },
    });
    const result = await instagram.publish(
      call, { igUserId: '42' },
      { text: 'New drop', mediaUrls: ['https://cdn.test/a.jpg'] },
      identity({ handle: 'acme' }),
    );
    expect(seen.map((s) => s.action)).toEqual(['create_media', 'publish_media']);
    expect(seen[1]?.input.creation_id).toBe('container-1');
    expect(result.externalId).toBe('media-9');
  });

  it('refuses a text-only post rather than letting the network reject it', async () => {
    const { call } = calls({});
    await expect(instagram.publish(call, { igUserId: '42' }, { text: 'No picture' }, identity()))
      .rejects.toMatchObject({ retryable: false, status: 400 });
    expect(instagram.publishMode).toBe('media');
  });
});

describe('TikTok', () => {
  const tiktok = getSocialProvider('tiktok')!;

  it('reports a publish as PENDING — accepting a job is not publishing it', async () => {
    const { call } = calls({ direct_post: { data: { data: { publish_id: 'p-1' }, error: { code: 'ok' } } } });
    const result = await tiktok.publish(call, {}, { text: 'Clip', mediaUrls: ['https://cdn.test/v.mp4'] }, identity());
    expect(result).toEqual({ externalId: 'p-1', permalink: null, pending: true });
  });

  it('treats its 200-with-error envelope as a failure, and rate limits as retryable', async () => {
    const rateLimited = calls({ direct_post: { data: { error: { code: 'rate_limit_exceeded', message: 'slow down' } } } });
    await expect(tiktok.publish(rateLimited.call, {}, { text: 'Clip', mediaUrls: ['https://cdn.test/v.mp4'] }, identity()))
      .rejects.toMatchObject({ retryable: true });

    const rejected = calls({ direct_post: { data: { error: { code: 'invalid_param', message: 'bad url' } } } });
    await expect(tiktok.publish(rejected.call, {}, { text: 'Clip', mediaUrls: ['https://cdn.test/v.mp4'] }, identity()))
      .rejects.toMatchObject({ retryable: false });
  });
});

describe('failure classification', () => {
  it('retries throttling and server faults, never a rejected credential', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(400)).toBe(false);
  });

  it('turns a non-ok connector result into a typed, classified error', async () => {
    const failing: SocialCall = async () => ({ ok: false, status: 429, data: null, error: 'Too Many Requests' });
    const x = getSocialProvider('x')!;
    const error = await x.identity(failing, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SocialProviderError);
    expect(error).toMatchObject({ status: 429, retryable: true });
  });
});
