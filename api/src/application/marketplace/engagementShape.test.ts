/**
 * THE HOLE THIS COLUMN CLOSED.
 *
 * Before 0930 the escrow work gate inferred the engagement's shape from whether a
 * schedule existed, which is wrong in exactly the case the gate exists for: a
 * FIXED-PRICE engagement whose schedule was never written read as hourly and was never
 * gated. That is the state where a freelancer is most likely to start work nobody has
 * funded, so it is the one pinned hardest here.
 */
import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { ENGAGEMENT_SHAPES, hireShape, isEscrowGoverned } from './engagementShape';

vi.mock('../notifications/notify', () => ({ notify: vi.fn(async () => ({ inAppDelivered: true, emailDelivered: null })) }));
vi.mock('../integrations/payments', () => ({
  createPayout: vi.fn(async () => ({ configured: false, ok: false })),
  isPayoutsConfigured: vi.fn(() => false),
}));

const { workIsAuthorised, readEngagementSchedule } = await import('./milestones');

describe('hireShape', () => {
  it('accepts the vocabulary `job_postings.engagement_type` already uses', () => {
    for (const shape of ENGAGEMENT_SHAPES) expect(hireShape(shape)).toBe(shape);
  });

  it('normalises case and whitespace, because this crosses a request boundary', () => {
    expect(hireShape('  Fixed_Bid ')).toBe('fixed_bid');
  });

  it('returns null for anything unstated or unknown — a real answer, not a failure', () => {
    for (const value of [undefined, null, '', '   ', 'retainer', 42, {}]) {
      expect(hireShape(value)).toBeNull();
    }
  });
});

describe('isEscrowGoverned', () => {
  it('is true only for fixed-price work', () => {
    expect(isEscrowGoverned('fixed_bid')).toBe(true);
    expect(isEscrowGoverned('hourly')).toBe(false);
    expect(isEscrowGoverned('fte')).toBe(false);
    // An engagement predating 0930 has no recorded shape and keeps behaving as it did.
    expect(isEscrowGoverned(null)).toBe(false);
  });
});

describe('workIsAuthorised — reading the recorded shape rather than guessing', () => {
  it('REFUSES a fixed-price engagement whose schedule was never written', async () => {
    // The hole. Under the old inference this returned `not_fixed_price` and let work
    // start with nothing funded and nothing even agreed.
    const db = fakeDb([[], [{ engagementType: 'fixed_bid' }]]);

    expect(await workIsAuthorised(db as unknown as Db, 7, 'e-1'))
      .toEqual({ authorised: false, reason: 'no_milestones' });
  });

  it('refuses a fixed-price engagement whose schedule is entirely unfunded', async () => {
    const db = fakeDb([[{ status: 'draft', amountCents: 10_000 }], [{ engagementType: 'fixed_bid' }]]);

    expect(await workIsAuthorised(db as unknown as Db, 7, 'e-1'))
      .toEqual({ authorised: false, reason: 'nothing_funded' });
  });

  it('authorises once a milestone is funded', async () => {
    const db = fakeDb([[{ status: 'funded', amountCents: 10_000 }], [{ engagementType: 'fixed_bid' }]]);

    expect(await workIsAuthorised(db as unknown as Db, 7, 'e-1'))
      .toEqual({ authorised: true, reason: 'funded' });
  });

  it('does not gate hourly work, which is governed by timecards', async () => {
    const db = fakeDb([[], [{ engagementType: 'hourly' }]]);

    expect(await workIsAuthorised(db as unknown as Db, 7, 'e-1'))
      .toEqual({ authorised: true, reason: 'not_fixed_price' });
  });

  it('treats an engagement predating the column as ungated, so the migration changes nothing', async () => {
    const db = fakeDb([[], [{ engagementType: null }]]);

    expect(await workIsAuthorised(db as unknown as Db, 7, 'e-1'))
      .toEqual({ authorised: true, reason: 'not_fixed_price' });
  });

  it('treats a missing engagement as ungated rather than throwing', async () => {
    const db = fakeDb([[], []]);

    expect(await workIsAuthorised(db as unknown as Db, 7, 'nope'))
      .toEqual({ authorised: true, reason: 'not_fixed_price' });
  });
});

describe('readEngagementSchedule', () => {
  it('reports the same gate verdict the standalone check does', async () => {
    // Two callers, one decision — if these ever disagree, one surface shows an escrow
    // badge the other refuses to honour.
    const db = fakeDb([[], [{ engagementType: 'fixed_bid' }]]);

    const view = await readEngagementSchedule(db as unknown as Db, 7, 'e-1');

    expect(view.gate).toEqual({ authorised: false, reason: 'no_milestones' });
    expect(view.summary).toEqual({
      agreedCents: 0, heldCents: 0, releasedCents: 0, owedCents: 0, unfundedCents: 0,
    });
  });
});
