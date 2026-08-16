/**
 * A hosted app's agent-run cost, debited against the seller who publishes it.
 *
 * Unit tests over the decision logic with the database doubled — what matters is
 * never "the query ran" but "the right delta was charged, once" and "a listing
 * with no project behind it is left alone".
 */

import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import {
  chargeAppMaintenanceCost,
  sellerMaintenanceCostCents,
} from './appMaintenanceCost';

describe('chargeAppMaintenanceCost', () => {
  it('does nothing for a listing with no project behind it', async () => {
    // hostedListingProjectId finds no `app` link — not a hosted app.
    const db = fakeDb([[]]);

    await chargeAppMaintenanceCost(db as unknown as Db, 'cat-1', 7, 'u1', 'Space Game');

    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]!.kind).toBe('select');
  });

  it('charges the accrued delta since the last charge, and stamps an idempotent reference', async () => {
    const db = fakeDb([
      [{ projectId: 42 }],              // hostedListingProjectId
      [{ totalMillicents: '3000000' }], // sumProjectAgentCostCents -> 3000 cents accrued
      [{ total: '500' }],               // alreadyChargedCents -> 500 cents already charged
      [],                               // the insert
    ]);

    await chargeAppMaintenanceCost(db as unknown as Db, 'cat-1', 7, 'u1', 'Space Game');

    expect(db.calls).toHaveLength(4);
    const insertCall = db.calls[3]!;
    expect(insertCall.kind).toBe('insert');
    expect(insertCall.payload).toMatchObject({
      tenantId: 7,
      accountKind: 'user',
      accountRef: 'u1',
      denomination: 'usd_cents',
      entryKind: 'maintenance_cost',
      // 3000 accrued - 500 already charged = 2500 debited, as a negative amount.
      amount: '-2500',
      reference: 'mp-maint:cat-1:3000',
    });
    expect(insertCall.chain).toContain('onConflictDoNothing');
  });

  it('charges nothing once the accrued cost has already been fully charged', async () => {
    const db = fakeDb([
      [{ projectId: 42 }],
      [{ totalMillicents: '3000000' }], // 3000 cents accrued
      [{ total: '3000' }],              // 3000 cents already charged — delta is zero
    ]);

    await chargeAppMaintenanceCost(db as unknown as Db, 'cat-1', 7, 'u1', 'Space Game');

    expect(db.calls).toHaveLength(3);
    expect(db.calls.some((c) => c.kind === 'insert')).toBe(false);
  });
});

describe('sellerMaintenanceCostCents', () => {
  it('sums the maintenance-cost debits already charged against this seller', async () => {
    const db = fakeDb([[{ total: '1800' }]]);

    const cents = await sellerMaintenanceCostCents(db as unknown as Db, 7, 'u1');

    expect(cents).toBe(1800);
  });

  it('reads zero for a seller with no hosted apps charged yet', async () => {
    const db = fakeDb([[{ total: '0' }]]);

    const cents = await sellerMaintenanceCostCents(db as unknown as Db, 7, 'u1');

    expect(cents).toBe(0);
  });
});
