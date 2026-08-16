import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveSiteUser = vi.fn();
const siteSubscriptionState = vi.fn();
const siteListing = vi.fn();

vi.mock('./siteAuth', () => ({
  resolveSiteUser: (...args: unknown[]) => resolveSiteUser(...args),
  siteSessionCookie: (header: string | null) => (header ? 'token' : null),
}));
vi.mock('../marketplace/siteSubscriptions', () => ({
  siteSubscriptionState: (...args: unknown[]) => siteSubscriptionState(...args),
  // The real, pure comparison — no reason to fake the one thing under test here.
  subscriptionUpdateAvailable: (held: string | null, latest: string | null) => !!latest && held !== latest,
}));
vi.mock('./siteListing', () => ({
  siteListing: (...args: unknown[]) => siteListing(...args),
}));

const { resolveSiteVisitor } = await import('./siteVisitor');

const site = { siteId: 1, tenantId: 3, projectId: 5 };
const env = {} as never;
const db = {} as never;
const signedIn = new Request('https://app.example.com/', { headers: { cookie: 'bf_site=abc' } });
const anonymous = new Request('https://app.example.com/');

/** A listing the seller has on sale at a price. */
const paid = { slug: 'app', visibility: 'public', priceCents: 900, trial: 'preview' };

describe('who is at the door', () => {
  beforeEach(() => {
    resolveSiteUser.mockReset();
    siteSubscriptionState.mockReset();
    siteListing.mockReset();
    resolveSiteUser.mockResolvedValue({ userId: 7, email: 'buyer@example.com' });
    // The default is a site with nothing on sale — the state most sites are in.
    siteListing.mockResolvedValue(null);
  });

  it('treats an anonymous request as a visitor without asking about money', async () => {
    resolveSiteUser.mockResolvedValue(null);
    const visitor = await resolveSiteVisitor(env, db, site, anonymous);
    expect(visitor).toMatchObject({ siteUserId: null, entitled: false });
    // Nobody is entitled anonymously, so neither read ever happens.
    expect(siteSubscriptionState).not.toHaveBeenCalled();
    expect(siteListing).not.toHaveBeenCalled();
  });

  it('entitles a signed-in user when nothing is on sale — signing in is the gate', async () => {
    siteSubscriptionState.mockResolvedValue({ state: 'none', subscription: null });
    await expect(resolveSiteVisitor(env, db, site, signedIn))
      .resolves.toMatchObject({ entitled: true, subscription: 'none' });
  });

  it('entitles a live subscriber', async () => {
    siteSubscriptionState.mockResolvedValue({ state: 'live', subscription: { id: 1 } });
    siteListing.mockResolvedValue(paid);
    await expect(resolveSiteVisitor(env, db, site, signedIn))
      .resolves.toMatchObject({ entitled: true, subscription: 'live' });
  });

  it('returns a LAPSED subscriber to the shop window rather than to an error', async () => {
    // Still signed in — the renewal is one click away on the page they are sent to.
    siteSubscriptionState.mockResolvedValue({ state: 'lapsed', subscription: null });
    await expect(resolveSiteVisitor(env, db, site, signedIn)).resolves.toMatchObject({
      siteUserId: 7, entitled: false, subscription: 'lapsed',
    });
  });

  it('does not ask the seller about a lapsed subscriber — the shop window is the answer', async () => {
    siteSubscriptionState.mockResolvedValue({ state: 'lapsed', subscription: null });
    await resolveSiteVisitor(env, db, site, signedIn);
    expect(siteListing).not.toHaveBeenCalled();
  });

  /**
   * The hole this closes. Signing in to a published site is an emailed code anybody
   * can request, so "signed in" cannot mean "has paid" for an app that is on sale.
   */
  it('does NOT entitle a signed-in stranger to a PAID app', async () => {
    siteSubscriptionState.mockResolvedValue({ state: 'none', subscription: null });
    siteListing.mockResolvedValue(paid);
    await expect(resolveSiteVisitor(env, db, site, signedIn))
      .resolves.toMatchObject({ entitled: false, subscription: 'none' });
  });

  it('still entitles a signed-in user when the seller priced it at zero', async () => {
    siteSubscriptionState.mockResolvedValue({ state: 'none', subscription: null });
    siteListing.mockResolvedValue({ ...paid, priceCents: 0 });
    await expect(resolveSiteVisitor(env, db, site, signedIn)).resolves.toMatchObject({ entitled: true });
  });

  it('honours a seller who opened the trial to the whole thing', async () => {
    siteSubscriptionState.mockResolvedValue({ state: 'none', subscription: null });
    siteListing.mockResolvedValue({ ...paid, trial: 'full' });
    await expect(resolveSiteVisitor(env, db, site, signedIn)).resolves.toMatchObject({ entitled: true });
  });

  it('tells a live subscriber holding an old version that an update is available', async () => {
    siteSubscriptionState.mockResolvedValue({ state: 'live', subscription: { snapshotId: 'snap-1' } });
    siteListing.mockResolvedValue({ ...paid, currentSnapshotId: 'snap-2' });
    await expect(resolveSiteVisitor(env, db, site, signedIn))
      .resolves.toMatchObject({ entitled: true, updateAvailable: true });
  });

  it('says nothing is available once the subscriber holds the current version', async () => {
    siteSubscriptionState.mockResolvedValue({ state: 'live', subscription: { snapshotId: 'snap-2' } });
    siteListing.mockResolvedValue({ ...paid, currentSnapshotId: 'snap-2' });
    await expect(resolveSiteVisitor(env, db, site, signedIn))
      .resolves.toMatchObject({ updateAvailable: false });
  });

  it('never offers an update to a stranger or a lapsed subscriber', async () => {
    siteSubscriptionState.mockResolvedValue({ state: 'none', subscription: null });
    siteListing.mockResolvedValue({ ...paid, priceCents: 0, currentSnapshotId: 'snap-2' });
    await expect(resolveSiteVisitor(env, db, site, signedIn))
      .resolves.toMatchObject({ updateAvailable: false });

    siteSubscriptionState.mockResolvedValue({ state: 'lapsed', subscription: null });
    await expect(resolveSiteVisitor(env, db, site, signedIn))
      .resolves.toMatchObject({ updateAvailable: false });
  });

  it('does not repossess: a WITHDRAWN listing stays open to a live subscriber', async () => {
    siteSubscriptionState.mockResolvedValue({ state: 'live', subscription: { id: 1 } });
    siteListing.mockResolvedValue({ ...paid, visibility: 'private' });
    await expect(resolveSiteVisitor(env, db, site, signedIn)).resolves.toMatchObject({ entitled: true });
  });

  it('…and closes a withdrawn listing to everybody else, free or not', async () => {
    siteSubscriptionState.mockResolvedValue({ state: 'none', subscription: null });
    siteListing.mockResolvedValue({ ...paid, visibility: 'private', priceCents: 0 });
    await expect(resolveSiteVisitor(env, db, site, signedIn)).resolves.toMatchObject({ entitled: false });
  });
});
