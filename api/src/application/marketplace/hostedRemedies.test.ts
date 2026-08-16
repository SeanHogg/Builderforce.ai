/**
 * WHAT THE PLATFORM OWES A SUBSCRIBER WHEN A HOSTED APP GOES DARK.
 *
 * Three promises are made before anybody subscribes — billing stops, the data comes
 * back, and an abandoned build becomes theirs — and every one of them is kept by code
 * that runs when nobody is watching: a nightly sweep and a button pressed by somebody
 * whose seller has already stopped answering. That is exactly the code that rots
 * quietly, so the rules are pinned here rather than left to a reading of the flow.
 *
 * These are unit tests over the decisions, with the database and the payment
 * processor doubled. What is being asserted is never "the query ran" but "the money
 * stopped", "the gate held" and "the version handed over is the one they hold".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb, whereColumns } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const cancelSubscription = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../../infrastructure/payment', () => ({
  buildPaymentProvider: () => ({ cancelSubscription }),
}));

const hostedListingStatus = vi.fn();
vi.mock('./creationListings.hosted', () => ({
  hostedListingStatus: (...args: unknown[]) => hostedListingStatus(...args),
}));

const publishedSnapshot = vi.fn();
vi.mock('./creationListings', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishedSnapshot: (...args: unknown[]) => publishedSnapshot(...args),
}));

const {
  cancelSiteSubscription,
  subscriberStanding,
  suspendSubscriptionsForListing,
  takeAbandonedBuild,
} = await import('./siteSubscriptions');

/** A processor key present means the vendor is reachable; absent means "not
 *  configured", which every path here must survive rather than treat as an error. */
const env = (stripe = 'sk_test') => ({ STRIPE_SECRET_KEY: stripe } as unknown as Env);

const lifecycle = (over: Record<string, unknown> = {}) => ({
  state: 'operating',
  darkSinceISO: null,
  daysUntilNextState: null,
  billable: true,
  subscriberMayExport: false,
  subscriberMayTake: false,
  ...over,
});

const subscriber = { tenantId: 7, siteId: 42, siteUserId: 99 };

const liveRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  status: 'active',
  priceCents: 900,
  currency: 'usd',
  snapshotId: 'snap-held',
  currentPeriodEnd: null,
  cancelledAt: null,
  ...over,
});

beforeEach(() => {
  cancelSubscription.mockClear();
  hostedListingStatus.mockReset();
  publishedSnapshot.mockReset();
});

describe('cancelSiteSubscription', () => {
  it('STOPS THE CHARGE, not just the access', async () => {
    // The bug this pins: marking the row cancelled revoked access and left the
    // recurring charge running, so a consumer pressing Cancel stopped receiving
    // the thing and kept paying for it every month.
    const db = fakeDb([[{ id: 5, providerRef: 'sub_live_1' }]]);
    const result = await cancelSiteSubscription(db as unknown as Db, env(), 7, 42, 99);
    expect(result).toEqual({ ok: true });
    expect(cancelSubscription).toHaveBeenCalledWith('sub_live_1');
  });

  it('scopes the write to the tenant, the site AND the person', async () => {
    const db = fakeDb([[{ id: 5, providerRef: null }]]);
    await cancelSiteSubscription(db as unknown as Db, env(), 7, 42, 99);
    const columns = whereColumns(db.calls[0]?.where);
    expect(columns).toEqual(expect.arrayContaining(['tenant_id', 'site_id', 'site_user_id']));
  });

  it('asks the processor nothing when there was no subscription to cancel', async () => {
    const db = fakeDb([[]]);
    await expect(cancelSiteSubscription(db as unknown as Db, env(), 7, 42, 99))
      .resolves.toEqual({ ok: false });
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it('still reports success when the PROCESSOR fails', async () => {
    // The local record is already correct. Telling a customer their cancellation
    // failed because a vendor was slow would invite them to press it again.
    cancelSubscription.mockRejectedValueOnce(new Error('stripe 503'));
    const db = fakeDb([[{ id: 5, providerRef: 'sub_live_1' }]]);
    await expect(cancelSiteSubscription(db as unknown as Db, env(), 7, 42, 99))
      .resolves.toEqual({ ok: true });
  });

  it('is a no-op at the processor when no processor is configured', async () => {
    const db = fakeDb([[{ id: 5, providerRef: 'sub_live_1' }]]);
    await cancelSiteSubscription(db as unknown as Db, env('') , 7, 42, 99);
    expect(cancelSubscription).not.toHaveBeenCalled();
  });
});

describe('suspendSubscriptionsForListing', () => {
  it('stops every ACTIVE subscriber of a dark app at the processor', async () => {
    const db = fakeDb([[
      { id: 1, providerRef: 'sub_a' },
      { id: 2, providerRef: 'sub_b' },
    ]]);
    const result = await suspendSubscriptionsForListing(db as unknown as Db, env(), 7, 'listing-1');
    expect(result).toEqual({ suspended: 2 });
    expect(cancelSubscription.mock.calls.map((call) => call[0])).toEqual(['sub_a', 'sub_b']);
    // Suspended, NOT cancelled: they keep the access they already hold.
    expect((db.calls[0]?.payload as { status: string }).status).toBe('suspended');
  });

  it('only touches rows that are still active, so a re-run asks the processor nothing', async () => {
    // Idempotence is the whole reason a daily sweep over a month-old outage is safe.
    const db = fakeDb([[]]);
    await expect(suspendSubscriptionsForListing(db as unknown as Db, env(), 7, 'listing-1'))
      .resolves.toEqual({ suspended: 0 });
    expect(whereColumns(db.calls[0]?.where)).toEqual(expect.arrayContaining(['catalog_item_id', 'status']));
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it('keeps going when one subscriber fails to cancel at the vendor', async () => {
    cancelSubscription.mockRejectedValueOnce(new Error('rate limited'));
    const db = fakeDb([[
      { id: 1, providerRef: 'sub_a' },
      { id: 2, providerRef: 'sub_b' },
    ]]);
    await expect(suspendSubscriptionsForListing(db as unknown as Db, env(), 7, 'listing-1'))
      .resolves.toEqual({ suspended: 2 });
    expect(cancelSubscription).toHaveBeenCalledTimes(2);
  });
});

describe('subscriberStanding', () => {
  it('reports the subscription AND the app lifecycle from one call', async () => {
    hostedListingStatus.mockResolvedValue(lifecycle({ state: 'grace', daysUntilNextState: 9 }));
    const db = fakeDb([[{ catalogItemId: 'listing-1' }], [liveRow()]]);
    const standing = await subscriberStanding(db as unknown as Db, env(), subscriber);
    expect(standing.subscription?.snapshotId).toBe('snap-held');
    expect(standing.hosted?.state).toBe('grace');
  });

  it('reports a SUSPENDED subscription as still live — access outlives billing', async () => {
    hostedListingStatus.mockResolvedValue(lifecycle({ state: 'readOnly', billable: false }));
    const db = fakeDb([
      [{ catalogItemId: 'listing-1' }],
      [liveRow({ status: 'suspended', currentPeriodEnd: new Date('2020-01-01') })],
    ]);
    const standing = await subscriberStanding(db as unknown as Db, env(), subscriber);
    expect(standing.subscription?.status).toBe('suspended');
    expect(standing.hosted?.billable).toBe(false);
  });

  it('reports no lifecycle at all for a free app — null, never a fabricated `operating`', async () => {
    const db = fakeDb([[], [liveRow()]]);
    const standing = await subscriberStanding(db as unknown as Db, env(), subscriber);
    expect(standing.hosted).toBeNull();
    expect(hostedListingStatus).not.toHaveBeenCalled();
  });

  it('does not hand the listing id to the site user', async () => {
    hostedListingStatus.mockResolvedValue(lifecycle());
    const db = fakeDb([[{ catalogItemId: 'listing-1' }], [liveRow()]]);
    const standing = await subscriberStanding(db as unknown as Db, env(), subscriber);
    expect(Object.keys(standing).sort()).toEqual(['hosted', 'subscription', 'versionOffer']);
  });
});

describe('takeAbandonedBuild', () => {
  const released = () => lifecycle({ state: 'released', billable: false, subscriberMayExport: true, subscriberMayTake: true });

  it('hands over the version THEY hold, not the seller’s latest', async () => {
    hostedListingStatus.mockResolvedValue(released());
    publishedSnapshot.mockResolvedValue({ title: 'Ledger', objects: [{ id: 'o1' }] });
    const db = fakeDb([
      [{ catalogItemId: 'listing-1' }],
      [liveRow({ snapshotId: 'snap-held' })],
      [{ body: { snapshotId: 'snap-newer' }, name: 'Ledger' }],
    ]);
    const build = await takeAbandonedBuild(db as unknown as Db, env(), subscriber);
    expect(publishedSnapshot).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'snap-held');
    expect(build).toEqual({ title: 'Ledger', objects: [{ id: 'o1' }] });
  });

  it('falls back to the listing’s published version when the row pinned none', async () => {
    hostedListingStatus.mockResolvedValue(released());
    publishedSnapshot.mockResolvedValue({ title: '', objects: [] });
    const db = fakeDb([
      [{ catalogItemId: 'listing-1' }],
      [liveRow({ snapshotId: null })],
      [{ body: { snapshotId: 'snap-listing' }, name: 'Ledger' }],
    ]);
    const build = await takeAbandonedBuild(db as unknown as Db, env(), subscriber);
    expect(publishedSnapshot).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'snap-listing');
    // The listing's name carries the empty snapshot title.
    expect(build.title).toBe('Ledger');
  });

  it('REFUSES while the app is still running', async () => {
    // The gate is the lifecycle and nothing else — 44 days of a dark address.
    hostedListingStatus.mockResolvedValue(lifecycle({ state: 'grace' }));
    const db = fakeDb([[{ catalogItemId: 'listing-1' }], [liveRow()]]);
    await expect(takeAbandonedBuild(db as unknown as Db, env(), subscriber))
      .rejects.toMatchObject({ status: 409 });
    expect(publishedSnapshot).not.toHaveBeenCalled();
  });

  it('refuses somebody who never subscribed, even to a released app', async () => {
    hostedListingStatus.mockResolvedValue(released());
    const db = fakeDb([[{ catalogItemId: 'listing-1' }], []]);
    await expect(takeAbandonedBuild(db as unknown as Db, env(), subscriber))
      .rejects.toMatchObject({ status: 403 });
  });

  it('refuses a cancelled subscriber — they stopped paying before it was abandoned', async () => {
    hostedListingStatus.mockResolvedValue(released());
    const db = fakeDb([
      [{ catalogItemId: 'listing-1' }],
      [liveRow({ status: 'cancelled', cancelledAt: new Date('2026-01-01') })],
    ]);
    await expect(takeAbandonedBuild(db as unknown as Db, env(), subscriber))
      .rejects.toMatchObject({ status: 403 });
  });

  it('404s rather than inventing a build when the version is gone', async () => {
    hostedListingStatus.mockResolvedValue(released());
    publishedSnapshot.mockResolvedValue(null);
    const db = fakeDb([
      [{ catalogItemId: 'listing-1' }],
      [liveRow()],
      [{ body: {}, name: 'Ledger' }],
    ]);
    await expect(takeAbandonedBuild(db as unknown as Db, env(), subscriber))
      .rejects.toMatchObject({ status: 404 });
  });

  it('reads the subscriber row ONCE — the standing and the remedy share it', async () => {
    hostedListingStatus.mockResolvedValue(released());
    publishedSnapshot.mockResolvedValue({ title: 'Ledger', objects: [] });
    const db = fakeDb([
      [{ catalogItemId: 'listing-1' }],
      [liveRow()],
      [{ body: {}, name: 'Ledger' }],
    ]);
    await takeAbandonedBuild(db as unknown as Db, env(), subscriber);
    const subscriptionReads = db.calls.filter(
      (call) => call.kind === 'select' && whereColumns(call.where).includes('site_user_id'),
    );
    expect(subscriptionReads).toHaveLength(2); // the listing id and the state — never a third
  });
});
