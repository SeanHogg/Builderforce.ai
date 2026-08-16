/**
 * THE THING THAT KEEPS ASKING.
 *
 * The hosted lifecycle derives four states from one observation — when the address was
 * first seen dark — and this sweep is the only thing that ever makes that observation.
 * If it silently skips a listing, that listing's grace clock never starts and every
 * promise downstream of it (billing stops, data comes back, the build becomes theirs)
 * simply never fires. Nobody would see an error; subscribers would just keep paying.
 *
 * So what is pinned here is the skipping, the ordering and the suspension trigger.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const probe = vi.fn();
vi.mock('./stageChecks.probe', () => ({ deploymentProbe: () => probe }));

const publishedSnapshot = vi.fn();
vi.mock('./creationListings', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishedSnapshot: (...args: unknown[]) => publishedSnapshot(...args),
}));

const recordHostedProbe = vi.fn(async (..._args: unknown[]) => undefined);
const hostedListingStatus = vi.fn();
vi.mock('./creationListings.hosted', () => ({
  recordHostedProbe: (...args: unknown[]) => recordHostedProbe(...args),
  hostedListingStatus: (...args: unknown[]) => hostedListingStatus(...args),
}));

const suspendSubscriptionsForListing = vi.fn(async (..._args: unknown[]) => ({ suspended: 0 }));
vi.mock('./siteSubscriptions', () => ({
  suspendSubscriptionsForListing: (...args: unknown[]) => suspendSubscriptionsForListing(...args),
}));

const { runHostedListingSweep } = await import('./creationListings.hostedSweep');

const env = {} as unknown as Env;

/** A published hosted listing whose snapshot carries a live address. */
const listing = (id: string, tenantId: number | null = 7) => ({
  id, tenantId, body: { snapshotId: `snap-${id}`, delivery: 'hosted' },
});
const withAddress = (url: string) => ({
  title: 'App',
  objects: [{ id: 'o1', kind: 'website', canvasData: { siteUrl: url }, content: null }],
});

beforeEach(() => {
  probe.mockReset();
  publishedSnapshot.mockReset();
  recordHostedProbe.mockClear();
  hostedListingStatus.mockReset();
  suspendSubscriptionsForListing.mockClear();
  suspendSubscriptionsForListing.mockResolvedValue({ suspended: 0 });
});

describe('runHostedListingSweep', () => {
  it('records a healthy probe and suspends nobody', async () => {
    publishedSnapshot.mockResolvedValue(withAddress('https://app.test'));
    probe.mockResolvedValue({ url: 'https://app.test', root: 'ok', health: 'ok' });
    const db = fakeDb([[listing('l1')]]);

    const result = await runHostedListingSweep(db as unknown as Db, env);

    expect(result).toEqual({ probed: 1, dark: 0, suspended: 0 });
    expect(recordHostedProbe).toHaveBeenCalledWith(expect.anything(), env, expect.objectContaining({
      tenantId: 7, listingId: 'l1', ok: true,
    }));
    // A healthy listing must never reach the billing path at all.
    expect(hostedListingStatus).not.toHaveBeenCalled();
    expect(suspendSubscriptionsForListing).not.toHaveBeenCalled();
  });

  it('marks a dead address dark and STOPS THE MONEY once it leaves the grace window', async () => {
    publishedSnapshot.mockResolvedValue(withAddress('https://gone.test'));
    probe.mockResolvedValue({ url: 'https://gone.test', root: 'breach', health: 'unknown' });
    hostedListingStatus.mockResolvedValue({ state: 'readOnly', billable: false });
    suspendSubscriptionsForListing.mockResolvedValue({ suspended: 3 });
    const db = fakeDb([[listing('l1')]]);

    const result = await runHostedListingSweep(db as unknown as Db, env);

    expect(result).toEqual({ probed: 1, dark: 1, suspended: 3 });
    expect(recordHostedProbe).toHaveBeenCalledWith(expect.anything(), env, expect.objectContaining({ ok: false }));
    expect(suspendSubscriptionsForListing).toHaveBeenCalledWith(expect.anything(), env, 7, 'l1');
  });

  it('leaves billing alone while a dark app is still inside its grace window', async () => {
    // Fourteen days to bring it back. Suspending on day one would punish a seller
    // for a deploy.
    publishedSnapshot.mockResolvedValue(withAddress('https://flaky.test'));
    probe.mockResolvedValue({ url: 'https://flaky.test', root: 'ok', health: 'breach' });
    hostedListingStatus.mockResolvedValue({ state: 'grace', billable: true });
    const db = fakeDb([[listing('l1')]]);

    const result = await runHostedListingSweep(db as unknown as Db, env);

    expect(result).toEqual({ probed: 1, dark: 1, suspended: 0 });
    expect(suspendSubscriptionsForListing).not.toHaveBeenCalled();
  });

  it('reads the lifecycle AFTER writing the observation it depends on', async () => {
    publishedSnapshot.mockResolvedValue(withAddress('https://gone.test'));
    probe.mockResolvedValue({ url: 'https://gone.test', root: 'breach', health: 'breach' });
    const order: string[] = [];
    recordHostedProbe.mockImplementationOnce(async () => { order.push('write'); });
    hostedListingStatus.mockImplementationOnce(async () => { order.push('read'); return { billable: true }; });
    const db = fakeDb([[listing('l1')]]);

    await runHostedListingSweep(db as unknown as Db, env);

    expect(order).toEqual(['write', 'read']);
  });

  it('does not treat a health it could not determine as an outage', async () => {
    // `unknown` means NOT ASKED — a static host that serves index.html for every
    // path cannot answer the engine question, and is not thereby down.
    publishedSnapshot.mockResolvedValue(withAddress('https://static.test'));
    probe.mockResolvedValue({ url: 'https://static.test', root: 'ok', health: 'unknown' });
    const db = fakeDb([[listing('l1')]]);

    await expect(runHostedListingSweep(db as unknown as Db, env))
      .resolves.toEqual({ probed: 1, dark: 0, suspended: 0 });
  });

  it('skips a catalogue row with no tenant — a platform preset has no seller to hold', async () => {
    const db = fakeDb([[listing('preset', null)]]);
    await expect(runHostedListingSweep(db as unknown as Db, env))
      .resolves.toEqual({ probed: 1, dark: 0, suspended: 0 });
    expect(probe).not.toHaveBeenCalled();
    expect(recordHostedProbe).not.toHaveBeenCalled();
  });

  it('skips — rather than darkens — a listing with no resolvable address', async () => {
    // That is a malformed listing, and the deployment harness already refuses to
    // publish one. Calling it abandoned would stop billing over a Stage bug.
    publishedSnapshot.mockResolvedValue({ title: 'App', objects: [] });
    const db = fakeDb([[listing('l1')]]);
    await expect(runHostedListingSweep(db as unknown as Db, env))
      .resolves.toEqual({ probed: 1, dark: 0, suspended: 0 });
    expect(recordHostedProbe).not.toHaveBeenCalled();
  });

  it('is bounded and ordered by staleness, so the untouched tail is never starved', async () => {
    const db = fakeDb([[]]);
    await runHostedListingSweep(db as unknown as Db, env);
    expect(db.calls[0]?.chain).toEqual(expect.arrayContaining(['where', 'orderBy', 'limit']));
  });

  it('keeps sweeping after one listing goes wrong in an unrelated way', async () => {
    publishedSnapshot
      .mockResolvedValueOnce(withAddress('https://one.test'))
      .mockResolvedValueOnce(withAddress('https://two.test'));
    probe
      .mockResolvedValueOnce({ url: 'https://one.test', root: 'breach', health: 'breach' })
      .mockResolvedValueOnce({ url: 'https://two.test', root: 'ok', health: 'ok' });
    hostedListingStatus.mockResolvedValue({ billable: true });
    const db = fakeDb([[listing('l1'), listing('l2')]]);

    await expect(runHostedListingSweep(db as unknown as Db, env))
      .resolves.toEqual({ probed: 2, dark: 1, suspended: 0 });
    expect(recordHostedProbe).toHaveBeenCalledTimes(2);
  });
});
