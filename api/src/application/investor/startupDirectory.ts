/**
 * The public startup directory (PRD 19 B2) — the reads a visitor with no session
 * makes, and the one write they are allowed: expressing interest.
 *
 * ── WHAT IT IS ───────────────────────────────────────────────────────────────
 * BurnRateOS's `/businesses` directory and `/businesses/:slug` profile, merged
 * onto the marketplace's `company` family (`/marketplace?family=company`) and
 * `/marketplace/company/<slug>`. The rows are the CEO's `companies`, filtered to
 * `is_publicly_listed` — the ONE cross-tenant read this module makes, declared
 * with `acrossTenants(…, 'public_catalogue', …)` because a directory that only
 * showed you your own company would not be a directory.
 *
 * ── WHAT A STRANGER MAY SEE ──────────────────────────────────────────────────
 * Two tiers, decided by the caller and applied by {@link toPublicProfile}:
 *   • `public`  — a visitor. The profile, the stage, the sector, whether the
 *                 company is raising and its runway HEALTH. Never cash on hand,
 *                 never burn, never the founder's contact.
 *   • `member`  — any signed-in person. Adds the runway in months and the
 *                 investor contact, which is what "express interest" hands you.
 * BurnRateOS had a third tier for accredited investors that unlocked terms; the
 * platform's investor GRANT (`companyInvestorAccess.ts`) is that tier, and it
 * opens a data room rather than a paragraph, so it is not re-modelled here.
 *
 * ── THE WRITE ────────────────────────────────────────────────────────────────
 * "Express interest" is inbound deal flow in the FOUNDER's tenant — the same row
 * the CRO's queue triages, with `source = 'investor_inquiry'` and the company it
 * names in `subject_company_id`. BurnRateOS wrote an inquiry row AND a CRM deal;
 * one row that IS the queue item is the merge. The founder is notified in-app.
 */

import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  DIRECTORY_SORTS,
  LISTING_LIMITS,
  computeRunway,
  isBusinessStage,
  isDirectorySort,
  isExpertiseArea,
  isFundingStage,
  isInquiryTimeframe,
  isInvestmentType,
  isSeekingType,
  isStartupSector,
  type BusinessStage,
  type DirectorySort,
  type FundingStage,
  type RunwayVerdict,
  type StartupSector,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { companies, investmentOpportunities, tenantMembers } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { fnv1a32 } from '../../domain/shared/strings';
import { notify } from '../notifications/notify';
import { INVESTOR_INQUIRY_SOURCE, publicInquiryCounts, recordDealFlow } from '../sales/revenueIntelligence';
import { CompanyError } from './companyWorkspace';
import {
  STARTUP_DIRECTORY_TTL_SECONDS,
  STARTUP_DIRECTORY_VERSION_KEY,
  startupBrowseCacheKey,
  startupProfileCacheKey,
} from './startupDirectoryCache';

export type ViewerTier = 'public' | 'member';

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface DirectoryFilters {
  search: string;
  stages: FundingStage[];
  businessStages: BusinessStage[];
  sectors: StartupSector[];
  seeking: string[];
  seekingInvestment: boolean | null;
  sort: DirectorySort;
  page: number;
  limit: number;
}

const csv = (value: string | null): string[] =>
  (value ?? '').split(',').map((v) => v.trim()).filter(Boolean);

/**
 * The query string, made safe. Pure: every unknown value is dropped rather than
 * echoed into SQL, and paging is clamped so a public URL cannot ask for the
 * whole table.
 */
export function parseDirectoryFilters(params: URLSearchParams): DirectoryFilters {
  const page = Math.max(1, Math.floor(Number(params.get('page') || '1')) || 1);
  const limitRaw = Math.floor(Number(params.get('limit') || String(LISTING_LIMITS.pageDefault)));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(LISTING_LIMITS.pageMax, limitRaw) : LISTING_LIMITS.pageDefault;
  const sortRaw = params.get('sort');
  const seekingRaw = params.get('seekingInvestment');
  return {
    search: (params.get('q') ?? params.get('search') ?? '').trim().slice(0, 120),
    stages: csv(params.get('stages')).filter(isFundingStage),
    businessStages: csv(params.get('businessStages')).filter(isBusinessStage),
    sectors: csv(params.get('sectors')).filter(isStartupSector),
    seeking: csv(params.get('seeking')).filter(isSeekingType),
    seekingInvestment: seekingRaw === null ? null : seekingRaw === 'true',
    sort: isDirectorySort(sortRaw) ? sortRaw : DIRECTORY_SORTS[0],
    page,
    limit,
  };
}

/** A short, stable key for a filter set — the cache key's tail. */
export function filterHash(filters: DirectoryFilters): string {
  const canonical = JSON.stringify([
    filters.search.toLowerCase(), [...filters.stages].sort(), [...filters.businessStages].sort(),
    [...filters.sectors].sort(), [...filters.seeking].sort(), filters.seekingInvestment, filters.sort,
    filters.page, filters.limit,
  ]);
  return fnv1a32(canonical).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// The public shapes
// ---------------------------------------------------------------------------

export interface StartupCard {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  logoUrl: string | null;
  website: string | null;
  stage: string | null;
  businessStage: string | null;
  sector: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  foundedYear: number | null;
  headcount: number | null;
  foundersCount: number | null;
  seeking: string[];
  isSeekingInvestment: boolean;
  acceptsInquiries: boolean;
  fundingGoal: number | null;
  totalFundingRaised: number | null;
  /** Declared MRR, public: BurnRateOS showed it on the card and so does this. */
  monthlyRevenue: number | null;
  /** Health for everyone; months only for a signed-in reader. */
  runwayHealth: RunwayVerdict['health'] | null;
  runwayMonths: number | null;
  inquiryCount: number;
  listedAt: string | null;
  updatedAt: string;
}

export interface StartupProfile extends StartupCard {
  viewer: ViewerTier;
  investorContactName: string | null;
  investorContactEmail: string | null;
  openRounds: Array<{ name: string; round: string | null; askAmount: number | null; currency: string; status: string }>;
  /** Whether the declared finance has ever been entered — the reader deserves to
   *  know a null runway means "not declared" and not "infinite". */
  financeDeclaredAt: string | null;
}

export interface DirectoryPage {
  startups: StartupCard[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

type CompanyRow = typeof companies.$inferSelect;

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * One company row, redacted for the reader. The ONLY place the tier rule lives:
 * the directory and the profile both go through it, so neither can leak a field
 * the other hides.
 */
export function toPublicProfile(row: CompanyRow, viewer: ViewerTier, inquiryCount: number): StartupCard & Pick<StartupProfile, 'investorContactName' | 'investorContactEmail' | 'financeDeclaredAt'> {
  const finance = {
    cashOnHand: num(row.cashOnHand),
    monthlyBudget: num(row.monthlyBudget),
    monthlyRevenue: num(row.monthlyRevenue),
  };
  const declared = row.financeDeclaredAt != null;
  const runway = declared ? computeRunway(finance) : null;
  const member = viewer === 'member';
  return {
    slug: row.slug ?? String(row.id),
    name: row.name,
    tagline: row.tagline ?? '',
    description: row.description ?? '',
    logoUrl: row.logoUrl,
    website: row.website,
    stage: row.stage,
    businessStage: row.businessStage,
    sector: row.sector,
    city: row.city,
    region: row.region,
    country: row.country,
    foundedYear: row.foundedAt ? row.foundedAt.getUTCFullYear() : null,
    headcount: row.headcount,
    foundersCount: row.foundersCount,
    seeking: Array.isArray(row.seeking) ? row.seeking.filter(isSeekingType) : [],
    isSeekingInvestment: row.isSeekingInvestment,
    acceptsInquiries: row.isSeekingInvestment && row.allowInvestorInquiries,
    fundingGoal: num(row.fundingGoal),
    totalFundingRaised: num(row.totalFundingRaised),
    monthlyRevenue: finance.monthlyRevenue,
    runwayHealth: runway?.health ?? null,
    runwayMonths: member && runway ? runway.runwayMonths : null,
    inquiryCount,
    listedAt: row.listedAt ? row.listedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
    investorContactName: member ? row.investorContactName : null,
    investorContactEmail: member ? row.investorContactEmail : null,
    financeDeclaredAt: row.financeDeclaredAt ? row.financeDeclaredAt.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Browse
// ---------------------------------------------------------------------------

const LISTED = eq(companies.isPubliclyListed, true);

function whereFor(filters: DirectoryFilters): SQL {
  const conditions: Array<SQL | undefined> = [LISTED];
  if (filters.search) {
    const like = `%${filters.search.replace(/[%_]/g, '')}%`;
    conditions.push(or(ilike(companies.name, like), ilike(companies.tagline, like), ilike(companies.description, like)));
  }
  if (filters.stages.length) conditions.push(inArray(companies.stage, filters.stages));
  if (filters.businessStages.length) conditions.push(inArray(companies.businessStage, filters.businessStages));
  if (filters.sectors.length) conditions.push(inArray(companies.sector, filters.sectors));
  if (filters.seekingInvestment !== null) conditions.push(eq(companies.isSeekingInvestment, filters.seekingInvestment));
  if (filters.seeking.length) {
    // `seeking` is a JSON array of vocabulary values; "any of" is a containment
    // test per value, OR'd — the same shape a tags filter takes everywhere else.
    conditions.push(or(...filters.seeking.map((value) => sql`${companies.seeking} @> ${JSON.stringify([value])}::jsonb`)));
  }
  return and(...conditions.filter((c): c is SQL => c !== undefined)) as SQL;
}

function orderFor(sort: DirectorySort): SQL[] {
  switch (sort) {
    case 'alphabetical': return [asc(companies.name)];
    case 'funding': return [desc(sql`COALESCE(${companies.totalFundingRaised}, 0)`), desc(companies.listedAt)];
    // Longest declared runway first. Not-burning companies (revenue ≥ spend) have
    // no runway in months and sort FIRST — they are the healthiest, not the least.
    case 'runway': return [
      desc(sql`CASE WHEN ${companies.financeDeclaredAt} IS NULL THEN -1
                    WHEN COALESCE(${companies.monthlyBudget},0) - COALESCE(${companies.monthlyRevenue},0) <= 0 THEN 1e12
                    ELSE COALESCE(${companies.cashOnHand},0) / (COALESCE(${companies.monthlyBudget},0) - COALESCE(${companies.monthlyRevenue},0)) END`),
      desc(companies.listedAt),
    ];
    case 'newest':
    default: return [desc(companies.listedAt), desc(companies.id)];
  }
}

/**
 * One page of the directory. Cached under the directory's version token plus a
 * hash of the filters — a founder's write bumps the token and every page goes
 * with it, so a withdrawn company is never served from a warm key.
 */
export async function browseStartups(db: Db, env: Env | undefined, filters: DirectoryFilters): Promise<DirectoryPage> {
  const load = () => loadDirectoryPage(db, filters);
  if (!env) return load();
  const version = await getCacheVersion(env, STARTUP_DIRECTORY_VERSION_KEY);
  return getOrSetCached(env, startupBrowseCacheKey(version, filterHash(filters)), load, { kvTtlSeconds: STARTUP_DIRECTORY_TTL_SECONDS });
}

async function loadDirectoryPage(db: Db, filters: DirectoryFilters): Promise<DirectoryPage> {
  const where = whereFor(filters);
  const offset = (filters.page - 1) * filters.limit;
  const [rows, [counted]] = await Promise.all([
    db.select().from(companies)
      .where(acrossTenants(companies, 'public_catalogue', where))
      .orderBy(...orderFor(filters.sort))
      .limit(filters.limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(companies)
      .where(acrossTenants(companies, 'public_catalogue', where)),
  ]);
  const counts = await publicInquiryCounts(db, rows.map((row) => row.id));
  const total = counted?.total ?? 0;
  return {
    startups: rows.map((row) => stripMemberFields(toPublicProfile(row, 'public', counts.get(row.id) ?? 0))),
    total,
    page: filters.page,
    limit: filters.limit,
    totalPages: Math.max(1, Math.ceil(total / filters.limit)),
  };
}

/** The card shape carries no contact fields at all — not null ones. */
function stripMemberFields(profile: ReturnType<typeof toPublicProfile>): StartupCard {
  const { investorContactName: _n, investorContactEmail: _e, financeDeclaredAt: _d, ...card } = profile;
  return card;
}

// ---------------------------------------------------------------------------
// One profile
// ---------------------------------------------------------------------------

const OPEN_ROUND_STATUSES = ['sourced', 'screening', 'diligence', 'ic'] as const;

/**
 * One listed company by its public slug, for a reader at `viewer` tier.
 *
 * The cached unit is the FULL row plus its rounds and count; redaction happens
 * after the cache read, so the two tiers share one entry rather than the member
 * tier having its own copy that a withdrawal could miss.
 */
export async function startupBySlug(db: Db, env: Env | undefined, slug: string, viewer: ViewerTier): Promise<StartupProfile | null> {
  const clean = slug.trim().toLowerCase().slice(0, 200);
  if (!clean) return null;
  const load = () => loadListedCompany(db, clean);
  const bundle = env
    ? await getOrSetCached(
      env,
      startupProfileCacheKey(await getCacheVersion(env, STARTUP_DIRECTORY_VERSION_KEY), clean),
      load,
      { kvTtlSeconds: STARTUP_DIRECTORY_TTL_SECONDS },
    )
    : await load();
  if (!bundle) return null;
  // KV round-trips dates as strings; rebuild them before the mapper reads them.
  const row = reviveDates(bundle.row);
  return {
    ...toPublicProfile(row, viewer, bundle.inquiryCount),
    viewer,
    openRounds: bundle.openRounds,
  };
}

interface ListedCompanyBundle {
  row: CompanyRow;
  inquiryCount: number;
  openRounds: StartupProfile['openRounds'];
}

async function loadListedCompany(db: Db, slug: string): Promise<ListedCompanyBundle | null> {
  const [row] = await db
    .select()
    .from(companies)
    .where(acrossTenants(companies, 'public_catalogue', and(LISTED, eq(companies.slug, slug))))
    .limit(1);
  if (!row) return null;
  const [counts, rounds] = await Promise.all([
    publicInquiryCounts(db, [row.id]),
    db
      .select({
        name: investmentOpportunities.name,
        round: investmentOpportunities.round,
        askAmount: investmentOpportunities.askAmount,
        currency: investmentOpportunities.currency,
        status: investmentOpportunities.status,
      })
      .from(investmentOpportunities)
      // The round belongs to the listed company's own tenant; the company row
      // above is what authorises reading it, so the predicate carries both.
      .where(acrossTenants(
        investmentOpportunities,
        'public_catalogue',
        and(
          eq(investmentOpportunities.tenantId, row.tenantId),
          eq(investmentOpportunities.companyId, row.id),
          inArray(investmentOpportunities.status, [...OPEN_ROUND_STATUSES]),
        ),
      ))
      .orderBy(desc(investmentOpportunities.updatedAt))
      .limit(5),
  ]);
  return {
    row,
    inquiryCount: counts.get(row.id) ?? 0,
    openRounds: rounds.map((r) => ({ name: r.name, round: r.round, askAmount: num(r.askAmount), currency: r.currency, status: r.status })),
  };
}

const DATE_COLUMNS = ['foundedAt', 'listedAt', 'financeDeclaredAt', 'createdAt', 'updatedAt', 'crmLastTouchedAt'] as const;

function reviveDates(row: CompanyRow): CompanyRow {
  const out: Record<string, unknown> = { ...row };
  for (const key of DATE_COLUMNS) {
    const value = out[key];
    if (typeof value === 'string') out[key] = new Date(value);
  }
  return out as CompanyRow;
}

// ---------------------------------------------------------------------------
// Express interest
// ---------------------------------------------------------------------------

export interface InquiryInput {
  investorName: string;
  investorEmail: string;
  investorCompany?: string | null;
  investorTitle?: string | null;
  investorPhone?: string | null;
  interestedAmount?: number | null;
  investmentType?: string | null;
  timeframe?: string | null;
  isAccredited?: boolean;
  areasOfExpertise?: string[];
  investmentHistory?: string | null;
  message: string;
}

export interface InquiryReceipt {
  id: number;
  companyName: string;
  status: string;
  createdAt: string;
}

const clip = (v: string | null | undefined, max: number): string | null => {
  const t = v?.trim();
  return t ? t.slice(0, max) : null;
};

/** Validate an inquiry against the vocabulary. Pure; the route calls it, tests assert it. */
export function validateInquiry(input: InquiryInput): Required<Pick<InquiryInput, 'investorName' | 'investorEmail' | 'message'>> & {
  details: Record<string, unknown>;
  investorCompany: string | null;
  interestedAmount: number | null;
} {
  const investorName = clip(input.investorName, 160);
  const investorEmail = clip(input.investorEmail, 320);
  const message = clip(input.message, LISTING_LIMITS.inquiryMessageMax);
  if (!investorName) throw new CompanyError('Please tell the founder who you are.', 400);
  if (!investorEmail || !/^\S+@\S+\.\S+$/.test(investorEmail)) throw new CompanyError('A reachable email address is required.', 400);
  if (!message || message.length < LISTING_LIMITS.inquiryMessageMin) {
    throw new CompanyError(`Say a little more — at least ${LISTING_LIMITS.inquiryMessageMin} characters.`, 400);
  }
  if (input.investmentType != null && input.investmentType !== '' && !isInvestmentType(input.investmentType)) {
    throw new CompanyError('investmentType is not one this platform recognises.', 400);
  }
  if (input.timeframe != null && input.timeframe !== '' && !isInquiryTimeframe(input.timeframe)) {
    throw new CompanyError('timeframe is not one this platform recognises.', 400);
  }
  const interestedAmount = input.interestedAmount == null ? null : Number(input.interestedAmount);
  if (interestedAmount !== null && (!Number.isFinite(interestedAmount) || interestedAmount < 0)) {
    throw new CompanyError('interestedAmount must be zero or a positive amount.', 400);
  }
  const details: Record<string, unknown> = {
    investorTitle: clip(input.investorTitle, 160),
    investorPhone: clip(input.investorPhone, 40),
    investmentType: input.investmentType || null,
    timeframe: input.timeframe || null,
    isAccredited: input.isAccredited === true,
    areasOfExpertise: (input.areasOfExpertise ?? []).filter(isExpertiseArea),
    investmentHistory: clip(input.investmentHistory, 2000),
  };
  return { investorName, investorEmail, message, details, investorCompany: clip(input.investorCompany, 255), interestedAmount };
}

/**
 * An investor expresses interest in a listed company. Writes ONE deal-flow row in
 * the founder's tenant and notifies every owner/manager there; refuses when the
 * company is not raising or has turned inquiries off — the card never shows the
 * button in that state, but a URL is not a card.
 */
export async function submitInvestorInquiry(db: Db, env: Env, slug: string, input: InquiryInput): Promise<InquiryReceipt> {
  const clean = validateInquiry(input);
  const [company] = await db
    .select({ id: companies.id, tenantId: companies.tenantId, name: companies.name, isSeekingInvestment: companies.isSeekingInvestment, allowInvestorInquiries: companies.allowInvestorInquiries })
    .from(companies)
    .where(acrossTenants(companies, 'public_catalogue', and(LISTED, eq(companies.slug, slug.trim().toLowerCase()))))
    .limit(1);
  if (!company) throw new CompanyError('That company is not listed.', 404);
  if (!company.isSeekingInvestment || !company.allowInvestorInquiries) {
    throw new CompanyError('This company is not taking investor inquiries right now.', 409);
  }

  const row = await recordDealFlow(db, env, company.tenantId, { type: 'visitor', ref: null, name: clean.investorName }, {
    source: INVESTOR_INQUIRY_SOURCE,
    companyName: clean.investorCompany,
    contactEmail: clean.investorEmail,
    contactName: clean.investorName,
    summary: clean.message,
    estimatedValue: clean.interestedAmount,
    currency: 'USD',
    subjectCompanyId: company.id,
    details: clean.details,
  });

  // Every owner and manager hears about it in-app (and by email where the
  // webhook is configured). Best-effort, exactly as `notify` documents.
  const recipients = await db
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(and(
      eq(tenantMembers.tenantId, company.tenantId),
      eq(tenantMembers.isActive, true),
      inArray(tenantMembers.role, ['owner', 'manager']),
    ))
    .limit(20);
  await Promise.all(recipients.map((r) => notify(db, env, {
    userId: r.userId,
    tenantId: company.tenantId,
    kind: 'investor_inquiry',
    title: `${clean.investorName} is interested in ${company.name}`,
    body: clean.message.slice(0, 500),
    ref: `/investor?tab=inquiries&company=${company.id}`,
  })));

  return { id: row.id, companyName: company.name, status: row.status, createdAt: row.createdAt.toISOString() };
}
