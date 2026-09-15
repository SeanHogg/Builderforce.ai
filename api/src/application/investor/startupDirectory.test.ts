/**
 * The startup directory's decidable rules (PRD 19 B2), asserted on pure
 * functions rather than against a database — each is a rule that fails a
 * customer rather than a build:
 *
 *   - A public URL's filters are dropped, never echoed: an unknown stage in the
 *     query string must not reach SQL.
 *   - The tier rule is ONE function. A visitor never sees cash, burn or the
 *     founder's contact; a signed-in reader sees the runway in months and the
 *     contact, and nothing else changes.
 *   - An inquiry with no message, no email or an unknown instrument is refused
 *     with a 400 the founder never sees.
 *   - The cache key depends on every filter and on nothing else.
 */
import { describe, expect, it } from 'vitest';
import { FUNDING_STAGES, LISTING_LIMITS } from '@builderforce/creation-canvas-contract';
import { filterHash, parseDirectoryFilters, toPublicProfile, validateInquiry } from './startupDirectory';
import { CompanyError } from './companyWorkspace';
import type { companies } from '../../infrastructure/database/schema';

const params = (query: string) => new URLSearchParams(query);

describe('parseDirectoryFilters — the query string, made safe', () => {
  it('keeps vocabulary values and drops the rest', () => {
    const filters = parseDirectoryFilters(params('stages=seed,SERIES_A,bogus&sectors=saas,nope&sort=funding'));
    expect(filters.stages).toEqual(['seed']);
    expect(filters.sectors).toEqual(['saas']);
    expect(filters.sort).toBe('funding');
  });

  it('falls back to the default sort and page for garbage', () => {
    const filters = parseDirectoryFilters(params('sort=DROP%20TABLE&page=-4&limit=abc'));
    expect(filters.sort).toBe('newest');
    expect(filters.page).toBe(1);
    expect(filters.limit).toBe(LISTING_LIMITS.pageDefault);
  });

  it('clamps the page size so a URL cannot ask for the whole table', () => {
    expect(parseDirectoryFilters(params('limit=10000')).limit).toBe(LISTING_LIMITS.pageMax);
  });

  it('reads the tri-state raising filter', () => {
    expect(parseDirectoryFilters(params('')).seekingInvestment).toBeNull();
    expect(parseDirectoryFilters(params('seekingInvestment=true')).seekingInvestment).toBe(true);
    expect(parseDirectoryFilters(params('seekingInvestment=false')).seekingInvestment).toBe(false);
  });

  it('accepts every funding stage the contract declares', () => {
    const filters = parseDirectoryFilters(params(`stages=${FUNDING_STAGES.join(',')}`));
    expect(filters.stages).toEqual([...FUNDING_STAGES]);
  });
});

describe('filterHash — one key per filter set', () => {
  it('is stable across value order and search case', () => {
    const a = parseDirectoryFilters(params('stages=seed,series_a&q=Acme'));
    const b = parseDirectoryFilters(params('stages=series_a,seed&q=acme'));
    expect(filterHash(a)).toBe(filterHash(b));
  });

  it('changes when a filter changes', () => {
    const a = parseDirectoryFilters(params('stages=seed'));
    const b = parseDirectoryFilters(params('stages=seed&page=2'));
    expect(filterHash(a)).not.toBe(filterHash(b));
  });
});

const row = (over: Partial<typeof companies.$inferSelect> = {}): typeof companies.$inferSelect => ({
  id: 7, tenantId: 3, objectId: null, name: 'Acme Robotics', slug: 'acme-robotics', website: 'https://acme.example',
  stage: 'seed', sector: 'ai_ml', country: 'US', foundedAt: new Date(Date.UTC(2024, 0, 1)), headcount: 6,
  crmOwnerRef: null, crmStatus: null, crmLastTouchedAt: null, arr: null, valuation: null, currency: 'USD',
  isPortfolio: false, attrs: null,
  tagline: 'Robots that file expenses', description: 'Long story.', logoUrl: null, businessStage: 'mvp',
  city: 'Troy', region: 'NY', foundersCount: 2, seeking: ['funding', 'advisors'], fundingGoal: '500000.00',
  totalFundingRaised: '120000.00', cashOnHand: '400000.00', monthlyBudget: '50000.00', monthlyRevenue: '10000.00',
  teamCost: '30000.00', financeDeclaredAt: new Date('2026-09-01T00:00:00Z'),
  isPubliclyListed: true, isSeekingInvestment: true, allowInvestorInquiries: true,
  investorContactName: 'Jane Founder', investorContactEmail: 'jane@acme.example',
  listedAt: new Date('2026-09-02T00:00:00Z'), createdAt: new Date('2026-08-01T00:00:00Z'), updatedAt: new Date('2026-09-03T00:00:00Z'),
  ...over,
});

describe('toPublicProfile — the ONE tier rule', () => {
  it('shows a visitor the health band and never the money behind it', () => {
    const card = toPublicProfile(row(), 'public', 3);
    expect(card.runwayHealth).toBe('watch');           // 400k / 40k = 10 months
    expect(card.runwayMonths).toBeNull();
    expect(card.investorContactEmail).toBeNull();
    expect(card.investorContactName).toBeNull();
    expect(card).not.toHaveProperty('cashOnHand');
    expect(card).not.toHaveProperty('monthlyBudget');
    expect(card.inquiryCount).toBe(3);
    expect(card.acceptsInquiries).toBe(true);
  });

  it('widens a signed-in reader to the months and the contact — nothing else', () => {
    const member = toPublicProfile(row(), 'member', 0);
    const visitor = toPublicProfile(row(), 'public', 0);
    expect(member.runwayMonths).toBe(10);
    expect(member.investorContactEmail).toBe('jane@acme.example');
    const { runwayMonths: _m, investorContactEmail: _e, investorContactName: _n, ...restMember } = member;
    const { runwayMonths: _m2, investorContactEmail: _e2, investorContactName: _n2, ...restVisitor } = visitor;
    expect(restMember).toEqual(restVisitor);
  });

  it('reports no runway at all when nothing was declared — not an infinite one', () => {
    const card = toPublicProfile(row({ financeDeclaredAt: null, cashOnHand: null, monthlyBudget: null }), 'member', 0);
    expect(card.runwayHealth).toBeNull();
    expect(card.runwayMonths).toBeNull();
  });

  it('hides the interest button when the company is not raising or has turned inquiries off', () => {
    expect(toPublicProfile(row({ isSeekingInvestment: false }), 'public', 0).acceptsInquiries).toBe(false);
    expect(toPublicProfile(row({ allowInvestorInquiries: false }), 'public', 0).acceptsInquiries).toBe(false);
  });
});

describe('validateInquiry — what an investor must say', () => {
  const good = { investorName: 'Ada Investor', investorEmail: 'ada@fund.example', message: 'We back robotics companies at seed and would like to talk.' };

  it('accepts a complete inquiry and keeps the optional answers as details', () => {
    const clean = validateInquiry({ ...good, investmentType: 'safe', timeframe: 'short_term', areasOfExpertise: ['fundraising', 'not-a-thing'], isAccredited: true, interestedAmount: 250000 });
    expect(clean.details.investmentType).toBe('safe');
    expect(clean.details.areasOfExpertise).toEqual(['fundraising']);
    expect(clean.details.isAccredited).toBe(true);
    expect(clean.interestedAmount).toBe(250000);
  });

  it('refuses a message shorter than the floor', () => {
    expect(() => validateInquiry({ ...good, message: 'hi' })).toThrow(CompanyError);
  });

  it('refuses an email that is not one', () => {
    expect(() => validateInquiry({ ...good, investorEmail: 'not-an-email' })).toThrow(CompanyError);
  });

  it('refuses an instrument the platform does not recognise', () => {
    expect(() => validateInquiry({ ...good, investmentType: 'crypto_handshake' })).toThrow(CompanyError);
  });

  it('refuses a negative amount', () => {
    expect(() => validateInquiry({ ...good, interestedAmount: -5 })).toThrow(CompanyError);
  });
});
