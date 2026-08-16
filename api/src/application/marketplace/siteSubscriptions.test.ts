import { describe, expect, it, vi } from 'vitest';
import {
  acceptSiteSubscriptionUpdate,
  subscriberStanding,
  subscriptionUpdateAvailable,
} from './siteSubscriptions';
import type { Env } from '../../env';

vi.mock('./creationListings.hosted', () => ({
  hostedListingStatus: vi.fn().mockResolvedValue(null),
}));

const env = {} as Env;

describe('subscriptionUpdateAvailable', () => {
  it('is false when the listing has never published a snapshot', () => {
    expect(subscriptionUpdateAvailable(null, null)).toBe(false);
    expect(subscriptionUpdateAvailable('held-1', null)).toBe(false);
  });

  it('is false when the subscriber already holds the current snapshot', () => {
    expect(subscriptionUpdateAvailable('snap-2', 'snap-2')).toBe(false);
  });

  it('is true when the held snapshot differs from the current one', () => {
    expect(subscriptionUpdateAvailable('snap-1', 'snap-2')).toBe(true);
  });

  it('is true for a subscriber who never held a version at all, once one exists', () => {
    // Defensive: a null held snapshot against a real latest one still reads as an
    // offer rather than silently matching.
    expect(subscriptionUpdateAvailable(null, 'snap-2')).toBe(true);
  });
});

/**
 * Builds a `db` whose `select().from()...limit()` chain resolves to the next entry
 * in `rows`, in call order — matching the sequence `standingWithListing` actually
 * awaits: its own joined row first, then `siteSubscriptionState`'s separate read.
 */
function fakeDb(rows: unknown[][], updateReturning: unknown[] = []) {
  const queue = [...rows];
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    limit: async () => queue.shift() ?? [],
  };
  return {
    select: () => chain,
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => updateReturning,
        }),
      }),
    }),
  } as never;
}

describe('subscriberStanding — the version offer', () => {
  it('carries no offer for a subscriber with no subscription row', async () => {
    const db = fakeDb([[], []]);
    const standing = await subscriberStanding(db, env, { tenantId: 1, siteId: 1, siteUserId: 1 });
    expect(standing.versionOffer).toBeNull();
  });

  it('flags an update once the seller has re-published past what the subscriber holds', async () => {
    const db = fakeDb([
      [{ catalogItemId: 'listing-1', heldSnapshotId: 'snap-1', latestBody: { snapshotId: 'snap-2' } }],
      [{ id: 9, status: 'active', priceCents: 900, currency: 'USD', snapshotId: 'snap-1', currentPeriodEnd: null, cancelledAt: null }],
    ]);
    const standing = await subscriberStanding(db, env, { tenantId: 1, siteId: 1, siteUserId: 1 });
    expect(standing.versionOffer).toEqual({ heldSnapshotId: 'snap-1', latestSnapshotId: 'snap-2', updateAvailable: true });
  });
});

describe('acceptSiteSubscriptionUpdate', () => {
  it('refuses a subscriber who is already current', async () => {
    const db = fakeDb([
      [{ catalogItemId: 'listing-1', heldSnapshotId: 'snap-2', latestBody: { snapshotId: 'snap-2' } }],
      [{ id: 9, status: 'active', priceCents: 900, currency: 'USD', snapshotId: 'snap-2', currentPeriodEnd: null, cancelledAt: null }],
    ]);
    await expect(acceptSiteSubscriptionUpdate(db, env, { tenantId: 1, siteId: 1, siteUserId: 1 }))
      .rejects.toThrow('You are already on the latest version');
  });

  it('refuses a caller with no subscription at all', async () => {
    const db = fakeDb([[], []]);
    await expect(acceptSiteSubscriptionUpdate(db, env, { tenantId: 1, siteId: 1, siteUserId: 1 }))
      .rejects.toThrow('You are not subscribed to this app');
  });

  it('moves the held snapshot to the one currently on sale', async () => {
    const db = fakeDb(
      [
        [{ catalogItemId: 'listing-1', heldSnapshotId: 'snap-1', latestBody: { snapshotId: 'snap-2' } }],
        [{ id: 9, status: 'active', priceCents: 900, currency: 'USD', snapshotId: 'snap-1', currentPeriodEnd: null, cancelledAt: null }],
      ],
      [{ id: 9, status: 'active', priceCents: 900, currency: 'USD', snapshotId: 'snap-2', currentPeriodEnd: null }],
    );
    const updated = await acceptSiteSubscriptionUpdate(db, env, { tenantId: 1, siteId: 1, siteUserId: 1 });
    expect(updated.snapshotId).toBe('snap-2');
  });
});
