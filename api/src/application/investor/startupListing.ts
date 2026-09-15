/**
 * The founder's side of the startup listing (PRD 19 B2) — the facet writes.
 *
 * BurnRateOS's onboarding collected the business profile ("tell us about your
 * business"), the financial context ("your startup's numbers") and the visibility
 * preferences ("list my startup for investors to discover") as three steps, and
 * its final schema kept all three on `Company`. Here they are three WRITERS over
 * the one `companies` row, because they are three different kinds of fact with
 * three different consequences:
 *
 *   • {@link updateStartupListing} — the public profile. Descriptive; no gate.
 *   • {@link declareFinance}       — declared money, stamped with WHEN. Runway is
 *                                    derived from it and never stored (rule 3 of
 *                                    PRD 19 §9.7), so the stamp is what lets a
 *                                    reader judge how stale a number is.
 *   • {@link setListingVisibility} — the publish TRANSITION. It is the only writer
 *                                    of `is_publicly_listed` and `listed_at`, and it
 *                                    refuses an incomplete profile, so a directory
 *                                    card with no tagline is unrepresentable rather
 *                                    than merely unlikely (the same argument
 *                                    `publishLandingPage` makes in webSurface.ts).
 *
 * Every write bumps the directory's cache version, so a public reader never
 * serves a card the founder has just changed or withdrawn.
 */

import { and, eq, ne } from 'drizzle-orm';
import {
  BUSINESS_STAGES,
  FUNDING_STAGES,
  LISTING_LIMITS,
  SEEKING_TYPES,
  STARTUP_SECTORS,
  computeRunway,
  isBusinessStage,
  isFundingStage,
  isSeekingType,
  isStartupSector,
  slugify,
  type DeclaredFinance,
  type RunwayVerdict,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { companies } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { CompanyError, companyObjectId } from './companyWorkspace';
import { STARTUP_DIRECTORY_VERSION_KEY } from './startupDirectoryCache';
import { runwayVersionKey } from '../finance/runwayCache';

export const LISTING_VERBS = {
  updated: 'company.listing_updated',
  financeDeclared: 'company.finance_declared',
  listed: 'company.listed',
  unlisted: 'company.unlisted',
} as const;

const TARGET_TYPE = 'company';

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

/** The founder's own view of the facet — every field, none redacted. */
export interface StartupListingFacet {
  companyId: number;
  name: string;
  slug: string | null;
  website: string | null;
  tagline: string | null;
  description: string | null;
  logoUrl: string | null;
  stage: string | null;
  businessStage: string | null;
  sector: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  foundedAt: string | null;
  headcount: number | null;
  foundersCount: number | null;
  seeking: string[];
  fundingGoal: number | null;
  totalFundingRaised: number | null;
  finance: DeclaredFinance;
  runway: RunwayVerdict;
  isPubliclyListed: boolean;
  isSeekingInvestment: boolean;
  allowInvestorInquiries: boolean;
  investorContactName: string | null;
  investorContactEmail: string | null;
  listedAt: string | null;
  /** How complete the public profile is, and what is still missing. Derived. */
  completeness: ListingCompleteness;
}

export interface ListingCompleteness {
  percent: number;
  missing: string[];
}

/** The fields a card cannot render without. The publish gate and the progress
 *  meter read the SAME list, so they cannot disagree about what "complete" is. */
export const LISTING_REQUIRED_FIELDS = ['name', 'tagline', 'description', 'stage', 'sector', 'country'] as const;
/** The rest of what a good profile carries — counted, never required. */
export const LISTING_OPTIONAL_FIELDS = ['website', 'businessStage', 'city', 'foundedAt', 'headcount', 'foundersCount', 'seeking', 'finance'] as const;

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function listingCompleteness(facet: Pick<StartupListingFacet,
  'name' | 'tagline' | 'description' | 'stage' | 'sector' | 'country' | 'website' | 'businessStage' | 'city'
  | 'foundedAt' | 'headcount' | 'foundersCount' | 'seeking' | 'finance'>): ListingCompleteness {
  const present = (key: string): boolean => {
    switch (key) {
      case 'seeking': return facet.seeking.length > 0;
      case 'finance': return facet.finance.declaredAt != null;
      default: {
        const value = (facet as Record<string, unknown>)[key];
        return value !== null && value !== undefined && value !== '';
      }
    }
  };
  const missing = LISTING_REQUIRED_FIELDS.filter((key) => !present(key));
  const filled = [...LISTING_REQUIRED_FIELDS, ...LISTING_OPTIONAL_FIELDS].filter(present).length;
  const total = LISTING_REQUIRED_FIELDS.length + LISTING_OPTIONAL_FIELDS.length;
  return { percent: Math.round((filled / total) * 100), missing: [...missing] };
}

type CompanyRow = typeof companies.$inferSelect;

export function facetFromRow(row: CompanyRow): StartupListingFacet {
  const finance: DeclaredFinance = {
    cashOnHand: num(row.cashOnHand),
    monthlyBudget: num(row.monthlyBudget),
    monthlyRevenue: num(row.monthlyRevenue),
    teamCost: num(row.teamCost),
    declaredAt: iso(row.financeDeclaredAt),
  };
  const base = {
    companyId: row.id,
    name: row.name,
    slug: row.slug,
    website: row.website,
    tagline: row.tagline,
    description: row.description,
    logoUrl: row.logoUrl,
    stage: row.stage,
    businessStage: row.businessStage,
    sector: row.sector,
    city: row.city,
    region: row.region,
    country: row.country,
    foundedAt: iso(row.foundedAt),
    headcount: row.headcount,
    foundersCount: row.foundersCount,
    seeking: Array.isArray(row.seeking) ? row.seeking.filter(isSeekingType) : [],
    fundingGoal: num(row.fundingGoal),
    totalFundingRaised: num(row.totalFundingRaised),
    finance,
    runway: computeRunway(finance),
    isPubliclyListed: row.isPubliclyListed,
    isSeekingInvestment: row.isSeekingInvestment,
    allowInvestorInquiries: row.allowInvestorInquiries,
    investorContactName: row.investorContactName,
    investorContactEmail: row.investorContactEmail,
    listedAt: iso(row.listedAt),
  };
  return { ...base, completeness: listingCompleteness(base) };
}

async function companyRow(db: Db, tenantId: number, companyId: number): Promise<CompanyRow> {
  const [row] = await db
    .select()
    .from(companies)
    .where(scopedToTenant(companies, tenantId, eq(companies.id, companyId)))
    .limit(1);
  if (!row) throw new CompanyError('No company with that id in this workspace.', 404);
  return row;
}

export async function readStartupListing(db: Db, tenantId: number, companyId: number): Promise<StartupListingFacet> {
  return facetFromRow(await companyRow(db, tenantId, companyId));
}

// ---------------------------------------------------------------------------
// The profile write
// ---------------------------------------------------------------------------

export interface ListingPatch {
  name?: string;
  website?: string | null;
  tagline?: string | null;
  description?: string | null;
  logoUrl?: string | null;
  stage?: string | null;
  businessStage?: string | null;
  sector?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  foundedYear?: number | null;
  headcount?: number | null;
  foundersCount?: number | null;
  seeking?: string[];
  fundingGoal?: number | null;
  totalFundingRaised?: number | null;
  isSeekingInvestment?: boolean;
  allowInvestorInquiries?: boolean;
  investorContactName?: string | null;
  investorContactEmail?: string | null;
}

const clip = (v: string | null | undefined, max: number): string | null => {
  const trimmed = v?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

const money = (v: number | null | undefined, label: string): string | null => {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v) || v < 0) throw new CompanyError(`${label} must be zero or a positive amount.`, 400);
  return v.toFixed(2);
};

const count = (v: number | null | undefined, label: string, max: number): number | null => {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v < 0 || v > max) throw new CompanyError(`${label} must be a whole number between 0 and ${max}.`, 400);
  return v;
};

/**
 * Validate a patch against the shared vocabulary and the column bounds. Pure, so
 * the rejection the API gives is testable without a database — and so the same
 * rule can be asserted from the contract's own lists rather than restated.
 */
export function validateListingPatch(patch: ListingPatch): Partial<typeof companies.$inferInsert> {
  const values: Partial<typeof companies.$inferInsert> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new CompanyError('A company needs a name.', 400);
    if (name.length > LISTING_LIMITS.name) throw new CompanyError(`That name is longer than the column allows (${LISTING_LIMITS.name}).`, 400);
    values.name = name;
  }
  if (patch.website !== undefined) values.website = clip(patch.website, 255);
  if (patch.tagline !== undefined) values.tagline = clip(patch.tagline, LISTING_LIMITS.tagline);
  if (patch.description !== undefined) values.description = clip(patch.description, LISTING_LIMITS.description);
  if (patch.logoUrl !== undefined) values.logoUrl = clip(patch.logoUrl, 500);
  if (patch.stage !== undefined) {
    if (patch.stage !== null && !isFundingStage(patch.stage)) throw new CompanyError(`stage must be one of: ${FUNDING_STAGES.join(', ')}`, 400);
    values.stage = patch.stage;
  }
  if (patch.businessStage !== undefined) {
    if (patch.businessStage !== null && !isBusinessStage(patch.businessStage)) throw new CompanyError(`businessStage must be one of: ${BUSINESS_STAGES.join(', ')}`, 400);
    values.businessStage = patch.businessStage;
  }
  if (patch.sector !== undefined) {
    if (patch.sector !== null && !isStartupSector(patch.sector)) throw new CompanyError(`sector must be one of: ${STARTUP_SECTORS.join(', ')}`, 400);
    values.sector = patch.sector;
  }
  if (patch.city !== undefined) values.city = clip(patch.city, LISTING_LIMITS.city);
  if (patch.region !== undefined) values.region = clip(patch.region, LISTING_LIMITS.region);
  if (patch.country !== undefined) {
    const country = patch.country?.trim().toUpperCase() ?? '';
    if (country && !/^[A-Z]{2}$/.test(country)) throw new CompanyError('country must be a two-letter ISO code.', 400);
    values.country = country || null;
  }
  if (patch.foundedYear !== undefined) {
    if (patch.foundedYear === null) values.foundedAt = null;
    else {
      const year = patch.foundedYear;
      const thisYear = new Date().getUTCFullYear();
      if (!Number.isInteger(year) || year < 1800 || year > thisYear) throw new CompanyError(`foundedYear must be between 1800 and ${thisYear}.`, 400);
      values.foundedAt = new Date(Date.UTC(year, 0, 1));
    }
  }
  if (patch.headcount !== undefined) values.headcount = count(patch.headcount, 'headcount', 1_000_000);
  if (patch.foundersCount !== undefined) values.foundersCount = count(patch.foundersCount, 'foundersCount', 50);
  if (patch.seeking !== undefined) {
    const bad = patch.seeking.find((v) => !isSeekingType(v));
    if (bad !== undefined) throw new CompanyError(`seeking must be drawn from: ${SEEKING_TYPES.join(', ')}`, 400);
    values.seeking = [...new Set(patch.seeking)];
  }
  if (patch.fundingGoal !== undefined) values.fundingGoal = money(patch.fundingGoal, 'fundingGoal');
  if (patch.totalFundingRaised !== undefined) values.totalFundingRaised = money(patch.totalFundingRaised, 'totalFundingRaised');
  if (patch.isSeekingInvestment !== undefined) values.isSeekingInvestment = patch.isSeekingInvestment;
  if (patch.allowInvestorInquiries !== undefined) values.allowInvestorInquiries = patch.allowInvestorInquiries;
  if (patch.investorContactName !== undefined) values.investorContactName = clip(patch.investorContactName, LISTING_LIMITS.contactName);
  if (patch.investorContactEmail !== undefined) {
    const email = clip(patch.investorContactEmail, LISTING_LIMITS.contactEmail);
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new CompanyError('investorContactEmail must be an email address.', 400);
    values.investorContactEmail = email;
  }
  return values;
}

export async function updateStartupListing(
  db: Db,
  env: Env,
  tenantId: number,
  input: { companyId: number; patch: ListingPatch; actor: ActorIdentity },
): Promise<StartupListingFacet> {
  const current = await companyRow(db, tenantId, input.companyId);
  const values = validateListingPatch(input.patch);
  if (values.name && values.name !== current.name) {
    const [clash] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(scopedToTenant(companies, tenantId, eq(companies.name, values.name), ne(companies.id, current.id)))
      .limit(1);
    if (clash) throw new CompanyError('This workspace already has a company with that name.', 409);
    // A renamed company keeps a slug that still reads as the company, unless it
    // is live — a live URL is a promise, and renaming must not break it.
    if (!current.isPubliclyListed) values.slug = slugify(values.name, { maxLength: 200, fallback: 'company' });
  }
  if (Object.keys(values).length === 0) return facetFromRow(current);

  await db
    .update(companies)
    .set({ ...values, updatedAt: new Date() })
    .where(scopedToTenant(companies, tenantId, eq(companies.id, current.id)));

  const objectId = await companyObjectId(db, env, tenantId, current.id);
  await recordActivity(env, db, {
    tenantId,
    actor: input.actor,
    verb: LISTING_VERBS.updated,
    targetType: TARGET_TYPE,
    targetId: String(current.id),
    targetLabel: values.name ?? current.name,
    objectId,
    metadata: { fields: Object.keys(values) },
  });
  if (current.isPubliclyListed) await bumpCacheVersion(env, STARTUP_DIRECTORY_VERSION_KEY);
  return readStartupListing(db, tenantId, current.id);
}

// ---------------------------------------------------------------------------
// Declared finance
// ---------------------------------------------------------------------------

export interface DeclareFinanceInput {
  companyId: number;
  cashOnHand: number | null;
  monthlyBudget: number | null;
  monthlyRevenue: number | null;
  teamCost: number | null;
  actor: ActorIdentity;
}

/**
 * The founder's declared numbers, stamped with the moment they said so. Nothing
 * here is read from a ledger — `runwayReport.ts` prints the declared and the
 * observed side by side and names which is which.
 */
export async function declareFinance(db: Db, env: Env, tenantId: number, input: DeclareFinanceInput): Promise<StartupListingFacet> {
  const current = await companyRow(db, tenantId, input.companyId);
  const teamCost = money(input.teamCost, 'teamCost');
  const monthlyBudget = money(input.monthlyBudget, 'monthlyBudget');
  if (teamCost !== null && monthlyBudget !== null && Number(teamCost) > Number(monthlyBudget)) {
    throw new CompanyError('teamCost is part of monthlyBudget and cannot exceed it.', 400);
  }
  const now = new Date();
  await db
    .update(companies)
    .set({
      cashOnHand: money(input.cashOnHand, 'cashOnHand'),
      monthlyBudget,
      monthlyRevenue: money(input.monthlyRevenue, 'monthlyRevenue'),
      teamCost,
      financeDeclaredAt: now,
      updatedAt: now,
    })
    .where(scopedToTenant(companies, tenantId, eq(companies.id, current.id)));

  const objectId = await companyObjectId(db, env, tenantId, current.id);
  await recordActivity(env, db, {
    tenantId,
    actor: input.actor,
    verb: LISTING_VERBS.financeDeclared,
    targetType: TARGET_TYPE,
    targetId: String(current.id),
    targetLabel: current.name,
    objectId,
    metadata: { provenance: 'declared' },
  });
  await Promise.all([
    bumpCacheVersion(env, runwayVersionKey(tenantId)),
    current.isPubliclyListed ? bumpCacheVersion(env, STARTUP_DIRECTORY_VERSION_KEY) : Promise.resolve(),
  ]);
  return readStartupListing(db, tenantId, current.id);
}

// ---------------------------------------------------------------------------
// The publish transition
// ---------------------------------------------------------------------------

/**
 * List or withdraw. Listing REQUIRES the fields a card cannot render without and
 * resolves a slug unique among listed companies; withdrawing clears `listed_at`
 * so "listed since" can never show for a company that is not.
 */
export async function setListingVisibility(
  db: Db,
  env: Env,
  tenantId: number,
  input: { companyId: number; listed: boolean; actor: ActorIdentity },
): Promise<StartupListingFacet> {
  const current = await companyRow(db, tenantId, input.companyId);
  const now = new Date();
  if (input.listed) {
    const facet = facetFromRow(current);
    if (facet.completeness.missing.length > 0) {
      throw new CompanyError(`The listing is missing: ${facet.completeness.missing.join(', ')}.`, 400);
    }
    const slug = await publicSlugFor(db, current);
    await db
      .update(companies)
      .set({ isPubliclyListed: true, slug, listedAt: current.listedAt ?? now, updatedAt: now })
      .where(scopedToTenant(companies, tenantId, eq(companies.id, current.id)));
  } else {
    await db
      .update(companies)
      .set({ isPubliclyListed: false, listedAt: null, updatedAt: now })
      .where(scopedToTenant(companies, tenantId, eq(companies.id, current.id)));
  }

  const objectId = await companyObjectId(db, env, tenantId, current.id);
  await recordActivity(env, db, {
    tenantId,
    actor: input.actor,
    verb: input.listed ? LISTING_VERBS.listed : LISTING_VERBS.unlisted,
    targetType: TARGET_TYPE,
    targetId: String(current.id),
    targetLabel: current.name,
    objectId,
  });
  await bumpCacheVersion(env, STARTUP_DIRECTORY_VERSION_KEY);
  return readStartupListing(db, tenantId, current.id);
}

/**
 * The slug this company will be public under. Its own slug if no OTHER listed
 * company holds it; otherwise the first free `-2`, `-3`, … — the same dedupe
 * `TenantService.resolveUniqueSlug` applies to workspace slugs.
 */
async function publicSlugFor(db: Db, current: CompanyRow): Promise<string> {
  const base = current.slug || slugify(current.name, { maxLength: 190, fallback: 'company' });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [taken] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(acrossTenants(
        companies,
        'public_catalogue',
        and(eq(companies.isPubliclyListed, true), eq(companies.slug, candidate), ne(companies.id, current.id)),
      ))
      .limit(1);
    if (!taken) return candidate;
  }
  throw new CompanyError('A public address for this company could not be chosen. Rename it and try again.', 409);
}
