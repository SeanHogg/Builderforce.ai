import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveSiteUser = vi.fn();
const siteSubscriptionState = vi.fn();

vi.mock('./siteAuth', () => ({
  resolveSiteUser: (...args: unknown[]) => resolveSiteUser(...args),
  siteSessionCookie: (header: string | null) => (header ? 'token' : null),
}));
vi.mock('../marketplace/siteSubscriptions', () => ({
  siteSubscriptionState: (...args: unknown[]) => siteSubscriptionState(...args),
}));

const { resolveSiteVisitor } = await import('./siteVisitor');

const site = { siteId: 1, tenantId: 3 };
const db = {} as never;
const signedIn = new Request('https://app.example.com/', { headers: { cookie: 'bf_site=abc' } });
const anonymous = new Request('https://app.example.com/');

describe('who is at the door', () => {
  beforeEach(() => {
    resolveSiteUser.mockReset();
    siteSubscriptionState.mockReset();
    resolveSiteUser.mockResolvedValue({ userId: 7, email: 'buyer@example.com' });
  });

  it('treats an anonymous request as a visitor without asking about money', async () => {
    resolveSiteUser.mockResolvedValue(null);
    const visitor = await resolveSiteVisitor(db, site, anonymous);
    expect(visitor).toMatchObject({ siteUserId: null, entitled: false });
    // Nobody is entitled anonymously, so the subscription read never happens.
    expect(siteSubscriptionState).not.toHaveBeenCalled();
  });

  it('entitles a signed-in user of a FREE app, which has no subscription to hold', async () => {
    siteSubscriptionState.mockResolvedValue({ state: 'none', subscription: null });
    await expect(resolveSiteVisitor(db, site, signedIn)).resolves.toMatchObject({ entitled: true, subscription: 'none' });
  });

  it('entitles a live subscriber', async () => {
    siteSubscriptionState.mockResolvedValue({ state: 'live', subscription: { id: 1 } });
    await expect(resolveSiteVisitor(db, site, signedIn)).resolves.toMatchObject({ entitled: true, subscription: 'live' });
  });

  it('returns a LAPSED subscriber to the shop window rather than to an error', async () => {
    // Still signed in — the renewal is one click away on the page they are sent to.
    siteSubscriptionState.mockResolvedValue({ state: 'lapsed', subscription: null });
    await expect(resolveSiteVisitor(db, site, signedIn)).resolves.toMatchObject({
      siteUserId: 7, entitled: false, subscription: 'lapsed',
    });
  });
});
