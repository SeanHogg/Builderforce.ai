import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ apiRequest: vi.fn() }));
const sessions = vi.hoisted(() => ({ get: vi.fn() }));
const site = vi.hoisted(() => ({ fetchSite: vi.fn() }));
const growth = vi.hoisted(() => ({
  domain: vi.fn(),
  collections: vi.fn(),
  traffic: vi.fn(),
}));

vi.mock('./apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./apiClient')>()),
  apiRequest: transport.apiRequest,
}));

vi.mock('./builderforceApi', () => ({ creationSessionsApi: sessions }));

vi.mock('./api', () => ({ fetchSite: site.fetchSite }));

vi.mock('./growthApi', () => ({
  siteDomainApi: { get: growth.domain },
  siteDataApi: { listCollections: growth.collections },
  siteTrafficApi: { get: growth.traffic },
}));

const {
  appAddresses,
  appDataFacts,
  appIsPublished,
  appPeopleFacts,
  canConvertSession,
  embeddedAppsApi,
  invalidateApp,
} = await import('./embeddedApps');

type Overview = Awaited<ReturnType<typeof embeddedAppsApi.overview>>;

const SITE = {
  subdomain: 'sunday-rsvp',
  mode: 'static',
  status: 'active',
  versionToken: 'v7',
  assetCount: 12,
  totalBytes: 4096,
  publishedAt: '2026-08-01T00:00:00.000Z',
  url: 'https://sunday-rsvp.builderforce.app',
  pathUrl: '/api/sites/sunday-rsvp/',
};

const overview = (patch: Partial<Overview> = {}): Overview => ({
  site: SITE,
  domain: null,
  collections: [],
  traffic: null,
  ...patch,
} as Overview);

const collection = (patch: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'signups',
  acceptsPublicWrites: true,
  audienceId: null,
  recordCount: 4,
  dailyWriteCap: 2000,
  createdAt: '',
  endpoint: 'https://sunday-rsvp.builderforce.app/__api/collections/signups',
  ...patch,
});

beforeEach(() => {
  for (const spy of [transport.apiRequest, sessions.get, site.fetchSite, growth.domain, growth.collections, growth.traffic]) {
    spy.mockReset();
  }
  // Every test starts from a cold cache; otherwise the first test's answers are
  // the second test's answers and nothing is actually being asserted.
  invalidateApp({ sessionId: 'board-1', projectId: 42 });
});

describe('canConvertSession', () => {
  /**
   * The endpoint is `requireSession(c, 'editor')`. A button offered to somebody
   * the server will refuse teaches them that by failing.
   */
  it('mirrors the server rank check rather than guessing', () => {
    expect(canConvertSession('owner')).toBe(true);
    expect(canConvertSession('runner')).toBe(true);
    expect(canConvertSession('editor')).toBe(true);
    expect(canConvertSession('commenter')).toBe(false);
    expect(canConvertSession('viewer')).toBe(false);
  });
});

describe('sessionAppState', () => {
  it('reads the app, the role and the title off one session read', async () => {
    sessions.get.mockResolvedValue({
      app: { projectId: 42, projectKey: 'SUN', name: 'Sunday RSVP', subdomain: 'sunday-rsvp' },
      role: 'owner',
      session: { title: 'Sunday RSVP' },
    });
    await expect(embeddedAppsApi.sessionAppState('board-1')).resolves.toEqual({
      app: { projectId: 42, projectKey: 'SUN', name: 'Sunday RSVP', subdomain: 'sunday-rsvp' },
      role: 'owner',
      title: 'Sunday RSVP',
    });
  });

  it('reports a board that is still only a board as app: null', async () => {
    sessions.get.mockResolvedValue({ role: 'editor', session: { title: 'Untitled' } });
    await expect(embeddedAppsApi.sessionAppState('board-1')).resolves.toMatchObject({ app: null });
  });

  /** A board is opened and closed constantly; the answer changes only on convert. */
  it('serves a second reader from the cache instead of a second request', async () => {
    sessions.get.mockResolvedValue({ app: null, role: 'editor', session: { title: 'X' } });
    await embeddedAppsApi.sessionAppState('board-1');
    await embeddedAppsApi.sessionAppState('board-1');
    expect(sessions.get).toHaveBeenCalledTimes(1);
  });
});

describe('addressAvailable', () => {
  /**
   * Deliberately uncached, matching the server: a cached "available" that
   * outlives somebody else claiming the name tells the creator they have it and
   * then fails the conversion.
   */
  it('asks every time', async () => {
    transport.apiRequest.mockResolvedValue({ label: 'a', available: true, reason: 'ok', host: 'a.x' });
    await embeddedAppsApi.addressAvailable('a');
    await embeddedAppsApi.addressAvailable('a');
    expect(transport.apiRequest).toHaveBeenCalledTimes(2);
  });

  it('encodes the label rather than pasting it into the query', async () => {
    transport.apiRequest.mockResolvedValue({ label: null, available: false, reason: 'invalid', host: null });
    await embeddedAppsApi.addressAvailable('Sunday RSVP & co');
    expect(transport.apiRequest.mock.calls[0]?.[0]).toContain('label=Sunday%20RSVP%20%26%20co');
  });

  /** A 400 is the ANSWER ("that cannot be a label"), not a system fault. */
  it('keeps a rejected label off the global error surface', async () => {
    transport.apiRequest.mockResolvedValue({ label: null, available: false, reason: 'invalid', host: null });
    await embeddedAppsApi.addressAvailable('!!!');
    expect(transport.apiRequest.mock.calls[0]?.[1]).toMatchObject({ expectedErrors: [400] });
  });
});

describe('convertToApp', () => {
  it('drops the cached session answer so the next read sees the app', async () => {
    sessions.get.mockResolvedValue({ app: null, role: 'owner', session: { title: 'Sunday RSVP' } });
    await embeddedAppsApi.sessionAppState('board-1');

    transport.apiRequest.mockResolvedValue({
      app: { projectId: 42, projectKey: 'SUN', name: 'Sunday RSVP', sessionId: 'board-1', subdomain: 'sunday-rsvp', host: 'sunday-rsvp.builderforce.app', created: true },
    });
    await embeddedAppsApi.convertToApp('board-1', 'sunday-rsvp');

    sessions.get.mockResolvedValue({
      app: { projectId: 42, projectKey: 'SUN', name: 'Sunday RSVP', subdomain: 'sunday-rsvp' },
      role: 'owner',
      session: { title: 'Sunday RSVP' },
    });
    await expect(embeddedAppsApi.sessionAppState('board-1')).resolves.toMatchObject({
      app: { subdomain: 'sunday-rsvp' },
    });
    expect(sessions.get).toHaveBeenCalledTimes(2);
  });

  /** 400 unusable · 404 not editable · 409 taken are all answers the panel renders. */
  it('treats the three rejection statuses as expected', async () => {
    transport.apiRequest.mockResolvedValue({ app: { projectId: 1, subdomain: 'a', host: 'a.x', created: true, projectKey: 'A', name: 'A', sessionId: 'board-1' } });
    await embeddedAppsApi.convertToApp('board-1', 'a');
    expect(transport.apiRequest.mock.calls[0]?.[1]).toMatchObject({ expectedErrors: [400, 404, 409] });
  });

  it('sends no label at all when the field was left blank', async () => {
    transport.apiRequest.mockResolvedValue({ app: { projectId: 1, subdomain: 'a', host: 'a.x', created: true, projectKey: 'A', name: 'A', sessionId: 'board-1' } });
    await embeddedAppsApi.convertToApp('board-1', '   ');
    expect(JSON.parse(String(transport.apiRequest.mock.calls[0]?.[1]?.body))).toEqual({});
  });
});

describe('overview', () => {
  it('issues the four reads concurrently and tolerates each failing alone', async () => {
    site.fetchSite.mockResolvedValue(SITE);
    growth.domain.mockRejectedValue(new Error('no domain endpoint'));
    growth.collections.mockRejectedValue(new Error('no site yet'));
    growth.traffic.mockResolvedValue({ days: [], totals: { pageViews: 9, visitors: 3, assetHits: 0, bytesServed: 0 }, approximate: true });

    const result = await embeddedAppsApi.overview(42);
    expect(result.site).toEqual(SITE);
    expect(result.domain).toBeNull();
    expect(result.collections).toEqual([]);
    expect(result.traffic?.totals.visitors).toBe(3);
  });

  it('serves a remount from the cache', async () => {
    site.fetchSite.mockResolvedValue(SITE);
    growth.domain.mockResolvedValue(null);
    growth.collections.mockResolvedValue({ collections: [] });
    growth.traffic.mockResolvedValue(null);
    await embeddedAppsApi.overview(42);
    await embeddedAppsApi.overview(42);
    expect(site.fetchSite).toHaveBeenCalledTimes(1);
  });
});

describe('derivations', () => {
  /**
   * The site row exists from the moment the address is RESERVED, with no assets.
   * `site !== null` therefore does not mean published, and the asset count is the
   * only honest discriminator between "held for you" and "live".
   */
  it('does not call a reserved-but-empty address published', () => {
    expect(appIsPublished(overview({ site: { ...SITE, assetCount: 0 } } as Partial<Overview>))).toBe(false);
    expect(appIsPublished(overview())).toBe(true);
  });

  it('takes the primary address from the server-built url, never a concatenation', () => {
    expect(appAddresses(overview()).primary).toBe('https://sunday-rsvp.builderforce.app');
  });

  /** A hostname whose certificate is still pending is not somewhere to send people. */
  it('shows a custom domain only once it is genuinely reachable', () => {
    const pending = { hostname: 'rsvp.example.com', status: 'pending_certificate', live: false } as Overview['domain'];
    const live = { hostname: 'rsvp.example.com', status: 'active', live: true } as Overview['domain'];
    expect(appAddresses(overview({ domain: pending })).custom).toBeNull();
    expect(appAddresses(overview({ domain: live })).custom).toBe('https://rsvp.example.com');
  });

  it('counts records across every collection and flags the gated ones', () => {
    const facts = appDataFacts(overview({
      collections: [
        collection({ id: 1, recordCount: 4 }),
        collection({ id: 2, name: 'members', recordCount: 11, audienceId: 3 }),
      ],
    } as Partial<Overview>));
    expect(facts).toEqual({ collections: 2, records: 15, gated: 1 });
  });

  /** The server says the counts are buffered; a surface that drops that lies. */
  it('carries the approximate flag through, and assumes it when there is no rollup', () => {
    expect(appPeopleFacts(overview()).approximate).toBe(true);
    expect(appPeopleFacts(overview()).visitors).toBe(0);
    expect(appPeopleFacts(overview({
      traffic: { days: [], totals: { pageViews: 40, visitors: 12, assetHits: 0, bytesServed: 0 }, approximate: true },
    } as Partial<Overview>))).toEqual({ visitors: 12, pageViews: 40, approximate: true });
  });
});
