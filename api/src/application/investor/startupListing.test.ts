/**
 * The founder's listing writes, on their pure halves (PRD 19 B2).
 *
 *   - The publish gate and the completeness meter read the SAME required list,
 *     so a card the gate lets through can always render.
 *   - A patch is validated against the contract's vocabulary — a stage that is
 *     not one is a 400, and a founded year in the future is a 400.
 *   - Runway on the facet is DERIVED from the declared inputs by the shared
 *     formula, never read from a column.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeRunway } from '@builderforce/creation-canvas-contract';
import { CompanyError } from './companyWorkspace';
import { LISTING_REQUIRED_FIELDS, facetFromRow, listingCompleteness, validateListingPatch } from './startupListing';
import type { companies } from '../../infrastructure/database/schema';

const row = (over: Partial<typeof companies.$inferSelect> = {}): typeof companies.$inferSelect => ({
  id: 1, tenantId: 1, objectId: null, name: 'Acme', slug: 'acme', website: null, stage: 'seed', sector: 'saas', country: 'US',
  foundedAt: null, headcount: null, crmOwnerRef: null, crmStatus: null, crmLastTouchedAt: null, arr: null, valuation: null,
  currency: 'USD', isPortfolio: false, attrs: null, tagline: 'One line', description: 'The story', logoUrl: null,
  businessStage: null, city: null, region: null, foundersCount: null, seeking: null, fundingGoal: null, totalFundingRaised: null,
  cashOnHand: '900000.00', monthlyBudget: '100000.00', monthlyRevenue: '80000.00', teamCost: '60000.00',
  financeDeclaredAt: new Date('2026-09-01T00:00:00Z'), isPubliclyListed: false, isSeekingInvestment: false,
  allowInvestorInquiries: true, investorContactName: null, investorContactEmail: null, listedAt: null,
  createdAt: new Date(), updatedAt: new Date(), ...over,
});

describe('the completeness meter and the publish gate agree', () => {
  it('names every required field that is missing', () => {
    const facet = facetFromRow(row({ tagline: null, sector: null }));
    expect(facet.completeness.missing).toEqual(['tagline', 'sector']);
    expect(facet.completeness.percent).toBeLessThan(100);
  });

  it('reports nothing missing for a card that can render', () => {
    expect(facetFromRow(row()).completeness.missing).toEqual([]);
  });

  it('counts the required fields before the optional ones', () => {
    // A row with only the required six filled is more than half complete — the
    // optional eight are a bonus, not the bar.
    const bare = listingCompleteness({ ...facetFromRow(row({ cashOnHand: null, monthlyBudget: null, monthlyRevenue: null, teamCost: null, financeDeclaredAt: null })) });
    expect(bare.missing).toEqual([]);
    expect(bare.percent).toBe(Math.round((LISTING_REQUIRED_FIELDS.length / 14) * 100));
  });
});

describe('the facet derives its runway from the declared inputs', () => {
  afterEach(() => vi.useRealTimers());

  it('is cash over NET burn — 900k over (100k − 80k) is 45 months, not 9', () => {
    // `zeroCashDate` is measured from NOW, and the facet and the expectation each
    // read the clock: one millisecond between them failed the deploy. Pin it.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
    const facet = facetFromRow(row());
    expect(facet.runway.runwayMonths).toBe(45);
    expect(facet.runway).toEqual(computeRunway({ cashOnHand: 900_000, monthlyBudget: 100_000, monthlyRevenue: 80_000 }));
  });

  it('has no runway when revenue covers spend', () => {
    expect(facetFromRow(row({ monthlyRevenue: '150000.00' })).runway.health).toBe('profitable');
  });
});

describe('validateListingPatch — the vocabulary is the rule', () => {
  it('rejects a stage that is not one', () => {
    expect(() => validateListingPatch({ stage: 'PRE_SEED' })).toThrow(CompanyError);
  });

  it('rejects a founded year in the future and accepts one in the past', () => {
    expect(() => validateListingPatch({ foundedYear: new Date().getUTCFullYear() + 1 })).toThrow(CompanyError);
    expect(validateListingPatch({ foundedYear: 2020 }).foundedAt).toEqual(new Date(Date.UTC(2020, 0, 1)));
  });

  it('uppercases a country code and refuses a name', () => {
    expect(validateListingPatch({ country: 'us' }).country).toBe('US');
    expect(() => validateListingPatch({ country: 'United States' })).toThrow(CompanyError);
  });

  it('dedupes and validates what the company is seeking', () => {
    expect(validateListingPatch({ seeking: ['funding', 'funding', 'advisors'] }).seeking).toEqual(['funding', 'advisors']);
    expect(() => validateListingPatch({ seeking: ['unicorns'] })).toThrow(CompanyError);
  });

  it('refuses a negative funding goal and an email that is not one', () => {
    expect(() => validateListingPatch({ fundingGoal: -1 })).toThrow(CompanyError);
    expect(() => validateListingPatch({ investorContactEmail: 'nope' })).toThrow(CompanyError);
  });

  it('writes nothing for an empty patch', () => {
    expect(validateListingPatch({})).toEqual({});
  });
});
