/**
 * THE PRICING CONTRACT — the arithmetic a customer is charged by.
 *
 * Everything asserted here is pure and is the reason it is pure: `parseExtensionPlans`
 * reads untrusted vendor JSON and `meteredChargeCents` turns a count into a charge on a
 * real invoice. Both are exercised through the same functions the checkout and the
 * billing sweep call, so a change that would silently re-price a customer fails here.
 */

import { describe, expect, it } from 'vitest';
import {
  isPlanCode,
  meteredChargeCents,
  parseExtensionPlans,
  planMeters,
  mayCharge,
  subscriptionEntitles,
  type ExtensionPlan,
} from './extensionContract';
import { findPlan, fromCentsOf, listingSlugFor } from './extensionPlans';

const plan = (over: Partial<ExtensionPlan> = {}): ExtensionPlan => ({
  code: 'pro',
  name: 'Pro',
  description: null,
  priceCents: 900,
  interval: 'month',
  includedUnits: 0,
  meteredRateCents: 0,
  unitLabel: 'call',
  ...over,
});

describe('parseExtensionPlans — untrusted vendor JSON', () => {
  it('keeps a well-formed plan and normalizes its code', () => {
    const [p] = parseExtensionPlans([{ code: '  PRO  ', name: 'Pro', priceCents: 900 }]);
    expect(p?.code).toBe('pro');
    expect(p?.priceCents).toBe(900);
    expect(p?.interval).toBe('month');
  });

  it('drops a plan that charges nothing either way', () => {
    // Not a plan — it is the free listing the package already is, and offering it
    // as one puts a checkout button in front of a transaction with no money in it.
    expect(parseExtensionPlans([{ code: 'free', name: 'Free', priceCents: 0 }])).toEqual([]);
  });

  it('keeps a pure usage-based plan (no recurring price, a metered rate)', () => {
    const [p] = parseExtensionPlans([{ code: 'usage', name: 'Usage', priceCents: 0, meteredRateCents: 2 }]);
    expect(p?.priceCents).toBe(0);
    expect(planMeters(p!)).toBe(true);
  });

  it('refuses a negative price rather than treating it as a discount', () => {
    // A negative price is not a cheaper plan — it is a refund the buyer did not
    // ask for, and it would invert the seller's earning into a debt.
    const [p] = parseExtensionPlans([{ code: 'bad', name: 'Bad', priceCents: -5_000, meteredRateCents: 1 }]);
    expect(p?.priceCents).toBe(0);
  });

  it('floors a fractional price rather than storing a fraction of a cent', () => {
    const [p] = parseExtensionPlans([{ code: 'odd', name: 'Odd', priceCents: 12.9 }]);
    expect(p?.priceCents).toBe(12);
  });

  it('drops entries that are not objects, are unnamed, or have an illegal code', () => {
    expect(parseExtensionPlans([
      null,
      'nope',
      { code: 'ok', priceCents: 100 },              // no name
      { code: 'Has Spaces', name: 'X', priceCents: 100 },
      { code: 'x', name: 'Too short a code', priceCents: 100 },
    ])).toEqual([]);
  });

  it('keeps the FIRST of two plans sharing a code', () => {
    // A duplicate code would make "which plan is this install on?" ambiguous, and
    // `plan_code` is a single column.
    const parsed = parseExtensionPlans([
      { code: 'pro', name: 'First', priceCents: 900 },
      { code: 'pro', name: 'Second', priceCents: 9_900 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe('First');
  });

  it('reads anything that is not an array as no plans at all', () => {
    expect(parseExtensionPlans(undefined)).toEqual([]);
    expect(parseExtensionPlans({ plans: [] })).toEqual([]);
  });

  it('defaults the unit label rather than leaving an invoice line saying "units"', () => {
    const [p] = parseExtensionPlans([{ code: 'usage', name: 'U', meteredRateCents: 5 }]);
    expect(p?.unitLabel).toBe('unit');
  });
});

describe('meteredChargeCents', () => {
  it('charges nothing on a plan that does not meter', () => {
    expect(meteredChargeCents(plan(), 10_000)).toBe(0);
  });

  it('subtracts the included allowance BEFORE pricing', () => {
    // The only reading of "included" a customer would accept. Subtracting after
    // would bill the allowance and then discount it, which is a different number.
    const p = plan({ includedUnits: 1_000, meteredRateCents: 2 });
    expect(meteredChargeCents(p, 1_000)).toBe(0);
    expect(meteredChargeCents(p, 1_500)).toBe(1_000);
  });

  it('never returns a negative charge for usage inside the allowance', () => {
    expect(meteredChargeCents(plan({ includedUnits: 500, meteredRateCents: 7 }), 100)).toBe(0);
  });

  it('ignores a fractional unit count', () => {
    expect(meteredChargeCents(plan({ meteredRateCents: 10 }), 3.9)).toBe(30);
  });
});

describe('fromCentsOf — what the directory may quote', () => {
  it('is the cheapest RECURRING price', () => {
    expect(fromCentsOf([plan({ code: 'a', priceCents: 2_900 }), plan({ code: 'b', priceCents: 900 })])).toBe(900);
  });

  it('is null when every plan is pure usage-based', () => {
    // A $0/month plan that meters at 2¢ a call is not a "from $0" listing in any
    // sense a buyer would accept, and quoting it as one is how a listing lies.
    expect(fromCentsOf([plan({ priceCents: 0, meteredRateCents: 2 })])).toBeNull();
  });

  it('is null for a free package', () => {
    expect(fromCentsOf([])).toBeNull();
  });
});

describe('findPlan and the codes', () => {
  it('resolves a code and refuses a missing or null one', () => {
    const plans = [plan({ code: 'pro' })];
    expect(findPlan(plans, 'pro')?.name).toBe('Pro');
    expect(findPlan(plans, 'enterprise')).toBeNull();
    expect(findPlan(plans, null)).toBeNull();
  });

  it('accepts codes a URL and a metadata value can both carry', () => {
    expect(isPlanCode('pro')).toBe(true);
    expect(isPlanCode('pay-as-you-go')).toBe(true);
    expect(isPlanCode('Pro')).toBe(false);
    expect(isPlanCode('pro ')).toBe(false);
    expect(isPlanCode('a')).toBe(false);
  });

  it('derives one catalogue slug per package, never storing it twice', () => {
    expect(listingSlugFor('acme-payroll')).toBe('ext-acme-payroll');
  });
});

describe('the two gates the money hangs on', () => {
  it('mayCharge requires identity verification (PRD 24 §9 decision 2)', () => {
    // ONE predicate, called by BOTH the price-setting gate and the review gate.
    // If this changes, both move together — which is the whole point of it
    // being a function rather than a comparison written twice.
    expect(mayCharge('identity_verified')).toBe(true);
    expect(mayCharge('domain_verified')).toBe(false);
    expect(mayCharge('unverified')).toBe(false);
    expect(mayCharge('none')).toBe(false);
    expect(mayCharge('nonsense')).toBe(false);
  });

  it('a past-due install keeps working; a cancelled one does not', () => {
    // Switching somebody's payroll integration off the hour their card expired
    // loses the marketplace the customer AND the vendor.
    expect(subscriptionEntitles('active')).toBe(true);
    expect(subscriptionEntitles('past_due')).toBe(true);
    expect(subscriptionEntitles('cancelled')).toBe(false);
    // `none` is a FREE install and is not entitled BY A SUBSCRIPTION — every
    // caller checks `state !== 'none'` first, so this must not read as true.
    expect(subscriptionEntitles('none')).toBe(false);
  });
});
