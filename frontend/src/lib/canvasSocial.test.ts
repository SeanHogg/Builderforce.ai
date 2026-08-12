import { describe, expect, it } from 'vitest';
import {
  isSocialNetworkName,
  socialCampaignNodeData,
  socialFeedPatch,
  socialPostNodeData,
  socialPostProjection,
} from './canvasSocial';
import type { SocialCampaign, SocialFeedItem, SocialFeedRead } from './socialApi';

const post = (over: Partial<SocialFeedItem> = {}): SocialFeedItem => ({
  id: 'p1', network: 'x', connectionId: 'c1', accountName: 'Acme X', authorName: '@acme',
  text: 'Launch day is here', permalink: 'https://x.com/acme/status/p1',
  publishedAtISO: '2026-08-10T09:00:00.000Z', mediaUrls: [], thumbnailUrl: null,
  metrics: { likes: 5, comments: 1, shares: 2, views: 100 }, ...over,
});

const read = (items: SocialFeedItem[]): SocialFeedRead => ({
  items,
  accounts: [{
    id: 'c1', network: 'x', networkLabel: 'X', name: 'Acme X', enabled: true, ready: true,
    missingFields: [], requiresMedia: false, lastTestOk: true, lastUsedAt: null,
  }],
  errors: [],
  fetchedAtISO: '2026-08-12T10:00:00.000Z',
});

describe('socialFeedPatch', () => {
  it('leads with aggregate engagement and the best-performing post', () => {
    const patch = socialFeedPatch(read([
      post(),
      post({ id: 'p2', text: 'Quiet update', metrics: { likes: 40, comments: 9, shares: 6, views: 900 } }),
    ]));
    expect(patch.engagement).toEqual({ likes: 45, comments: 10, shares: 8, views: 1000 });
    expect((patch.topPost as { id: string }).id).toBe('p2');
    expect(patch.postCount).toBe(2);
  });

  it('omits topPost entirely when nothing has been published', () => {
    const patch = socialFeedPatch(read([]));
    expect(patch).not.toHaveProperty('topPost');
    expect(patch.postCount).toBe(0);
  });

  it('names the accounts the numbers came from — a feed with no attribution is unreadable', () => {
    expect(socialFeedPatch(read([post()])).accounts).toEqual(['X · Acme X']);
  });
});

/**
 * The tile's data is persisted with the session AND fed to Brain every turn, so a
 * long post must not arrive whole twenty-five times over.
 */
describe('socialPostProjection', () => {
  it('truncates post text, keeping the metrics intact', () => {
    const projection = socialPostProjection(post({ text: 'x'.repeat(900) }));
    expect(projection.text).toHaveLength(400);
    expect(projection.metrics.likes).toBe(5);
  });
});

describe('socialPostNodeData', () => {
  it('keeps the FULL text — that is the reason to pin a post', () => {
    const data = socialPostNodeData(post({ text: `${'y'.repeat(900)}` }));
    expect(String(data.text)).toHaveLength(900);
  });

  it('titles the tile from the first line, not the whole post', () => {
    const data = socialPostNodeData(post({ text: 'Launch day\nMore detail below' }));
    expect(data.title).toBe('Launch day');
  });
});

describe('socialCampaignNodeData', () => {
  const campaign: SocialCampaign = {
    id: 7, name: 'Launch', body: 'We shipped', linkUrl: '', mediaUrls: [], variants: {},
    status: 'published', scheduledAtISO: null, startedAtISO: null, completedAtISO: null,
    targets: 2, published: 1, failed: 0, projectId: null, sessionId: null,
    updatedAtISO: '2026-08-12T10:00:00.000Z',
    posts: [
      { id: 1, connectionId: 'c1', network: 'x', accountName: 'Acme X', body: 'We shipped', status: 'published', externalId: '1', permalink: 'https://x.com/acme/status/1', error: null, attempts: 1, publishedAtISO: '2026-08-12T10:00:00.000Z' },
      { id: 2, connectionId: 'c2', network: 'instagram', accountName: 'Acme IG', body: 'We shipped', status: 'skipped', externalId: null, permalink: null, error: 'needs media', attempts: 0, publishedAtISO: null },
    ],
    blockers: [{ code: 'needsMedia', network: 'instagram', account: 'Instagram · Acme IG' }],
  };

  it('carries the per-account outcome, so "1 of 2" can say WHICH one', () => {
    const data = socialCampaignNodeData(campaign);
    expect(data.publishedCount).toBe(1);
    expect(data.posts).toEqual([
      { id: 1, network: 'x', accountName: 'Acme X', status: 'published', permalink: 'https://x.com/acme/status/1', error: null },
      { id: 2, network: 'instagram', accountName: 'Acme IG', status: 'skipped', permalink: null, error: 'needs media' },
    ]);
  });

  it('stores the campaign STATUS, not a rendered sentence, so the tile stays translatable', () => {
    expect(socialCampaignNodeData(campaign).status).toBe('published');
  });
});

describe('isSocialNetworkName', () => {
  it('accepts the five networks and rejects anything else', () => {
    expect(isSocialNetworkName('linkedin')).toBe(true);
    expect(isSocialNetworkName('threads')).toBe(false);
    expect(isSocialNetworkName(null)).toBe(false);
  });
});
